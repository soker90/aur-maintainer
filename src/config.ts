import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { parse } from 'yaml'
import type {
  MaintainerConfig,
  PackageConfig,
  PackageConfigEntry
} from './types.js'

export const DEFAULT_PACKAGE_CONNECTOR_TIMEOUT = 30

export async function loadMaintainerConfig(
  workspace: string,
  configPath = '.aur-maintainer.yml'
): Promise<MaintainerConfig> {
  const filePath = path.resolve(workspace, configPath)
  try {
    const content = await readFile(filePath, 'utf8')
    return parseMaintainerConfig(parse(content), filePath)
  } catch (error) {
    if (isMissingFile(error)) return {}
    throw error
  }
}

export async function loadPackageConfig(
  packagePath: string,
  relativeConfigPath = 'update.yml'
): Promise<PackageConfig> {
  const filePath = path.join(packagePath, relativeConfigPath)
  const content = await readFile(filePath, 'utf8')
  return parsePackageConfig(parse(content), filePath)
}

export function parsePackageConfig(
  value: unknown,
  filePath: string
): PackageConfig {
  if (!isRecord(value))
    throw new Error(filePath + ' must contain a YAML object')
  if (typeof value.connector !== 'string' || value.connector.trim() === '') {
    throw new Error(filePath + ': "connector" is required')
  }
  if (value.config !== undefined && !isRecord(value.config)) {
    throw new Error(filePath + ': "config" must be an object')
  }
  if (value.timeout !== undefined && !isPositiveInteger(value.timeout)) {
    throw new Error(
      filePath + ': "timeout" must be a positive integer number of seconds'
    )
  }
  if (value.updates !== undefined && !isRecord(value.updates)) {
    throw new Error(filePath + ': "updates" must be an object')
  }

  const updates = (value.updates as Record<string, unknown> | undefined) ?? {}
  for (const [key, template] of Object.entries(updates)) {
    if (!['source', 'sha256'].includes(key)) {
      throw new Error(filePath + ': "updates.' + key + '" is not supported')
    }
    if (typeof template !== 'string' || template.trim() === '') {
      throw new Error(
        filePath + ': "updates.' + key + '" must be a non-empty string'
      )
    }
  }

  return {
    connector: value.connector,
    config: (value.config as Record<string, unknown> | undefined) ?? {},
    updates: updates as PackageConfig['updates'],
    timeout:
      (value.timeout as number | undefined) ??
      DEFAULT_PACKAGE_CONNECTOR_TIMEOUT
  }
}

function parseMaintainerConfig(
  value: unknown,
  filePath: string
): MaintainerConfig {
  if (value === null || value === undefined) return {}
  if (!isRecord(value))
    throw new Error(filePath + ' must contain a YAML object')
  if (value.packages !== undefined && !Array.isArray(value.packages)) {
    throw new Error(filePath + ': "packages" must be an array')
  }

  const packages = (value.packages as unknown[] | undefined)?.map(
    (entry, index) => {
      if (typeof entry === 'string') return entry
      if (!isRecord(entry)) {
        throw new Error(
          filePath +
            ': "packages[' +
            index +
            ']" must be a path string or object'
        )
      }
      if (typeof entry.path !== 'string' || entry.path.trim() === '') {
        throw new Error(
          filePath + ': "packages[' + index + '].path" is required'
        )
      }
      const config = parsePackageConfig(
        entry,
        filePath + ':packages[' + index + ']'
      )
      return { path: entry.path, ...config } as PackageConfigEntry
    }
  )

  return { packages }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
}

function isMissingFile(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'ENOENT'
  )
}
