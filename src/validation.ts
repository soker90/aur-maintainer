import { execFile as execFileCallback } from 'node:child_process'
import { access, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import type { PackageDefinition } from './types.js'
import {
  hostCommandRunner,
  isCommandNotFound,
  type CommandRunner
} from './utils.js'

export type { CommandRunner }

const execFile = promisify(execFileCallback)

export async function validatePackage(
  pkg: PackageDefinition,
  runner: CommandRunner = hostCommandRunner
): Promise<void> {
  const validationDirectory = await mkdtemp(
    path.join(os.tmpdir(), 'aur-maintainer-validation-')
  )
  const sourceDirectory = path.join(validationDirectory, 'sources')
  const packageDirectory = path.join(validationDirectory, 'packages')
  const makepkgEnvironment: NodeJS.ProcessEnv = {
    ...process.env,
    SRCDEST: sourceDirectory,
    PKGDEST: packageDirectory
  }

  await Promise.all([
    mkdir(sourceDirectory, { recursive: true }),
    mkdir(packageDirectory, { recursive: true })
  ])

  try {
    await runner.run('namcap', [pkg.pkgbuildPath])
    await runner.run(
      'makepkg',
      ['--verifysource'],
      pkg.path,
      makepkgEnvironment
    )

    const generatedSrcinfo = await runner.run(
      'makepkg',
      ['--printsrcinfo'],
      pkg.path,
      makepkgEnvironment
    )
    const currentSrcinfo = await readFile(pkg.srcinfoPath, 'utf8')
    if (
      generatedSrcinfo.replace(/\r\n/g, '\n').trim() !==
      currentSrcinfo.replace(/\r\n/g, '\n').trim()
    ) {
      throw new Error(`Generated .SRCINFO does not match ${pkg.srcinfoPath}`)
    }

    await runner.run(
      'makepkg',
      ['-sf', '--noconfirm'],
      pkg.path,
      makepkgEnvironment
    )

    const packageList = await runner.run(
      'makepkg',
      ['--packagelist'],
      pkg.path,
      makepkgEnvironment
    )
    const expectedArtifacts = packageList
      .split('\n')
      .map((entry) => entry.trim())
      .filter(Boolean)
    if (expectedArtifacts.length === 0) {
      throw new Error(`No package artifact was produced for ${pkg.name}`)
    }

    const artifacts = expectedArtifacts.map((artifact) =>
      resolveArtifactPath(packageDirectory, artifact)
    )
    const missingArtifacts: string[] = []

    for (const artifact of artifacts) {
      try {
        await access(artifact)
      } catch {
        missingArtifacts.push(artifact)
      }
    }

    if (missingArtifacts.length > 0) {
      throw new Error(
        `Expected package artifacts were not produced for ${pkg.name}: ${missingArtifacts.join(
          ', '
        )}`
      )
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
  } finally {
    await rm(validationDirectory, { recursive: true, force: true })
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
      'pacman -Syu --noconfirm --needed base-devel namcap sudo && groupadd -o -g "$HOST_GID" builder && useradd -o -u "$HOST_UID" -g "$HOST_GID" --create-home builder && echo "builder ALL=(ALL) NOPASSWD: ALL" >> /etc/sudoers && mkdir -p /tmp/aur-maintainer-srcdest /tmp/aur-maintainer-pkgdest && chown -R builder:builder /tmp/aur-maintainer-srcdest /tmp/aur-maintainer-pkgdest && cd /pkg && sudo -u builder namcap PKGBUILD && sudo -u builder env SRCDEST=/tmp/aur-maintainer-srcdest PKGDEST=/tmp/aur-maintainer-pkgdest makepkg --verifysource && sudo -u builder makepkg --printsrcinfo > .SRCINFO.generated && diff -u .SRCINFO .SRCINFO.generated && rm .SRCINFO.generated && sudo -u builder env SRCDEST=/tmp/aur-maintainer-srcdest PKGDEST=/tmp/aur-maintainer-pkgdest makepkg -sf --noconfirm && packages=(/tmp/aur-maintainer-pkgdest/*.pkg.tar.*) && [[ -e "${packages[0]}" ]] && for package in "${packages[@]}"; do namcap "$package"; done && pacman -U --noconfirm "${packages[@]}"'
    ],
    { cwd: pkg.path }
  )
}

function resolveArtifactPath(packagePath: string, artifact: string): string {
  return path.isAbsolute(artifact)
    ? artifact
    : path.resolve(packagePath, artifact)
}
