import { createHash } from 'node:crypto'
import type { Connector, ConnectorContext } from '../types.js'
import { fetchLatestGithubTag } from '../github-utils.js'
import type { PackageDefinition, UpdateCandidate } from '../../types.js'

export function createGitConnector(context: ConnectorContext): Connector {
  return {
    name: 'git',
    async detect(
      _pkg: PackageDefinition,
      config: Record<string, unknown>
    ): Promise<UpdateCandidate> {
      const repository = config.repository
      if (
        typeof repository !== 'string' ||
        !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)
      ) {
        throw new Error(
          'git connector requires config.repository in GitHub owner/name form'
        )
      }

      const latest = await fetchLatestGithubTag(context, repository)
      const source = `https://github.com/${repository}/archive/refs/tags/${encodeURIComponent(
        latest.tag
      )}.tar.gz`
      const archive = await context.fetch(source)
      if (!archive.ok) {
        throw new Error(
          `Git source download failed for ${repository}@${latest.tag}: ${archive.status} ${archive.statusText}`
        )
      }
      const sha256 = createHash('sha256')
        .update(new Uint8Array(await archive.arrayBuffer()))
        .digest('hex')

      return {
        version: latest.version,
        source,
        sha256,
        metadata: { repository, tag: latest.tag }
      }
    }
  }
}
