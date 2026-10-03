import { readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import type { PackageDefinition, UpdateCandidate } from './types.js'
import { comparePackageVersions, isSupportedPackageVersion } from './version.js'

export interface Connector {
  readonly name: string
  detect(
    pkg: PackageDefinition,
    config: Record<string, unknown>
  ): Promise<UpdateCandidate>
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

    const factory = await loadConnectorFactory(modulePath, name)
    registry.set(name, factory)
  }

  return registry
}

async function loadConnectorFactory(
  modulePath: string,
  name: string
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
  const connector = factory({
    fetch,
    token: undefined
  })

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

    const response = await this.context.fetch(
      `https://api.github.com/repos/${repository}/releases/latest`,
      githubRequestInit(this.context.token)
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
      const response = await this.context.fetch(
        `https://api.github.com/repos/${repository}/tags?per_page=100&page=${page}`,
        githubRequestInit(this.context.token)
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
