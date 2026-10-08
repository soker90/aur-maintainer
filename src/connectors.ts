import { execFile as execFileCallback } from 'node:child_process'
import { readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { pathToFileURL } from 'node:url'
import { DEFAULT_PACKAGE_CONNECTOR_TIMEOUT } from './config.js'
import type { PackageDefinition, UpdateCandidate } from './types.js'
import { comparePackageVersions, isSupportedPackageVersion } from './version.js'

const execFile = promisify(execFileCallback)

export interface Connector {
  readonly name: string
  detect(
    pkg: PackageDefinition,
    config: Record<string, unknown>
  ): Promise<UpdateCandidate>
}

export const PACKAGE_LOCAL_CONNECTOR = 'custom' as const

export interface PackageLocalConnectorOutput {
  version: string
  source: string
  sha256: string
}

export interface ConnectorContext {
  fetch(input: string | URL, init?: RequestInit): Promise<Response>
  token?: string
}

export type ConnectorFactory = (context: ConnectorContext) => Connector

export function createConnectorRegistry(
  context: ConnectorContext
): Map<string, ConnectorFactory> {
  return new Map<string, ConnectorFactory>([
    ['github-release', () => new GithubReleaseConnector(context)],
    ['github-tag', () => new GithubTagConnector(context)]
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
  if (pkg.config.connector !== 'custom') {
    throw new Error(
      `Package connector "${pkg.config.connector}" is not a package-local custom connector`
    )
  }

  const scriptPath = path.join(pkg.path, 'connector', 'detect.sh')
  return () => ({
    name: 'custom',
    detect: async () => detectWithScript(pkg, scriptPath)
  })
}

async function detectWithScript(
  pkg: PackageDefinition,
  scriptPath: string
): Promise<UpdateCandidate> {
  if (!(await isFile(scriptPath))) {
    throw new Error(
      `Package "${pkg.name}" custom connector must provide connector/detect.sh`
    )
  }

  let result: { stdout: string }
  try {
    result = await execFile('bash', [scriptPath], {
      cwd: pkg.path,
      timeout: (pkg.config.timeout ?? DEFAULT_PACKAGE_CONNECTOR_TIMEOUT) * 1000,
      killSignal: 'SIGTERM',
      env: {
        ...process.env,
        AUR_MAINTAINER_PACKAGE: pkg.name,
        AUR_MAINTAINER_PACKAGE_PATH: pkg.path,
        AUR_MAINTAINER_CONFIG_JSON: JSON.stringify(pkg.config.config)
      }
    })
  } catch (error) {
    if (isTimeoutError(error)) {
      throw new Error(
        `Package "${pkg.name}" custom connector timed out after ${
          pkg.config.timeout ?? DEFAULT_PACKAGE_CONNECTOR_TIMEOUT
        } seconds`,
        { cause: error }
      )
    }
    throw error
  }

  return parseCustomConnectorOutput(pkg.name, result.stdout)
}

function isTimeoutError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false

  const candidate = error as {
    code?: unknown
    killed?: unknown
    signal?: unknown
  }

  if (candidate.code === 'ETIMEDOUT') return true
  return candidate.killed === true && candidate.signal === 'SIGTERM'
}
function parseCustomConnectorOutput(
  packageName: string,
  output: string
): UpdateCandidate {
  const values = new Map<string, string>()
  for (const line of output.split(/\r?\n/)) {
    if (!line.trim()) continue
    const separator = line.indexOf('=')
    if (separator <= 0) {
      throw new Error(
        `Package "${packageName}" custom connector produced an invalid output line`
      )
    }

    const key = line.slice(0, separator)
    const value = line.slice(separator + 1)
    if (!['version', 'source', 'sha256'].includes(key)) {
      throw new Error(
        `Package "${packageName}" custom connector produced unknown output "${key}"`
      )
    }
    if (values.has(key)) {
      throw new Error(
        `Package "${packageName}" custom connector produced duplicate output "${key}"`
      )
    }
    if (!value) {
      throw new Error(
        `Package "${packageName}" custom connector produced an empty "${key}"`
      )
    }
    values.set(key, value)
  }

  const version = values.get('version')
  const source = values.get('source')
  const sha256 = values.get('sha256')
  if (!version || !source || !sha256) {
    throw new Error(
      `Package "${packageName}" custom connector must output version, source and sha256`
    )
  }

  const result: PackageLocalConnectorOutput = { version, source, sha256 }
  return result
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

class GithubReleaseConnector implements Connector {
  readonly name = 'github-release'

  constructor(private readonly context: ConnectorContext) {}

  async detect(
    _pkg: PackageDefinition,
    config: Record<string, unknown>
  ): Promise<UpdateCandidate> {
    const repository = config.repository
    if (
      typeof repository !== 'string' ||
      repository.split('/').length !== 2 ||
      repository.split('/').some((part) => !part)
    ) {
      throw new Error(
        'github-release connector requires config.repository in owner/name form'
      )
    }

    const response = await fetchGithub(
      this.context,
      `https://api.github.com/repos/${repository}/releases/latest`
    )

    if (!response.ok) {
      throw new Error(
        `GitHub Releases request failed for ${repository}: ${response.status} ${response.statusText}`
      )
    }

    return parseRelease(repository, (await response.json()) as unknown)
  }
}

class GithubTagConnector implements Connector {
  readonly name = 'github-tag'

  constructor(private readonly context: ConnectorContext) {}

  async detect(
    _pkg: PackageDefinition,
    config: Record<string, unknown>
  ): Promise<UpdateCandidate> {
    const repository = config.repository
    if (
      typeof repository !== 'string' ||
      repository.split('/').length !== 2 ||
      repository.split('/').some((part) => !part)
    ) {
      throw new Error(
        'github-tag connector requires config.repository in owner/name form'
      )
    }

    const tags = []
    let page = 1

    while (true) {
      const response = await fetchGithub(
        this.context,
        `https://api.github.com/repos/${repository}/tags?per_page=100&page=${page}`
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
      page += 1
    }

    return parseLatestTag(repository, tags)
  }
}

async function fetchGithub(
  context: ConnectorContext,
  url: string
): Promise<Response> {
  return context.fetch(url, githubRequestInit(context.token))
}

function githubRequestInit(token?: string): RequestInit {
  const headers: Record<string, string> = {
    accept: 'application/vnd.github+json',
    'user-agent': 'aur-maintainer',
    'x-github-api-version': '2026-03-10'
  }

  if (token) headers.authorization = `Bearer ${token}`

  return { headers }
}

function parseRelease(repository: string, value: unknown): UpdateCandidate {
  if (!isRecord(value) || typeof value.tag_name !== 'string') {
    throw new Error(`GitHub release response for ${repository} has no tag_name`)
  }

  const tag = value.tag_name
  const version = tag.trim().replace(/^v(?=\d)/i, '')
  if (!isSupportedPackageVersion(version)) {
    throw new Error(
      `GitHub release tag "${tag}" for ${repository} is not a supported version`
    )
  }

  return { version, metadata: { repository, tag } }
}

function parseLatestTag(repository: string, value: unknown): UpdateCandidate {
  if (!Array.isArray(value)) {
    throw new Error(`GitHub tags response for ${repository} is not an array`)
  }

  const candidates = value
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

  return {
    version: latest.version,
    metadata: { repository, tag: latest.name }
  }
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
