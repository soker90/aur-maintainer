import { execFile as execFileCallback } from 'node:child_process'
import { readFile, readdir } from 'node:fs/promises'
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

    const artifacts = (await readdir(pkg.path)).filter((entry) =>
      /\.pkg\.tar\.[^.]+$/.test(entry)
    )
    if (artifacts.length === 0) {
      throw new Error(`No package artifact was produced for ${pkg.name}`)
    }

    for (const artifact of artifacts) {
      const artifactPath = `${pkg.path}/${artifact}`
      await runner.run('namcap', [artifactPath], pkg.path)
    }

    await runner.run('pacman', ['-U', '--noconfirm', ...artifacts], pkg.path)
  } catch (error) {
    if (!isCommandNotFound(error)) throw error
    await validatePackageWithDocker(pkg)
  }
}

async function validatePackageWithDocker(
  pkg: PackageDefinition
): Promise<void> {
  await execFile(
    'docker',
    [
      'run',
      '--rm',
      '--volume',
      pkg.path + ':/pkg',
      '--workdir',
      '/pkg',
      'archlinux:latest',
      'bash',
      '-c',
      'pacman -Syu --noconfirm --needed base-devel namcap sudo && useradd -m builder && echo "builder ALL=(ALL) NOPASSWD: ALL" >> /etc/sudoers && chown -R builder:builder /pkg && cd /pkg && sudo -u builder namcap PKGBUILD && sudo -u builder makepkg --verifysource && sudo -u builder makepkg --printsrcinfo > .SRCINFO.generated && diff -u .SRCINFO .SRCINFO.generated && rm .SRCINFO.generated && sudo -u builder makepkg -sf --noconfirm && packages=( *.pkg.tar.* ) && [[ -e "${packages[0]}" ]] && for package in "${packages[@]}"; do namcap "$package"; done && pacman -U --noconfirm "${packages[@]}"'
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
