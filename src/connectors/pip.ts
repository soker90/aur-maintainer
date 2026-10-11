import { createHash } from 'node:crypto'
import type { Connector, ConnectorContext } from '../connectors.js'
import { isSupportedPackageVersion } from '../version.js'
import type { PackageDefinition, UpdateCandidate } from '../types.js'

export function createPipConnector(context: ConnectorContext): Connector {
  return {
    name: 'pip',
    async detect(
      _pkg: PackageDefinition,
      config: Record<string, unknown>
    ): Promise<UpdateCandidate> {
      const packageName = config.package
      if (
        typeof packageName !== 'string' ||
        !/^[A-Za-z0-9._-]+$/.test(packageName)
      ) {
        throw new Error(
          'pip connector requires config.package to be a PyPI project name'
        )
      }

      const response = await context.fetch(
        `https://pypi.org/pypi/${encodeURIComponent(packageName)}/json`,
        { headers: { accept: 'application/json' } }
      )
      if (!response.ok) {
        throw new Error(
          `PyPI request failed for ${packageName}: ${response.status} ${response.statusText}`
        )
      }

      const metadata = (await response.json()) as unknown
      if (!isRecord(metadata) || !isRecord(metadata.info)) {
        throw new Error(`PyPI metadata for ${packageName} is invalid`)
      }
      const version = metadata.info.version
      if (typeof version !== 'string' || !isSupportedPackageVersion(version)) {
        throw new Error(
          `PyPI latest version for ${packageName} is not a supported version`
        )
      }
      if (!isRecord(metadata.releases)) {
        throw new Error(`PyPI metadata for ${packageName} has no releases`)
      }
      const releases = metadata.releases[version]
      if (!Array.isArray(releases)) {
        throw new Error(
          `PyPI metadata for ${packageName}@${version} has no release files`
        )
      }

      const sourceFile = releases.find(
        (file: unknown) =>
          isRecord(file) &&
          file.packagetype === 'sdist' &&
          typeof file.url === 'string'
      )
      if (!isRecord(sourceFile) || typeof sourceFile.url !== 'string') {
        throw new Error(
          `PyPI release ${packageName}@${version} has no source distribution`
        )
      }

      let sha256: unknown = isRecord(sourceFile.digests)
        ? sourceFile.digests.sha256
        : undefined
      if (typeof sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(sha256)) {
        const archive = await context.fetch(sourceFile.url)
        if (!archive.ok) {
          throw new Error(
            `PyPI source download failed for ${packageName}@${version}: ${archive.status} ${archive.statusText}`
          )
        }
        sha256 = createHash('sha256')
          .update(new Uint8Array(await archive.arrayBuffer()))
          .digest('hex')
      }

      return {
        version,
        source: sourceFile.url,
        sha256,
        metadata: { package: packageName, registry: 'pypi' }
      }
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
