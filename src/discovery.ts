import { access, readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { loadPackageConfig } from './config.js'
import type { MaintainerConfig, PackageDefinition } from './types.js'

export async function discoverPackages(
  workspace: string,
  config: MaintainerConfig
): Promise<PackageDefinition[]> {
  const packagePaths =
    config.packages?.map((packagePath) =>
      path.resolve(workspace, packagePath)
    ) ?? (await findDefaultPackagePaths(workspace))

  const packages = await Promise.all(
    packagePaths.map((packagePath) => discoverPackage(packagePath, workspace))
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
  packagePath: string,
  workspace: string
): Promise<PackageDefinition> {
  if (!isWithinWorkspace(packagePath, workspace)) {
    throw new Error(`Package path is outside the workspace: ${packagePath}`)
  }

  const pkgbuildPath = path.join(packagePath, 'PKGBUILD')
  if (!(await isFile(pkgbuildPath))) {
    throw new Error(`Package directory has no PKGBUILD: ${packagePath}`)
  }

  const config = await loadPackageConfig(packagePath)
  const name = path.basename(packagePath)

  return {
    name,
    path: packagePath,
    pkgbuildPath,
    srcinfoPath: path.join(packagePath, '.SRCINFO'),
    updateConfigPath: path.join(packagePath, 'update.yml'),
    config
  }
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
