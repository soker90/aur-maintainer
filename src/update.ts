import { readFile, writeFile } from 'node:fs/promises'
import type { PackageDefinition, UpdateCandidate } from './types.js'
import { assertSupportedPackageVersion } from './version.js'

export interface PackageUpdateResult {
  changed: boolean
  currentVersion: string
  version: string
}

export async function updatePackage(
  pkg: PackageDefinition,
  candidate: UpdateCandidate
): Promise<PackageUpdateResult> {
  const content = await readFile(pkg.pkgbuildPath, 'utf8')
  const currentVersion = readPkgver(content)

  if (currentVersion === candidate.version) {
    return { changed: false, currentVersion, version: candidate.version }
  }

  const updated = replacePkgver(content, candidate.version)
  await writeFile(pkg.pkgbuildPath, updated)
  return { changed: true, currentVersion, version: candidate.version }
}

export async function rollbackPackageUpdate(
  pkg: PackageDefinition,
  result: PackageUpdateResult
): Promise<void> {
  if (!result.changed) return

  const content = await readFile(pkg.pkgbuildPath, 'utf8')
  if (readPkgver(content) !== result.version) return

  await writeFile(
    pkg.pkgbuildPath,
    replacePkgver(content, result.currentVersion)
  )
}

export function readPkgver(content: string): string {
  const matches = [...content.matchAll(/^pkgver=([^\n\r]+)$/gm)]
  if (matches.length !== 1) {
    throw new Error(
      'PKGBUILD must contain exactly one simple pkgver assignment (found ' +
        matches.length +
        ')'
    )
  }
  const version = matches[0]?.[1]?.trim()
  if (!version) throw new Error('PKGBUILD pkgver assignment is empty')
  return version
}

export function replacePkgver(content: string, version: string): string {
  assertSupportedPackageVersion(version)
  const matches = [...content.matchAll(/^pkgver=([^\n\r]+)$/gm)]
  if (matches.length !== 1) {
    throw new Error(
      'PKGBUILD must contain exactly one simple pkgver assignment (found ' +
        matches.length +
        ')'
    )
  }
  return content.replace(/^pkgver=[^\n\r]+$/m, 'pkgver=' + version)
}
