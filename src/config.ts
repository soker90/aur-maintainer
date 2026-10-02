import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { parse } from 'yaml'
import type { MaintainerConfig, PackageConfig } from './types.js'

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
  packagePath: string
): Promise<PackageConfig> {
  const filePath = path.join(packagePath, 'update.yml')
  const content = await readFile(filePath, 'utf8')
  return parsePackageConfig(parse(content), filePath)
}

function parseMaintainerConfig(
  value: unknown,
  filePath: string
): MaintainerConfig {
  if (value === null || value === undefined) return {}
  if (!isRecord(value)) {
    throw new Error(`${filePath} must contain a YAML object`)
  }

  if (value.packages !== undefined && !isStringArray(value.packages)) {
    throw new Error(`${filePath}: "packages" must be an array of paths`)
  }

  return {
    packages: value.packages as string[] | undefined
  }
}

function parsePackageConfig(value: unknown, filePath: string): PackageConfig {
  if (!isRecord(value)) {
    throw new Error(`${filePath} must contain a YAML object`)
  }

  if (typeof value.connector !== 'string' || value.connector.trim() === '') {
    throw new Error(`${filePath}: "connector" is required`)
  }

  if (value.config !== undefined && !isRecord(value.config)) {
    throw new Error(`${filePath}: "config" must be an object`)
  }

  return {
    connector: value.connector,
    config: (value.config as Record<string, unknown> | undefined) ?? {}
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

function isMissingFile(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === 'ENOENT'
  )
}
