import { execFile as execFileCallback } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import { promisify } from 'node:util'
import type { PackageDefinition } from './types.js'
import {
  hostCommandRunner,
  isCommandNotFound,
  type CommandRunner
} from './utils.js'

export type { CommandRunner }

const execFile = promisify(execFileCallback)

export async function updatePackageMetadata(
  pkg: PackageDefinition,
  runner: CommandRunner = hostCommandRunner
): Promise<void> {
  try {
    await runner.run('updpkgsums', ['--nocolor', pkg.pkgbuildPath])
    const srcinfo = await runner.run('makepkg', ['--printsrcinfo'], pkg.path)
    await writeFile(pkg.srcinfoPath, srcinfo)
  } catch (error) {
    if (!isCommandNotFound(error)) throw error
    await updatePackageMetadataWithDocker(pkg)
  }
}

async function updatePackageMetadataWithDocker(
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
      pkg.path + ':/pkg:rw',
      '--workdir',
      '/pkg',
      'archlinux:base-devel',
      'bash',
      '-c',
      'pacman -Sy --noconfirm pacman-contrib && groupadd -o -g "$HOST_GID" builder && useradd -o -u "$HOST_UID" -g "$HOST_GID" --create-home builder && su - builder -c \'cd /pkg && updpkgsums --nocolor PKGBUILD && makepkg --printsrcinfo > .SRCINFO\''
    ],
    { cwd: pkg.path }
  )
}
