import { requestGitHub } from './github.js'

const AUTO_MERGE_POLL_INTERVAL_MS = 10_000

export interface PullRequest {
  html_url: string
  number?: number
  node_id?: string
  head?: { sha: string }
}

interface MergeablePullRequest {
  mergeable_state: string
}

interface CheckRun {
  name: string
  status: string
  conclusion: string | null
}

interface CheckRunsResponse {
  check_runs: CheckRun[]
}

export async function waitForChecksAndMerge(
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
  if (!pullRequest.number) {
    throw new Error('GitHub did not return the pull request number')
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

export async function squashMergePullRequest(
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

export function isMergeablePullRequest(
  value: unknown
): value is MergeablePullRequest {
  return (
    typeof value === 'object' &&
    value !== null &&
    'mergeable_state' in value &&
    typeof value.mergeable_state === 'string'
  )
}

export function isCheckRunsResponse(
  value: unknown
): value is CheckRunsResponse {
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

export function isPullRequest(value: unknown): value is PullRequest {
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
