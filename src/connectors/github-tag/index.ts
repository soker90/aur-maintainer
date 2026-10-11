import type { Connector, ConnectorContext } from '../types.js'
import { fetchLatestGithubTag } from '../github-utils.js'
import type { PackageDefinition, UpdateCandidate } from '../../types.js'

export function createGithubTagConnector(context: ConnectorContext): Connector {
  return {
    name: 'github-tag',
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
          'github-tag connector requires config.repository in owner/name form'
        )
      }

      const { version, tag } = await fetchLatestGithubTag(context, repository)
      return {
        version,
        metadata: { repository, tag }
      }
    }
  }
}
