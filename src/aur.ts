import {
  cp,
  mkdir,
  mkdtemp,
  readdir,
  rm,
  stat,
  writeFile
} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { PackageDefinition } from './types.js'

export const MAX_AUR_BLOB_SIZE = 500_000

export interface AurPublishOptions {
  sshKey: string
  knownHosts: string
  rewriteHistory?: boolean
}

interface OversizedBlob {
  sha: string
  size: number
  path: string
}

import { hostGitRunner, type GitRunner } from './utils.js'

export type { GitRunner }

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

  const files = await getAurPackageFiles(pkg.path)
  await validatePackageFileSizes(pkg.path, files)

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
      `"${keyPath}"`,
      '-o',
      'IdentitiesOnly=yes',
      '-o',
      `"UserKnownHostsFile=${knownHostsPath}"`,
      '-o',
      'StrictHostKeyChecking=yes',
      '-o',
      'SendEnv=AUR_OVERWRITE'
    ].join(' ')

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      GIT_SSH_COMMAND: sshCommand
    }

    const remote = 'ssh://aur@aur.archlinux.org/' + pkg.name + '.git'
    await git.run('git', ['clone', remote, repositoryPath], undefined, env)

    const oversizedBlobs = await findOversizedHistoryBlobs(
      repositoryPath,
      git,
      env
    )
    let rewrittenHistory = false

    if (oversizedBlobs.length > 0) {
      if (!options.rewriteHistory) {
        const details = oversizedBlobs
          .map((blob) => `${blob.path} (${blob.size} bytes)`)
          .toSorted()
          .join(', ')
        throw new Error(
          `AUR history for ${pkg.name} contains blobs exceeding the ${MAX_AUR_BLOB_SIZE}-byte limit: ${details}. Enable aur-rewrite-history to back up and sanitize the history before publishing.`
        )
      }

      const backupDirectory = path.join(
        process.env.RUNNER_TEMP ?? os.tmpdir(),
        'aur-maintainer-aur-backups'
      )
      const backupPath = path.join(backupDirectory, `${pkg.name}.bundle`)
      await mkdir(backupDirectory, { recursive: true })
      await git.run(
        'git',
        ['bundle', 'create', backupPath, '--all'],
        repositoryPath,
        env
      )

      console.info(
        `Backed up original AUR history for ${pkg.name} to ${backupPath}`
      )
      console.info(
        `Removing oversized historical blobs from ${pkg.name}: ${oversizedBlobs
          .map((blob) => `${blob.path} (${blob.size} bytes)`)
          .join(', ')}`
      )

      await git.run(
        'git',
        [
          'filter-branch',
          '--force',
          '--tree-filter',
          `find . -type f -size +${MAX_AUR_BLOB_SIZE}c -delete`,
          '--',
          'master'
        ],
        repositoryPath,
        { ...env, FILTER_BRANCH_SQUELCH_WARNING: '1' }
      )

      const remainingBlobs = await findOversizedHistoryBlobs(
        repositoryPath,
        git,
        env
      )
      if (remainingBlobs.length > 0) {
        throw new Error(
          `AUR history sanitization did not remove all oversized blobs for ${pkg.name}: ${remainingBlobs
            .map((blob) => `${blob.path} (${blob.size} bytes)`)
            .join(', ')}`
        )
      }

      rewrittenHistory = true
    }

    await git.run(
      'git',
      ['rm', '-r', '--ignore-unmatch', '--', '.'],
      repositoryPath,
      env
    )
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

    const pushEnv = rewrittenHistory ? { ...env, AUR_OVERWRITE: '1' } : env
    const pushArgs = rewrittenHistory
      ? ['push', '--force', 'origin', 'master']
      : ['push', 'origin', 'master']
    await git.run('git', pushArgs, repositoryPath, pushEnv)
    return true
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
}

async function validatePackageFileSizes(
  packagePath: string,
  files: string[]
): Promise<void> {
  const oversizedFiles: string[] = []
  for (const file of files) {
    const fileSize = (await stat(path.join(packagePath, file))).size
    if (fileSize > MAX_AUR_BLOB_SIZE) {
      oversizedFiles.push(`${file} (${fileSize} bytes)`)
    }
  }

  if (oversizedFiles.length > 0) {
    throw new Error(
      `AUR package files exceed the ${MAX_AUR_BLOB_SIZE}-byte blob limit: ${oversizedFiles.join(', ')}. Replace large local files with upstream source URLs before publishing.`
    )
  }
}

async function findOversizedHistoryBlobs(
  repositoryPath: string,
  git: GitRunner,
  env: NodeJS.ProcessEnv
): Promise<OversizedBlob[]> {
  const output = await git.run(
    'bash',
    [
      '-c',
      "if git show-ref --verify --quiet refs/heads/master; then git rev-list --objects master | git cat-file --batch-check='%(objecttype) %(objectname) %(objectsize) %(rest)'; fi"
    ],
    repositoryPath,
    env
  )

  return output
    .split('\n')
    .flatMap((line) => {
      const match = /^blob ([0-9a-f]{40,64}) (\d+) (.+)$/.exec(line)
      if (!match) return []
      const size = Number(match[2])
      if (size <= MAX_AUR_BLOB_SIZE) return []
      return [{ sha: match[1], size, path: match[3] }]
    })
    .filter(
      (blob, index, blobs) =>
        blobs.findIndex(
          (candidate) => candidate.sha === blob.sha && candidate.path === blob.path
        ) === index
    )
}

export function normalizeSshKey(key: string): string {
  return key.replace(/\r\n/g, '\n').replace(/\\n/g, '\n').trimEnd() + '\n'
}

const IGNORED_AUR_FILES = new Set([
  'PKGBUILD',
  '.SRCINFO',
  'update.yml',
  '.aur-maintainer.yml'
])

export async function getAurPackageFiles(
  packagePath: string
): Promise<string[]> {
  const entries = await readdir(packagePath, { withFileTypes: true })
  const additionalFiles = entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => !IGNORED_AUR_FILES.has(name) && !name.startsWith('.git'))
    .toSorted()

  return ['PKGBUILD', '.SRCINFO', ...additionalFiles]
}
