import path from 'node:path'
import type { PackageDefinition } from './types.js'
import { requestGitHub } from './github.js'
import { waitForChecksAndMerge, isPullRequest } from './auto-merge.js'
import { hostGitRunner, type GitRunner } from './utils.js'

export { requestGitHub }
export type { GitRunner }

function getRelativePackagePath(
  workspace: string,
  packagePath: string
): string {
  const relative = path.relative(workspace, packagePath)
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Package path must be inside the workspace')
  }
  return relative
}

function validateBranchName(branch: string): void {
  if (
    branch.length === 0 ||
    branch.startsWith('-') ||
    branch.includes('..') ||
    branch.includes(' ')
  ) {
    throw new Error('Invalid update branch name')
  }
}

interface PullRequestOptions {
  token: string
  repository: string
  baseBranch: string
  updateBranch: string
  packages: PackageDefinition[]
  currentVersion: string
  version: string
  autoMerge: boolean
  autoMergeTimeoutSeconds: number
}

async function commitPackageChanges(
  workspace: string,
  packagePaths: string[],
  message: string,
  git: GitRunner
): Promise<string | null> {
  await git.run('git', ['add', '--', ...packagePaths], workspace)
  const changed = await git.run(
    'git',
    ['diff', '--cached', '--name-only'],
    workspace
  )
  if (!changed.trim()) return null

  await git.run(
    'git',
    ['config', 'user.name', 'github-actions[bot]'],
    workspace
  )
  await git.run(
    'git',
    [
      'config',
      'user.email',
      '41898282+github-actions[bot]@users.noreply.github.com'
    ],
    workspace
  )
  await git.run('git', ['commit', '-m', message], workspace)
  return (await git.run('git', ['rev-parse', 'HEAD'], workspace)).trim()
}

async function switchToUpdateBranch(
  baseBranch: string,
  branch: string,
  commit: string,
  workspace: string,
  git: GitRunner
): Promise<void> {
  await switchToBaseBranch(baseBranch, workspace, git)
  await git.run('git', ['switch', '-C', branch], workspace)
  await git.run('git', ['cherry-pick', commit], workspace)
}

async function switchToBaseBranch(
  baseBranch: string,
  workspace: string,
  git: GitRunner
): Promise<void> {
  const remoteRef = `refs/remotes/origin/${baseBranch}`
  await git.run(
    'git',
    ['fetch', '--no-tags', 'origin', `+refs/heads/${baseBranch}:${remoteRef}`],
    workspace
  )
  await git.run('git', ['switch', '-C', baseBranch, remoteRef], workspace)
}

export async function createValidationFailureIssue(
  workspace: string,
  options: {
    token: string
    repository: string
    baseBranch: string
    updateBranch: string
    pkg: PackageDefinition
    currentVersion: string
    version: string
    error: unknown
  },
  git: GitRunner = hostGitRunner
): Promise<string> {
  const relative = getRelativePackagePath(workspace, options.pkg.path)
  const packagePaths = [
    path.join(relative, 'PKGBUILD'),
    path.join(relative, '.SRCINFO')
  ]
  const branch = getPackageUpdateBranch(options.updateBranch, options.pkg.name)
  validateBranchName(branch)

  const updateCommit = await commitPackageChanges(
    workspace,
    packagePaths,
    'validation failed: ' + options.pkg.name,
    git
  )
  if (!updateCommit) {
    throw new Error(
      'No package changes are available for the validation failure branch'
    )
  }

  await switchToUpdateBranch(
    options.baseBranch,
    branch,
    updateCommit,
    workspace,
    git
  )
  try {
    await git.run(
      'git',
      ['push', '--force', '--set-upstream', 'origin', branch],
      workspace
    )

    const [owner, repo] = options.repository.split('/')
    if (!owner || !repo) {
      throw new Error('GITHUB_REPOSITORY must use owner/name form')
    }

    const branchUrl =
      'https://github.com/' + options.repository + '/tree/' + branch
    const errorDetails = formatErrorDetails(options.error)
    const body = [
      '## AUR package validation failed',
      '',
      'Package: `' + options.pkg.name + '`',
      'Detected update: ' + options.currentVersion + ' → ' + options.version,
      'Branch: [' + branch + '](' + branchUrl + ')',
      '',
      '### Validation error',
      '',
      '~~~text',
      errorDetails,
      '~~~',
      '',
      'The generated package changes were preserved on the branch above for investigation. No pull request was created.'
    ].join('\n')

    const created = await requestGitHub(
      options.token,
      '/repos/' + owner + '/' + repo + '/issues',
      'POST',
      {
        title: 'validation failed: ' + options.pkg.name,
        body
      }
    )
    if (!isIssue(created)) {
      throw new Error('GitHub did not return the created validation issue URL')
    }
    return created.html_url
  } finally {
    await switchToBaseBranch(options.baseBranch, workspace, git)
  }
}

function formatErrorDetails(error: unknown): string {
  if (error instanceof Error) {
    const details = [error.message]
    const candidate = error as Error & { stderr?: string; stdout?: string }
    if (candidate.stderr?.trim()) details.push(candidate.stderr.trim())
    if (candidate.stdout?.trim()) details.push(candidate.stdout.trim())
    return details.join('\n').slice(0, 12_000)
  }
  return String(error).slice(0, 12_000)
}

export async function createUpdatePullRequest(
  workspace: string,
  options: PullRequestOptions,
  git: GitRunner = hostGitRunner
): Promise<string | null> {
  if (options.packages.length !== 1) {
    throw new Error('Exactly one package is required per update pull request')
  }

  const pkg = options.packages[0]
  const relative = getRelativePackagePath(workspace, pkg.path)
  const packagePaths = [
    path.join(relative, 'PKGBUILD'),
    path.join(relative, '.SRCINFO')
  ]
  const branch = getPackageUpdateBranch(options.updateBranch, pkg.name)
  validateBranchName(branch)

  const updateCommit = await commitPackageChanges(
    workspace,
    packagePaths,
    `update: ${pkg.name}`,
    git
  )
  if (!updateCommit) return null

  await switchToUpdateBranch(
    options.baseBranch,
    branch,
    updateCommit,
    workspace,
    git
  )
  try {
    await git.run(
      'git',
      ['push', '--force', '--set-upstream', 'origin', branch],
      workspace
    )

    const [owner, repo] = options.repository.split('/')
    if (!owner || !repo)
      throw new Error('GITHUB_REPOSITORY must use owner/name form')

    const existing = await requestGitHub(
      options.token,
      `/repos/${owner}/${repo}/pulls?state=open&head=${encodeURIComponent(
        owner + ':' + branch
      )}&base=${encodeURIComponent(options.baseBranch)}`
    )
    const pullRequests = Array.isArray(existing) ? existing : []
    const current = pullRequests[0]
    if (isPullRequest(current)) {
      if (current.number === undefined) {
        throw new Error(
          'GitHub did not return the existing pull request number'
        )
      }
      await updatePullRequestMetadata(
        options.token,
        options.repository,
        current.number,
        pkg.name,
        options.currentVersion,
        options.version
      )
      if (options.autoMerge) {
        await waitForChecksAndMerge(
          options.token,
          options.repository,
          current,
          options.autoMergeTimeoutSeconds
        )
      }
      return current.html_url
    }

    const created = await requestGitHub(
      options.token,
      `/repos/${owner}/${repo}/pulls`,
      'POST',
      {
        title: `update: ${pkg.name}`,
        body: getUpdatePullRequestBody(
          pkg.name,
          options.currentVersion,
          options.version
        ),
        head: branch,
        base: options.baseBranch
      }
    )
    if (!isPullRequest(created))
      throw new Error('GitHub did not return the created pull request URL')
    if (options.autoMerge) {
      await waitForChecksAndMerge(
        options.token,
        options.repository,
        created,
        options.autoMergeTimeoutSeconds
      )
    }
    return created.html_url
  } finally {
    await switchToBaseBranch(options.baseBranch, workspace, git)
  }
}

function getUpdatePullRequestBody(
  packageName: string,
  currentVersion: string,
  version: string
): string {
  return [
    `Automated update for ${packageName} generated by aur-maintainer.`,
    '',
    `Updated package: ${currentVersion} → ${version}`
  ].join('\n')
}

async function updatePullRequestMetadata(
  token: string,
  repository: string,
  pullRequestNumber: number,
  packageName: string,
  currentVersion: string,
  version: string
): Promise<void> {
  const [owner, repo] = repository.split('/')
  if (!owner || !repo) {
    throw new Error('GITHUB_REPOSITORY must use owner/name form')
  }

  await requestGitHub(
    token,
    `/repos/${owner}/${repo}/pulls/${pullRequestNumber}`,
    'PATCH',
    {
      title: `update: ${packageName}`,
      body: getUpdatePullRequestBody(packageName, currentVersion, version)
    }
  )
}

function getPackageUpdateBranch(prefix: string, packageName: string): string {
  return prefix.replace(/\/$/, '') + '/' + packageName
}

interface Issue {
  html_url: string
}

function isIssue(value: unknown): value is Issue {
  return (
    typeof value === 'object' &&
    value !== null &&
    'html_url' in value &&
    typeof value.html_url === 'string'
  )
}
