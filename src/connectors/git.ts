import { createHash } from 'node:crypto'
import type { Connector, ConnectorContext } from '../connectors.js'
import {
  comparePackageVersions,
  isSupportedPackageVersion
} from '../version.js'
import type { PackageDefinition, UpdateCandidate } from '../types.js'

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

      const tags: unknown[] = []
      for (let page = 1; ; page += 1) {
        const headers: Record<string, string> = {
          accept: 'application/vnd.github+json',
          'user-agent': 'aur-maintainer',
          'x-github-api-version': '2026-03-10'
        }
        if (context.token) headers.authorization = `Bearer ${context.token}`
        const response = await context.fetch(
          `https://api.github.com/repos/${repository}/tags?per_page=100&page=${page}`,
          { headers }
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
      }

      const candidates = tags
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

      const source = `https://github.com/${repository}/archive/refs/tags/${encodeURIComponent(
        latest.name
      )}.tar.gz`
      const archive = await context.fetch(source)
      if (!archive.ok) {
        throw new Error(
          `Git source download failed for ${repository}@${latest.name}: ${archive.status} ${archive.statusText}`
        )
      }
      const sha256 = createHash('sha256')
        .update(new Uint8Array(await archive.arrayBuffer()))
        .digest('hex')

      return {
        version: latest.version,
        source,
        sha256,
        metadata: { repository, tag: latest.name }
      }
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
