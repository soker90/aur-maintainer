import { execFile as execFileCallback } from 'node:child_process'
import { access, readFile } from 'node:fs/promises'
import { promisify } from 'node:util'
import type { PackageDefinition } from './types.js'

const execFile = promisify(execFileCallback)

export interface CommandRunner {
  run(command: string, args: string[], cwd?: string): Promise<string>
}

const hostCommandRunner: CommandRunner = {
  async run(command, args, cwd) {
    const result = await execFile(command, args, { cwd })
    return result.stdout
  }
}

export async function validatePackage(
  pkg: PackageDefinition,
  runner: CommandRunner = hostCommandRunner
): Promise<void> {
  try {
    await runner.run('namcap', [pkg.pkgbuildPath])
    await runner.run('makepkg', ['--verifysource'], pkg.path)

    const generatedSrcinfo = await runner.run(
      'makepkg',
      ['--printsrcinfo'],
      pkg.path
    )
    const currentSrcinfo = await readFile(pkg.srcinfoPath, 'utf8')
    if (generatedSrcinfo !== currentSrcinfo) {
      throw new Error(`Generated .SRCINFO does not match ${pkg.srcinfoPath}`)
    }

    await runner.run('makepkg', ['-sf', '--noconfirm'], pkg.path)

    const packageList = await runner.run('makepkg', ['--packagelist'], pkg.path)
    const expectedArtifacts = packageList
      .split('\n')
      .map((entry) => entry.trim())
      .filter(Boolean)
    const artifacts: string[] = []

    for (const artifact of expectedArtifacts) {
      try {
        await access(artifact)
        artifacts.push(artifact)
      } catch {
        // The package was expected but was not produced.
      }
    }

    if (artifacts.length === 0) {
      throw new Error(`No package artifact was produced for ${pkg.name}`)
    }

    for (const artifact of artifacts) {
      await runner.run('namcap', [artifact], pkg.path)
    }

    await runner.run(
      'sudo',
      ['-n', 'pacman', '-U', '--noconfirm', ...artifacts],
      pkg.path
    )
  } catch (error) {
    if (!isCommandNotFound(error)) throw error
    await validatePackageWithDocker(pkg)
  }
}

async function validatePackageWithDocker(
  pkg: PackageDefinition
): Promise<void> {
  const uid = String(process.getuid?.() ?? 1000)
  const gid = String(process.getgid?.() ?? 1000)

  await execFile(
    'docker',
    [
      'run',
      '--rm',
      '--env',
      'HOST_UID=' + uid,
      '--env',
      'HOST_GID=' + gid,
      '--volume',
      pkg.path + ':/pkg',
      '--workdir',
      '/pkg',
      'archlinux:latest',
      'bash',
      '-c',
      'pacman -Syu --noconfirm --needed base-devel namcap sudo && groupadd -o -g "$HOST_GID" builder && useradd -o -u "$HOST_UID" -g "$HOST_GID" --create-home builder && echo "builder ALL=(ALL) NOPASSWD: ALL" >> /etc/sudoers && mkdir -p /tmp/aur-maintainer-pkgdest && chown builder:builder /tmp/aur-maintainer-pkgdest && cd /pkg && sudo -u builder namcap PKGBUILD && sudo -u builder makepkg --verifysource && sudo -u builder makepkg --printsrcinfo > .SRCINFO.generated && diff -u .SRCINFO .SRCINFO.generated && rm .SRCINFO.generated && package_list=$(sudo -u builder env PKGDEST=/tmp/aur-maintainer-pkgdest makepkg --packagelist) && sudo -u builder env PKGDEST=/tmp/aur-maintainer-pkgdest makepkg -sf --noconfirm && packages=() && while IFS= read -r package; do [[ -f "$package" ]] && packages+=( "$package" ); done <<< "$package_list" && [[ -n "${packages[0]}" ]] && for package in "${packages[@]}"; do namcap "$package"; done && pacman -U --noconfirm "${packages[@]}"'
    ],
    { cwd: pkg.path }
  )
}

function isCommandNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error.code === 'ENOENT' || error.code === 127)
  )
}
