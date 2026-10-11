import type { ConnectorContext } from './types.js'
import { isRecord } from '../utils.js'
import {
  comparePackageVersions,
  isSupportedPackageVersion
} from '../version.js'

export async function fetchGithub(
  context: ConnectorContext,
  url: string
): Promise<Response> {
  return context.fetch(url, githubRequestInit(context.token))
}

export function githubRequestInit(token?: string): RequestInit {
  const headers: Record<string, string> = {
    accept: 'application/vnd.github+json',
    'user-agent': 'aur-maintainer',
    'x-github-api-version': '2026-03-10'
  }

  if (token) headers.authorization = `Bearer ${token}`

  return { headers }
}

export async function fetchLatestGithubTag(
  context: ConnectorContext,
  repository: string
): Promise<{ version: string; tag: string }> {
  const tags = []
  let page = 1

  while (true) {
    const response = await fetchGithub(
      context,
      `https://api.github.com/repos/${repository}/tags?per_page=100&page=${page}`
    )

    if (!response.ok) {
      throw new Error(
        `GitHub tags request failed for ${repository}: ${response.status} ${response.statusText}`
      )
    }

    const pageTags = (await response.json()) as unknown
    if (!Array.isArray(pageTags)) {
      throw new Error(`GitHub tags response for ${repository} is not an array`)
    }

    tags.push(...pageTags)
    if (pageTags.length < 100) break
    page += 1
  }

  return parseLatestTag(repository, tags)
}

export function parseLatestTag(
  repository: string,
  value: unknown
): { version: string; tag: string } {
  if (!Array.isArray(value)) {
    throw new Error(`GitHub tags response for ${repository} is not an array`)
  }

  const candidates = value
    .filter(isRecord)
    .filter((tag) => typeof tag.name === 'string')
    .map((tag) => {
      const name = tag.name as string
      const version = name.trim().replace(/^v(?=\d)/i, '')
      return { name, version }
    })
    .filter(({ version }) => isSupportedPackageVersion(version))
    .toSorted((left, right) =>
      comparePackageVersions(left.version, right.version)
    )

  const latest = candidates.at(-1)
  if (!latest) {
    throw new Error(
      `GitHub tags for ${repository} contain no supported versions`
    )
  }

  return {
    version: latest.version,
    tag: latest.name
  }
}
