import { readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import type { PackageDefinition } from './types.js'
import type {
  Connector,
  ConnectorContext,
  ConnectorFactory
} from './connectors/types.js'
import { PACKAGE_LOCAL_CONNECTOR } from './connectors/types.js'
import { createGithubReleaseConnector } from './connectors/github-release/index.js'
import { createGithubTagConnector } from './connectors/github-tag/index.js'
import { createNpmConnector } from './connectors/npm/index.js'
import { createPipConnector } from './connectors/pip/index.js'
import { createGitConnector } from './connectors/git/index.js'
import { createCustomConnector } from './connectors/custom/index.js'

export * from './connectors/types.js'
export { fetchLatestGithubTag } from './connectors/github-utils.js'

export function createConnectorRegistry(
  context: ConnectorContext
): Map<string, ConnectorFactory> {
  return new Map<string, ConnectorFactory>([
    ['github-release', () => createGithubReleaseConnector(context)],
    ['github-tag', () => createGithubTagConnector(context)],
    ['npm', () => createNpmConnector(context)],
    ['pip', () => createPipConnector(context)],
    ['git', () => createGitConnector(context)]
  ])
}

export async function loadRepositoryConnectors(
  workspace: string,
  context: ConnectorContext
): Promise<Map<string, ConnectorFactory>> {
  const registry = createConnectorRegistry(context)
  const directory = path.resolve(workspace, 'connectors')

  if (!(await isDirectory(directory))) return registry

  const entries = await readdir(directory, { withFileTypes: true })

  for (const entry of entries.toSorted((left, right) =>
    left.name.localeCompare(right.name)
  )) {
    if (!entry.isDirectory()) continue

    const name = entry.name
    if (registry.has(name)) {
      throw new Error(
        `Repository connector "${name}" conflicts with a built-in connector`
      )
    }

    const modulePath = path.join(directory, name, 'index.js')
    if (!(await isFile(modulePath))) {
      throw new Error(
        `Repository connector "${name}" must provide connectors/${name}/index.js`
      )
    }

    const factory = await loadConnectorFactory(modulePath, name, context)
    registry.set(name, factory)
  }

  return registry
}

export function loadPackageConnector(pkg: PackageDefinition): ConnectorFactory {
  if (pkg.config.connector !== PACKAGE_LOCAL_CONNECTOR) {
    throw new Error(
      `Package connector "${pkg.config.connector}" is not a package-local custom connector`
    )
  }

  return () => createCustomConnector(pkg)
}

async function loadConnectorFactory(
  modulePath: string,
  name: string,
  context: ConnectorContext
): Promise<ConnectorFactory> {
  const module = (await import(pathToFileURL(modulePath).href)) as {
    default?: unknown
  }

  if (typeof module.default !== 'function') {
    throw new Error(
      `Repository connector "${name}" must default-export a connector factory`
    )
  }

  const factory = module.default as ConnectorFactory
  const connector = factory(context)

  if (!isConnector(connector) || connector.name !== name) {
    throw new Error(
      `Repository connector "${name}" factory must return a connector named "${name}"`
    )
  }

  return factory
}

function isConnector(value: unknown): value is Connector {
  return (
    typeof value === 'object' &&
    value !== null &&
    'name' in value &&
    typeof value.name === 'string' &&
    'detect' in value &&
    typeof value.detect === 'function'
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
