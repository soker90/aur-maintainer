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
}

export function createConnectorRegistry(
  context: ConnectorContext
): Map<string, ConnectorFactory> {
  return new Map([
    ['github-release', () => new GithubReleaseConnector(context)]
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
      {
        headers: {
          accept: 'application/vnd.github+json',
          'user-agent': 'aur-maintainer'
        }
      }
    )

    if (!response.ok) {
      throw new Error(
        `GitHub Releases request failed for ${repository}: ${response.status} ${response.statusText}`
      )
    }

    return parseRelease(repository, (await response.json()) as unknown)
  }
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
