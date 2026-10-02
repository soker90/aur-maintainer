import type { PackageDefinition, UpdateCandidate } from './types.js'

export interface Connector {
  readonly name: string
  detect(
    pkg: PackageDefinition,
    config: Record<string, unknown>
  ): Promise<UpdateCandidate>
}

export interface ConnectorContext {
  fetch(input: string | URL, init?: RequestInit): Promise<Response>
  token?: string
}

export function createConnectorRegistry(
  context: ConnectorContext
): Map<string, ConnectorFactory> {
  return new Map([
    ['github-release', () => new GithubReleaseConnector(context)],
    ['github-tag', () => new GithubTagConnector(context)]
  ])
}

type ConnectorFactory = (context: ConnectorContext) => Connector

class GithubReleaseConnector implements Connector {
  readonly name = 'github-release'

  constructor(private readonly context: ConnectorContext) {}

  async detect(
    _pkg: PackageDefinition,
    config: Record<string, unknown>
  ): Promise<UpdateCandidate> {
    const repository = config.repository
    if (typeof repository !== 'string' || !/^[^/]+\/[^/]+$/.test(repository)) {
      throw new Error(
        'github-release connector requires config.repository in owner/name form'
      )
    }

    const response = await this.context.fetch(
      `https://api.github.com/repos/${repository}/releases/latest`,
      githubRequestInit(this.context.token)
    )

    if (!response.ok) {
      throw new Error(
        `GitHub Releases request failed for ${repository}: ${response.status} ${response.statusText}`
      )
    }

    return parseRelease(repository, (await response.json()) as unknown)
  }
}

class GithubTagConnector implements Connector {
  readonly name = 'github-tag'

  constructor(private readonly context: ConnectorContext) {}

  async detect(
    _pkg: PackageDefinition,
    config: Record<string, unknown>
  ): Promise<UpdateCandidate> {
    const repository = config.repository
    if (typeof repository !== 'string' || !/^[^/]+\/[^/]+$/.test(repository)) {
      throw new Error(
        'github-tag connector requires config.repository in owner/name form'
      )
    }

    const tags = []
    let page = 1

    while (true) {
      const response = await this.context.fetch(
        `https://api.github.com/repos/${repository}/tags?per_page=100&page=${page}`,
        githubRequestInit(this.context.token)
      )

      if (!response.ok) {
        throw new Error(
          `GitHub tags request failed for ${repository}: ${response.status} ${response.statusText}`
        )
      }

      const pageTags = (await response.json()) as unknown
      if (!Array.isArray(pageTags)) {
        throw new Error(
          `GitHub tags response for ${repository} is not an array`
        )
      }

      tags.push(...pageTags)
      if (pageTags.length < 100) break
      page += 1
    }

    return parseLatestTag(repository, tags)
  }
}

function githubRequestInit(token?: string): RequestInit {
  const headers: Record<string, string> = {
    accept: 'application/vnd.github+json',
    'user-agent': 'aur-maintainer'
  }

  if (token) headers.authorization = `Bearer ${token}`

  return { headers }
}

function parseRelease(repository: string, value: unknown): UpdateCandidate {
  if (!isRecord(value) || typeof value.tag_name !== 'string') {
    throw new Error(`GitHub release response for ${repository} has no tag_name`)
  }

  const tag = value.tag_name
  const version = tag.trim().replace(/^v(?=\d)/i, '')
  if (!/^\d+(?:\.\d+){1,3}(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(
      `GitHub release tag "${tag}" for ${repository} is not a supported version`
    )
  }

  return { version, metadata: { repository, tag } }
}

function parseLatestTag(repository: string, value: unknown): UpdateCandidate {
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
    .filter(({ version }) =>
      /^\d+(?:\.\d+){1,3}(?:[-+][0-9A-Za-z.-]+)?$/.test(version)
    )
    .toSorted((left, right) => compareVersions(left.version, right.version))

  const latest = candidates.at(-1)
  if (!latest) {
    throw new Error(
      `GitHub tags for ${repository} contain no supported versions`
    )
  }

  return {
    version: latest.version,
    metadata: { repository, tag: latest.name }
  }
}

function compareVersions(left: string, right: string): number {
  const parse = (value: string) => {
    const [withoutBuild] = value.split('+')
    const [core, ...prerelease] = withoutBuild.split('-')
    return {
      core: core.split('.').map(Number),
      prerelease
    }
  }

  const a = parse(left)
  const b = parse(right)

  for (
    let index = 0;
    index < Math.max(a.core.length, b.core.length);
    index += 1
  ) {
    const leftPart = a.core[index] ?? 0
    const rightPart = b.core[index] ?? 0
    if (leftPart !== rightPart) return leftPart - rightPart
  }

  if (a.prerelease.length === 0 && b.prerelease.length === 0) return 0
  if (a.prerelease.length === 0) return 1
  if (b.prerelease.length === 0) return -1

  for (
    let index = 0;
    index < Math.max(a.prerelease.length, b.prerelease.length);
    index += 1
  ) {
    const leftPart = a.prerelease[index]
    const rightPart = b.prerelease[index]
    if (leftPart === rightPart) continue
    if (leftPart === undefined) return -1
    if (rightPart === undefined) return 1

    const leftNumber = /^\\d+$/.test(leftPart)
    const rightNumber = /^\\d+$/.test(rightPart)
    if (leftNumber && rightNumber) {
      return Number(leftPart) - Number(rightPart)
    }
    if (leftNumber) return -1
    if (rightNumber) return 1
    return leftPart.localeCompare(rightPart)
  }

  return 0
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
