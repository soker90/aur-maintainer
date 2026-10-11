import { createHash } from 'node:crypto'
import type { Connector, ConnectorContext } from '../types.js'
import { isRecord } from '../../utils.js'
import { isSupportedPackageVersion } from '../../version.js'
import type { PackageDefinition, UpdateCandidate } from '../../types.js'

export function createNpmConnector(context: ConnectorContext): Connector {
  return {
    name: 'npm',
    async detect(
      _pkg: PackageDefinition,
      config: Record<string, unknown>
    ): Promise<UpdateCandidate> {
      const packageName = config.package
      if (
        typeof packageName !== 'string' ||
        !packageName.trim() ||
        packageName.trim() !== packageName
      ) {
        throw new Error(
          'npm connector requires config.package to be a package name'
        )
      }

      const encodedName = packageName.startsWith('@')
        ? packageName.replace('/', '%2f')
        : encodeURIComponent(packageName)
      const response = await context.fetch(
        `https://registry.npmjs.org/${encodedName}`,
        { headers: { accept: 'application/vnd.npm.install-v1+json' } }
      )
      if (!response.ok) {
        throw new Error(
          `npm registry request failed for ${packageName}: ${response.status} ${response.statusText}`
        )
      }

      const metadata = (await response.json()) as unknown
      if (!isRecord(metadata) || !isRecord(metadata['dist-tags'])) {
        throw new Error(
          `npm registry response for ${packageName} has no dist-tags`
        )
      }
      const version = metadata['dist-tags'].latest
      if (typeof version !== 'string' || !isSupportedPackageVersion(version)) {
        throw new Error(
          `npm latest dist-tag for ${packageName} is not a supported version`
        )
      }
      if (
        !isRecord(metadata.versions) ||
        !isRecord(metadata.versions[version])
      ) {
        throw new Error(
          `npm registry response for ${packageName} has no metadata for ${version}`
        )
      }
      const versionMetadata = metadata.versions[version]
      if (
        !isRecord(versionMetadata.dist) ||
        typeof versionMetadata.dist.tarball !== 'string'
      ) {
        throw new Error(
          `npm registry response for ${packageName}@${version} has no tarball URL`
        )
      }

      const tarballUrl = versionMetadata.dist.tarball
      const tarballResponse = await context.fetch(tarballUrl)
      if (!tarballResponse.ok) {
        throw new Error(
          `npm tarball request failed for ${packageName}@${version}: ${tarballResponse.status} ${tarballResponse.statusText}`
        )
      }
      const tarball = new Uint8Array(await tarballResponse.arrayBuffer())
      const sha256 = createHash('sha256').update(tarball).digest('hex')

      return {
        version,
        source: tarballUrl,
        sha256,
        metadata: { package: packageName, distTag: 'latest' }
      }
    }
  }
}
