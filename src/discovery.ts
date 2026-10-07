import { readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { loadPackageConfig } from './config.js'
import type {
  MaintainerConfig,
  PackageConfig,
  PackageConfigEntry,
  PackageDefinition
} from './types.js'

export async function discoverPackages(
  workspace: string,
  config: MaintainerConfig
): Promise<PackageDefinition[]> {
  const packageEntries =
    config.packages?.map((entry) =>
      typeof entry === 'string' ? { path: entry } : entry
    ) ??
    (await findDefaultPackagePaths(workspace)).map((packagePath) => ({
      path: packagePath
    }))

  const packages = await Promise.all(
    packageEntries.map((entry) => discoverPackage(workspace, entry))
  )
  return packages.toSorted((left, right) => left.name.localeCompare(right.name))
}

async function findDefaultPackagePaths(workspace: string): Promise<string[]> {
  const candidates: string[] = []
  if (await isPackageDirectory(workspace)) candidates.push(workspace)
  const packagesDirectory = path.join(workspace, 'packages')
  if (await isDirectory(packagesDirectory)) {
    const entries = await readdir(packagesDirectory, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.isDirectory()) {
        candidates.push(path.join(packagesDirectory, entry.name))
      }
    }
  }
  return candidates
}

async function discoverPackage(
  workspace: string,
  entry: { path: string } | PackageConfigEntry
): Promise<PackageDefinition> {
  const packagePath = path.resolve(workspace, entry.path)
  if (!isWithinWorkspace(packagePath, workspace)) {
    throw new Error('Package path is outside the workspace: ' + packagePath)
  }

  const pkgbuildPath = path.join(packagePath, 'PKGBUILD')
  if (!(await isFile(pkgbuildPath))) {
    throw new Error('Package directory has no PKGBUILD: ' + packagePath)
  }

  const updateConfigPath =
    'connector' in entry
      ? path.join(workspace, '.aur-maintainer.yml')
      : await findLegacyUpdateConfigPath(packagePath)

  const config: PackageConfig =
    'connector' in entry
      ? {
          connector: entry.connector,
          config: entry.config,
          updates: entry.updates,
          timeout: entry.timeout
        }
      : await loadPackageConfig(
          packagePath,
          path.relative(packagePath, updateConfigPath)
        )

  return {
    name: path.basename(packagePath),
    path: packagePath,
    pkgbuildPath,
    srcinfoPath: path.join(packagePath, '.SRCINFO'),
    updateConfigPath,
    config
  }
}

async function loadLegacyPackageConfig(
  packagePath: string
): Promise<PackageConfig> {
  const connectorDirectory = path.join(packagePath, 'connector')
  if (await isFile(path.join(connectorDirectory, 'update.yml'))) {
    return loadPackageConfig(packagePath, 'connector/update.yml')
  }
  return loadPackageConfig(packagePath)
}

async function findLegacyUpdateConfigPath(
  packagePath: string
): Promise<string> {
  const rootConfigPath = path.join(packagePath, 'update.yml')
  const connectorDirectory = path.join(packagePath, 'connector')
  const connectorConfigPath = path.join(connectorDirectory, 'update.yml')
  if (await isFile(connectorConfigPath)) {
    if (await isFile(rootConfigPath)) {
      throw new Error(
        'Package "' +
          path.basename(packagePath) +
          '" must not define both update.yml and connector/update.yml'
      )
    }
    return connectorConfigPath
  }
  if (await isDirectory(connectorDirectory)) {
    throw new Error(
      'Package "' +
        path.basename(packagePath) +
        '" has connector/ but no connector/update.yml'
    )
  }
  return rootConfigPath
}

async function isPackageDirectory(directory: string): Promise<boolean> {
  return (
    (await isDirectory(directory)) &&
    (await isFile(path.join(directory, 'PKGBUILD')))
  )
}

async function isDirectory(filePath: string): Promise<boolean> {
  try {
    return (await stat(filePath)).isDirectory()
  } catch {
    return false
  }
}

async function isFile(filePath: string): Promise<boolean> {
  try {
    return (await stat(filePath)).isFile()
  } catch {
    return false
  }
}

function isWithinWorkspace(packagePath: string, workspace: string): boolean {
  const relative = path.relative(workspace, packagePath)
  return (
    relative === '' ||
    (!relative.startsWith('..') && !path.isAbsolute(relative))
  )
}
