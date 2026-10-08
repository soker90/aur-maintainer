import { execFile as execFileCallback } from 'node:child_process'
import path from 'node:path'
import { promisify } from 'node:util'
import type { PackageDefinition } from './types.js'

const execFile = promisify(execFileCallback)
const AUTO_MERGE_POLL_INTERVAL_MS = 10_000

export interface GitRunner {
  run(command: string, args: string[], cwd?: string): Promise<string>
}

const hostGitRunner: GitRunner = {
  async run(command, args, cwd) {
    const result = await execFile(command, args, {
      cwd,
      env: { ...process.env, LC_ALL: 'C' }
    })
    return result.stdout
  }
}

export async function requestGitHub(
  token: string,
  path: string,
  method = 'GET',
  body?: Record<string, string>
): Promise<unknown> {
  const response = await fetch('https://api.github.com' + path, {
    method,
    headers: {
      accept: 'application/vnd.github+json',
      authorization: 'Bearer ' + token,
      'x-github-api-version': '2026-03-10',
      'user-agent': 'aur-maintainer'
    },
    body: body ? JSON.stringify(body) : undefined
  })

  if (!response.ok) {
    throw new Error(
      `GitHub API request failed: ${response.status} ${response.statusText}`
    )
  }

  return response.json()
}

function getRelativePackagePath(
  workspace: string,
  packagePath: string
): string {
  const relative = path.relative(workspace, packagePath)
  if (
    relative === '' ||
    relative.startsWith('..') ||
    path.isAbsolute(relative)
  ) {
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
  autoMerge: boolean
  autoMergeTimeoutSeconds: number
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

  await git.run('git', ['add', '--', ...packagePaths], workspace)
  const changed = await git.run(
    'git',
    ['diff', '--cached', '--name-only'],
    workspace
  )
  if (!changed.trim()) {
    throw new Error(
      'No package changes are available for the validation failure branch'
    )
  }

  await git.run('git', ['switch', options.baseBranch], workspace)
  await git.run('git', ['switch', '-C', branch], workspace)
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
  await git.run(
    'git',
    ['commit', '-m', 'validation failed: ' + options.pkg.name],
    workspace
  )
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
  ].join('\\n')

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
}

function formatErrorDetails(error: unknown): string {
  if (error instanceof Error) {
    const details = [error.message]
    const candidate = error as Error & { stderr?: string; stdout?: string }
    if (candidate.stderr?.trim()) details.push(candidate.stderr.trim())
    if (candidate.stdout?.trim()) details.push(candidate.stdout.trim())
    return details.join('\\n').slice(0, 12_000)
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

  await git.run('git', ['add', '--', ...packagePaths], workspace)
  const changed = await git.run(
    'git',
    ['diff', '--cached', '--name-only'],
    workspace
  )
  if (!changed.trim()) return null

  await git.run('git', ['switch', options.baseBranch], workspace)
  await git.run('git', ['switch', '-C', branch], workspace)
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
  await git.run('git', ['commit', '-m', `update: ${pkg.name}`], workspace)
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
    if (options.autoMerge) {
      await waitForChecksAndMerge(
        options.token,
        options.repository,
        current,
        options.autoMergeTimeoutSeconds
      )
    }
    await git.run('git', ['switch', options.baseBranch], workspace)
    return current.html_url
  }

  const created = await requestGitHub(
    options.token,
    `/repos/${owner}/${repo}/pulls`,
    'POST',
    {
      title: `update: ${pkg.name}`,
      body: `Automated update for ${pkg.name} generated by aur-maintainer.`,
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
  await git.run('git', ['switch', options.baseBranch], workspace)
  return created.html_url
}

function getPackageUpdateBranch(prefix: string, packageName: string): string {
  return prefix.replace(/\/$/, '') + '/' + packageName
}

async function waitForChecksAndMerge(
  token: string,
  repository: string,
  pullRequest: PullRequest,
  timeoutSeconds: number
): Promise<void> {
  if (!Number.isInteger(timeoutSeconds) || timeoutSeconds < 1) {
    throw new Error('auto-merge-timeout must be a positive integer')
  }

  const deadline = Date.now() + timeoutSeconds * 1000
  const [owner, repo] = repository.split('/')
  if (!owner || !repo)
    throw new Error('GITHUB_REPOSITORY must use owner/name form')
  if (!pullRequest.head?.sha) {
    throw new Error('GitHub did not return the pull request head SHA')
  }

  while (Date.now() < deadline) {
    const checks = await requestGitHub(
      token,
      `/repos/${owner}/${repo}/commits/${pullRequest.head.sha}/check-runs?per_page=100`
    )
    const checkRuns = isCheckRunsResponse(checks) ? checks.check_runs : []

    if (checkRuns.length > 0) {
      if (checkRuns.every((check) => check.status === 'completed')) {
        const failed = checkRuns.find(
          (check) =>
            check.conclusion !== 'success' &&
            check.conclusion !== 'neutral' &&
            check.conclusion !== 'skipped'
        )
        if (failed) {
          throw new Error(
            `Pull request checks failed: ${failed.name} (${failed.conclusion ?? 'unknown'})`
          )
        }
        await squashMergePullRequest(token, pullRequest)
        return
      }
    } else {
      const current = await requestGitHub(
        token,
        `/repos/${owner}/${repo}/pulls/${pullRequest.number}`
      )
      if (
        isMergeablePullRequest(current) &&
        current.mergeable_state === 'clean'
      ) {
        await squashMergePullRequest(token, pullRequest)
        return
      }
      if (
        isMergeablePullRequest(current) &&
        current.mergeable_state === 'dirty'
      ) {
        throw new Error(
          'Pull request cannot be merged because it has conflicts'
        )
      }
    }

    await new Promise((resolve) =>
      setTimeout(
        resolve,
        Math.min(
          AUTO_MERGE_POLL_INTERVAL_MS,
          Math.max(0, deadline - Date.now())
        )
      )
    )
  }

  throw new Error(
    `Timed out waiting for pull request checks after ${timeoutSeconds} seconds`
  )
}

async function squashMergePullRequest(
  token: string,
  pullRequest: PullRequest
): Promise<void> {
  if (!pullRequest.node_id || !pullRequest.head?.sha) {
    throw new Error(
      'GitHub did not return the pull request node ID or head SHA'
    )
  }

  const response = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: {
      accept: 'application/vnd.github+json',
      authorization: 'Bearer ' + token,
      'content-type': 'application/json',
      'x-github-api-version': '2026-03-10',
      'user-agent': 'aur-maintainer'
    },
    body: JSON.stringify({
      query:
        'mutation($input: MergePullRequestInput!) { mergePullRequest(input: $input) { pullRequest { id } } }',
      variables: {
        input: {
          pullRequestId: pullRequest.node_id,
          expectedHeadOid: pullRequest.head.sha,
          mergeMethod: 'SQUASH'
        }
      }
    })
  })

  const payload = (await response.json()) as {
    errors?: Array<{ message?: string }>
  }
  if (!response.ok || payload.errors?.length) {
    const message = payload.errors?.[0]?.message
    throw new Error(
      `GitHub squash merge failed: ${message ?? response.statusText}`
    )
  }
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

interface PullRequest {
  html_url: string
  number?: number
  node_id?: string
  head?: { sha: string }
}

interface MergeablePullRequest {
  mergeable_state: string
}

function isMergeablePullRequest(value: unknown): value is MergeablePullRequest {
  return (
    typeof value === 'object' &&
    value !== null &&
    'mergeable_state' in value &&
    typeof value.mergeable_state === 'string'
  )
}

interface CheckRun {
  name: string
  status: string
  conclusion: string | null
}

interface CheckRunsResponse {
  check_runs: CheckRun[]
}

function isCheckRunsResponse(value: unknown): value is CheckRunsResponse {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('check_runs' in value) ||
    !Array.isArray(value.check_runs)
  ) {
    return false
  }

  return value.check_runs.every(
    (check): check is CheckRun =>
      typeof check === 'object' &&
      check !== null &&
      'name' in check &&
      typeof check.name === 'string' &&
      'status' in check &&
      typeof check.status === 'string' &&
      'conclusion' in check &&
      (typeof check.conclusion === 'string' || check.conclusion === null)
  )
}

function isPullRequest(value: unknown): value is PullRequest {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('html_url' in value) ||
    typeof value.html_url !== 'string'
  ) {
    return false
  }

  if (
    'number' in value &&
    value.number !== undefined &&
    typeof value.number !== 'number'
  ) {
    return false
  }

  if (
    'node_id' in value &&
    value.node_id !== undefined &&
    typeof value.node_id !== 'string'
  ) {
    return false
  }

  if ('head' in value && value.head !== undefined) {
    const head = value.head
    if (
      typeof head !== 'object' ||
      head === null ||
      !('sha' in head) ||
      typeof head.sha !== 'string'
    ) {
      return false
    }
  }

  return true
}
