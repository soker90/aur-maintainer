import type { Connector, ConnectorContext } from '../types.js'
import { fetchGithub } from '../github-utils.js'
import { isRecord } from '../../utils.js'
import { isSupportedPackageVersion } from '../../version.js'
import type { PackageDefinition, UpdateCandidate } from '../../types.js'

export function createGithubReleaseConnector(
  context: ConnectorContext
): Connector {
  return {
    name: 'github-release',
    async detect(
      _pkg: PackageDefinition,
      config: Record<string, unknown>
    ): Promise<UpdateCandidate> {
      const repository = config.repository
      if (
        typeof repository !== 'string' ||
        repository.split('/').length !== 2 ||
        repository.split('/').some((part) => !part)
      ) {
        throw new Error(
          'github-release connector requires config.repository in owner/name form'
        )
      }

      const response = await fetchGithub(
        context,
        `https://api.github.com/repos/${repository}/releases/latest`
      )

      if (!response.ok) {
        throw new Error(
          `GitHub Releases request failed for ${repository}: ${response.status} ${response.statusText}`
        )
      }

      return parseRelease(repository, (await response.json()) as unknown)
    }
  }
}

function parseRelease(repository: string, value: unknown): UpdateCandidate {
  if (!isRecord(value) || typeof value.tag_name !== 'string') {
    throw new Error(`GitHub release response for ${repository} has no tag_name`)
  }

  const tag = value.tag_name
  const version = tag.trim().replace(/^v(?=\d)/i, '')
  if (!isSupportedPackageVersion(version)) {
    throw new Error(
      `GitHub release tag "${tag}" for ${repository} is not a supported version`
    )
  }

  return { version, metadata: { repository, tag } }
}
