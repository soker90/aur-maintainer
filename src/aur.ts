import { cp, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { PackageDefinition } from './types.js'

export interface AurPublishOptions {
  sshKey: string
  knownHosts: string
}

export interface GitRunner {
  run(
    command: string,
    args: string[],
    cwd?: string,
    env?: NodeJS.ProcessEnv
  ): Promise<string>
}

const hostGitRunner: GitRunner = {
  async run(command, args, cwd, env) {
    const { execFile } = await import('node:child_process')
    const { promisify } = await import('node:util')
    const run = promisify(execFile)
    const result = await run(command, args, { cwd, env })
    return result.stdout
  }
}

export async function publishAurPackage(
  pkg: PackageDefinition,
  options: AurPublishOptions,
  git: GitRunner = hostGitRunner
): Promise<boolean> {
  if (!options.sshKey.trim()) {
    throw new Error('AUR SSH key is required when AUR publishing is enabled')
  }
  if (!options.knownHosts.trim()) {
    throw new Error(
      'AUR known hosts are required when AUR publishing is enabled'
    )
  }

  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'aur-maintainer-'))
  const keyPath = path.join(tempDir, 'aur-key')
  const knownHostsPath = path.join(tempDir, 'known_hosts')
  const repositoryPath = path.join(tempDir, pkg.name)

  try {
    await writeFile(keyPath, normalizeSshKey(options.sshKey), { mode: 0o600 })
    await writeFile(knownHostsPath, options.knownHosts, { mode: 0o600 })

    const sshCommand = [
      'ssh',
      '-i',
      keyPath,
      '-o',
      'IdentitiesOnly=yes',
      '-o',
      'UserKnownHostsFile=' + knownHostsPath,
      '-o',
      'StrictHostKeyChecking=yes'
    ].join(' ')

    const env = {
      ...process.env,
      GIT_SSH_COMMAND: sshCommand
    }

    const remote = 'ssh://aur@aur.archlinux.org/' + pkg.name + '.git'
    await git.run('git', ['clone', remote, repositoryPath], undefined, env)

    const files = await getAurPackageFiles(pkg.path)
    await git.run('git', ['rm', '-r', '--ignore-unmatch', '--', '.'], repositoryPath, env)
    for (const file of files) {
      await cp(path.join(pkg.path, file), path.join(repositoryPath, file))
    }

    const changed = await git.run(
      'git',
      ['status', '--short'],
      repositoryPath,
      env
    )
    if (!changed.trim()) return false

    await git.run(
      'git',
      ['config', 'user.name', 'aur-maintainer'],
      repositoryPath,
      env
    )
    await git.run(
      'git',
      ['config', 'user.email', 'aur-maintainer@users.noreply.github.com'],
      repositoryPath,
      env
    )
    await git.run('git', ['add', '-A'], repositoryPath, env)
    await git.run(
      'git',
      ['commit', '-m', 'chore: update ' + pkg.name],
      repositoryPath,
      env
    )
    await git.run('git', ['push', 'origin', 'master'], repositoryPath, env)
    return true
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
}

export function normalizeSshKey(key: string): string {
  return key.replace(/\r\n/g, '\n').replace(/\\n/g, '\n').trimEnd() + '\n'
}

export async function getAurPackageFiles(
  packagePath: string
): Promise<string[]> {
  const entries = await readdir(packagePath, { withFileTypes: true })
  const additionalFiles = entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => !['PKGBUILD', '.SRCINFO', 'update.yml'].includes(name))
    .toSorted()

  return ['PKGBUILD', '.SRCINFO', ...additionalFiles]
}
