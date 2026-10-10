import { readFile, writeFile } from 'node:fs/promises'
import type {
  PackageConfig,
  PackageDefinition,
  UpdateCandidate
} from './types.js'
import { assertSupportedPackageVersion } from './version.js'

export interface PackageUpdateResult {
  changed: boolean
  currentVersion: string
  version: string
  previousPkgbuild?: string
}

export async function updatePackage(
  pkg: PackageDefinition,
  candidate: UpdateCandidate
): Promise<PackageUpdateResult> {
  const content = await readFile(pkg.pkgbuildPath, 'utf8')
  const currentVersion = readPkgver(content)
  const updated = applyPackageUpdates(content, pkg.config.updates, candidate)

  if (updated === content) {
    return { changed: false, currentVersion, version: candidate.version }
  }

  await writeFile(pkg.pkgbuildPath, updated)
  return {
    changed: true,
    currentVersion,
    version: candidate.version,
    previousPkgbuild: content
  }
}

export async function rollbackPackageUpdate(
  pkg: PackageDefinition,
  result: PackageUpdateResult
): Promise<void> {
  if (!result.changed) return

  if (result.previousPkgbuild !== undefined) {
    await writeFile(pkg.pkgbuildPath, result.previousPkgbuild)
    return
  }

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

export function applyPackageUpdates(
  content: string,
  updates: PackageConfig['updates'],
  candidate: UpdateCandidate
): string {
  const fields = {
    version: candidate.version,
    source: candidate.source,
    sha256: candidate.sha256
  }

  let updated = replaceAssignment(
    content,
    'pkgver',
    `pkgver=${candidate.version}`
  )
  for (const field of ['version', 'source', 'sha256'] as const) {
    const template = updates[field]
    const value = field === 'version' ? candidate.version : fields[field]
    if (template === undefined || value === undefined) continue
    const rendered = renderUpdateTemplate(template, {
      version: candidate.version,
      source: candidate.source,
      sha256: candidate.sha256
    })
    const assignment = rendered.match(/^([A-Za-z_][A-Za-z0-9_]*)=/)?.[1]
    if (!assignment) {
      throw new Error(
        `Package update template for "${field}" must start with a PKGBUILD assignment`
      )
    }
    updated = replaceAssignment(updated, assignment, rendered)
  }

  return updated
}

function renderUpdateTemplate(
  template: string,
  values: Record<'version' | 'source' | 'sha256', string | undefined>
): string {
  return template.replace(
    /\$\{(version|source|sha256)\}/g,
    (_, key: 'version' | 'source' | 'sha256') => values[key] ?? ''
  )
}

function replaceAssignment(
  content: string,
  name: string,
  replacement: string
): string {
  const pattern = new RegExp(`^${name}=.*$`, 'm')
  const matches = content.match(pattern)
  if (!matches) {
    throw new Error(`PKGBUILD must contain a "${name}" assignment`)
  }
  return content.replace(pattern, replacement)
}
