import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, describe, expect, it, jest } from '@jest/globals'
import {
  createConnectorRegistry,
  loadPackageConnector,
  loadRepositoryConnectors
} from '../src/connectors.js'

const temporaryWorkspaces: string[] = []

const pkg = {
  name: 'example-bin',
  path: '/workspace/example-bin',
  pkgbuildPath: '/workspace/example-bin/PKGBUILD',
  srcinfoPath: '/workspace/example-bin/.SRCINFO',
  updateConfigPath: '/workspace/example-bin/update.yml',
  config: { connector: 'github-release', config: {}, updates: {} }
}

afterEach(async () => {
  for (const workspace of temporaryWorkspaces.splice(0)) {
    await rm(workspace, { recursive: true, force: true })
  }
})

async function createConnectorWorkspace(): Promise<string> {
  const workspace = await mkdtemp(path.join(process.cwd(), '.aur-connectors-'))
  temporaryWorkspaces.push(workspace)
  await writeFile(
    path.join(workspace, 'package.json'),
    JSON.stringify({ type: 'module' })
  )
  return workspace
}

function response(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init
  })
}

describe('github-release connector', () => {
  it('normalizes a v-prefixed release version', async () => {
    const fetchMock = jest.fn(async () => response({ tag_name: 'v1.4.3' }))
    const connector = createConnectorRegistry({
      fetch: fetchMock,
      token: 'test-token'
    }).get('github-release')!({})

    await expect(
      connector.detect(pkg, { repository: 'stacklok/toolhive-studio' })
    ).resolves.toMatchObject({ version: '1.4.3' })

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.github.com/repos/stacklok/toolhive-studio/releases/latest',
      expect.objectContaining({
        headers: expect.objectContaining({
          accept: 'application/vnd.github+json',
          authorization: 'Bearer test-token',
          'x-github-api-version': '2026-03-10'
        })
      })
    )
  })

  it('accepts Arch-compatible alphanumeric versions', async () => {
    const fetchMock = jest.fn(async () => response({ tag_name: 'v1.2.3alpha' }))
    const connector = createConnectorRegistry({ fetch: fetchMock }).get(
      'github-release'
    )!({})

    await expect(
      connector.detect(pkg, { repository: 'owner/project' })
    ).resolves.toMatchObject({ version: '1.2.3alpha' })
  })

  it('accepts unprefixed versions', async () => {
    const fetchMock = jest.fn(async () => response({ tag_name: '2026_10' }))
    const connector = createConnectorRegistry({ fetch: fetchMock }).get(
      'github-release'
    )!({})
    await expect(
      connector.detect(pkg, { repository: 'owner/project' })
    ).resolves.toMatchObject({ version: '2026_10' })
  })

  it('rejects malformed repository configuration', async () => {
    const connector = createConnectorRegistry({ fetch: jest.fn() }).get(
      'github-release'
    )!({})
    await expect(
      connector.detect(pkg, { repository: 'invalid' })
    ).rejects.toThrow('owner/name form')
  })

  it('reports GitHub API errors', async () => {
    const fetchMock = jest.fn(async () =>
      response({}, { status: 404, statusText: 'Not Found' })
    )
    const connector = createConnectorRegistry({ fetch: fetchMock }).get(
      'github-release'
    )!({})
    await expect(
      connector.detect(pkg, { repository: 'owner/project' })
    ).rejects.toThrow('404 Not Found')
  })

  it('rejects unusable release tags', async () => {
    const fetchMock = jest.fn(async () =>
      response({ tag_name: 'release-latest' })
    )
    const connector = createConnectorRegistry({ fetch: fetchMock }).get(
      'github-release'
    )!({})
    await expect(
      connector.detect(pkg, { repository: 'owner/project' })
    ).rejects.toThrow('not a supported version')
  })
})

describe('github-tag connector', () => {
  it('selects the highest supported tag', async () => {
    const fetchMock = jest.fn(async () =>
      response([
        { name: 'v1.2.0' },
        { name: '1.10.0' },
        { name: 'release' },
        { name: '1.9.9' },
        { name: '1.10.0alpha.1' },
        { name: '1.10.0+build.1' }
      ])
    )
    const connector = createConnectorRegistry({
      fetch: fetchMock,
      token: 'test-token'
    }).get('github-tag')!({})

    await expect(
      connector.detect(pkg, { repository: 'owner/project' })
    ).resolves.toMatchObject({
      version: '1.10.0+build.1',
      metadata: { tag: '1.10.0+build.1' }
    })

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.github.com/repos/owner/project/tags?per_page=100&page=1',
      expect.objectContaining({
        headers: expect.objectContaining({
          authorization: 'Bearer test-token',
          'x-github-api-version': '2026-03-10'
        })
      })
    )
  })

  it('selects a valid alphanumeric version over an alpha release', async () => {
    const fetchMock = jest.fn(async () =>
      response([{ name: '1.10.0alpha' }, { name: '1.10.0' }])
    )
    const connector = createConnectorRegistry({ fetch: fetchMock }).get(
      'github-tag'
    )!({})

    await expect(
      connector.detect(pkg, { repository: 'owner/project' })
    ).resolves.toMatchObject({ version: '1.10.0' })
  })

  it('fetches subsequent pages when the first page is full', async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) => ({
      name: `1.0.${index}`
    }))
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(response(firstPage))
      .mockResolvedValueOnce(response([{ name: '2.0.0' }]))
    const connector = createConnectorRegistry({ fetch: fetchMock }).get(
      'github-tag'
    )!({})

    await expect(
      connector.detect(pkg, { repository: 'owner/project' })
    ).resolves.toMatchObject({
      version: '2.0.0',
      metadata: { tag: '2.0.0' }
    })

    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://api.github.com/repos/owner/project/tags?per_page=100&page=2',
      expect.anything()
    )
  })

  it('rejects when no supported tags exist', async () => {
    const connector = createConnectorRegistry({
      fetch: jest.fn(async () => response([{ name: 'latest' }]))
    }).get('github-tag')!({})

    await expect(
      connector.detect(pkg, { repository: 'owner/project' })
    ).rejects.toThrow('contain no supported versions')
  })
})

describe('package-local custom connectors', () => {
  it('passes package identity through the connector environment', async () => {
    const workspace = await createConnectorWorkspace()
    const packageDirectory = path.join(workspace, 'example-bin')
    const connectorDirectory = path.join(packageDirectory, 'connector')
    await mkdir(connectorDirectory, { recursive: true })
    await writeFile(
      path.join(connectorDirectory, 'detect.sh'),
      [
        "printf 'version=2.4.0\\\\n'",
        "printf 'source=https://example.test/%s/archive.tar.gz\\\\n' \\\\",
        '  "$AUR_MAINTAINER_PACKAGE"',
        "printf 'sha256=%s\\\\n' \\\\",
        '  "$AUR_MAINTAINER_PACKAGE_PATH"'
      ].join('\\n')
    )

    const pkgDefinition = {
      ...pkg,
      name: 'example-bin',
      path: packageDirectory,
      config: { connector: 'custom', config: {}, updates: {} }
    }
    const connector = loadPackageConnector(pkgDefinition)({ fetch })

    await expect(connector.detect(pkgDefinition, {})).resolves.toEqual({
      version: '2.4.0',
      source: 'https://example.test/example-bin/archive.tar.gz',
      sha256: packageDirectory
    })
  })

  it('rejects duplicate connector output fields', async () => {
    const workspace = await createConnectorWorkspace()
    const packageDirectory = path.join(workspace, 'example-bin')
    const connectorDirectory = path.join(packageDirectory, 'connector')
    await mkdir(connectorDirectory, { recursive: true })
    await writeFile(
      path.join(connectorDirectory, 'detect.sh'),
      [
        "printf 'version=2.4.0\\\\nsource=https://example.test\\\\n'",
        "printf 'sha256=abc123\\\\nversion=2.4.1\\\\n'"
      ].join('\\n')
    )

    const pkgDefinition = {
      ...pkg,
      name: 'example-bin',
      path: packageDirectory,
      config: { connector: 'custom', config: {}, updates: {} }
    }
    const connector = loadPackageConnector(pkgDefinition)({ fetch })

    await expect(connector.detect(pkgDefinition, {})).rejects.toThrow(
      'produced duplicate output "version"'
    )
  })

  it('runs connector/detect.sh and parses the standard update output', async () => {
    const workspace = await createConnectorWorkspace()
    const packageDirectory = path.join(workspace, 'example-bin')
    const connectorDirectory = path.join(packageDirectory, 'connector')
    await mkdir(connectorDirectory, { recursive: true })
    await writeFile(
      path.join(connectorDirectory, 'detect.sh'),
      `#!/usr/bin/env bash
set -euo pipefail
printf 'version=2.4.0\\nsource=https://example.test/archive.tar.gz\\nsha256=abc123\\n'
`
    )

    const pkgDefinition = {
      ...pkg,
      name: 'example-bin',
      path: packageDirectory
    }
    const connector = loadPackageConnector({
      ...pkgDefinition,
      config: { connector: 'custom', config: {}, updates: {} }
    })({ fetch })

    await expect(connector.detect(pkgDefinition, {})).resolves.toEqual({
      version: '2.4.0',
      source: 'https://example.test/archive.tar.gz',
      sha256: 'abc123'
    })
  })

  it('rejects custom connector output with missing fields', async () => {
    const workspace = await createConnectorWorkspace()
    const packageDirectory = path.join(workspace, 'example-bin')
    const connectorDirectory = path.join(packageDirectory, 'connector')
    await mkdir(connectorDirectory, { recursive: true })
    await writeFile(
      path.join(connectorDirectory, 'detect.sh'),
      `printf 'version=2.4.0\\n'`
    )

    const pkgDefinition = {
      ...pkg,
      name: 'example-bin',
      path: packageDirectory,
      config: { connector: 'custom', config: {}, updates: {} }
    }
    const connector = loadPackageConnector(pkgDefinition)({ fetch })

    await expect(connector.detect(pkgDefinition, {})).rejects.toThrow(
      'must output version, source and sha256'
    )
  })

  it('rejects custom connector output with unknown fields', async () => {
    const workspace = await createConnectorWorkspace()
    const packageDirectory = path.join(workspace, 'example-bin')
    const connectorDirectory = path.join(packageDirectory, 'connector')
    await mkdir(connectorDirectory, { recursive: true })
    await writeFile(
      path.join(connectorDirectory, 'detect.sh'),
      `printf 'version=2.4.0\\nsource=https://example.test\\nsha256=abc123\\nextra=value\\n'`
    )

    const pkgDefinition = {
      ...pkg,
      name: 'example-bin',
      path: packageDirectory,
      config: { connector: 'custom', config: {}, updates: {} }
    }
    const connector = loadPackageConnector(pkgDefinition)({ fetch })

    await expect(connector.detect(pkgDefinition, {})).rejects.toThrow(
      'produced unknown output "extra"'
    )
  })

  it('rejects a custom package without detect.sh', async () => {
    const workspace = await createConnectorWorkspace()
    const packageDirectory = path.join(workspace, 'example-bin')
    await mkdir(path.join(packageDirectory, 'connector'), { recursive: true })

    const pkgDefinition = {
      ...pkg,
      name: 'example-bin',
      path: packageDirectory,
      config: { connector: 'custom', config: {}, updates: {} }
    }
    const connector = loadPackageConnector(pkgDefinition)({ fetch })

    await expect(connector.detect(pkgDefinition, {})).rejects.toThrow(
      'must provide connector/detect.sh'
    )
  })
})

describe('repository-local connectors', () => {
  it('loads an ESM connector from its repository directory', async () => {
    const workspace = await createConnectorWorkspace()
    const connectorDirectory = path.join(workspace, 'connectors', 'custom')
    await mkdir(connectorDirectory, { recursive: true })
    await writeFile(
      path.join(connectorDirectory, 'index.js'),
      `export default (context) => ({
  name: 'custom',
  detect: async (_pkg, config) => ({
    version: String(config.version),
    metadata: { token: context.token ?? 'missing' }
  })
})`
    )

    const registry = await loadRepositoryConnectors(workspace, {
      fetch,
      token: 'test-token'
    })
    const connector = registry.get('custom')!({
      fetch,
      token: 'test-token'
    })

    await expect(connector.detect(pkg, { version: '2.4.0' })).resolves.toEqual({
      version: '2.4.0',
      metadata: { token: 'test-token' }
    })
  })

  it('rejects a connector directory without index.js', async () => {
    const workspace = await createConnectorWorkspace()
    await mkdir(path.join(workspace, 'connectors', 'custom'), {
      recursive: true
    })

    await expect(
      loadRepositoryConnectors(workspace, { fetch })
    ).rejects.toThrow('must provide connectors/custom/index.js')
  })

  it('rejects a local connector that conflicts with a built-in', async () => {
    const workspace = await createConnectorWorkspace()
    const connectorDirectory = path.join(
      workspace,
      'connectors',
      'github-release'
    )
    await mkdir(connectorDirectory, { recursive: true })
    await writeFile(
      path.join(connectorDirectory, 'index.js'),
      `export default () => ({
  name: 'github-release',
  detect: async () => ({ version: '1.0.0' })
})`
    )

    await expect(
      loadRepositoryConnectors(workspace, { fetch })
    ).rejects.toThrow('conflicts with a built-in connector')
  })

  it('rejects a connector without a matching name', async () => {
    const workspace = await createConnectorWorkspace()
    const connectorDirectory = path.join(workspace, 'connectors', 'custom')
    await mkdir(connectorDirectory, { recursive: true })
    await writeFile(
      path.join(connectorDirectory, 'index.js'),
      `export default () => ({
  name: 'other',
  detect: async () => ({ version: '1.0.0' })
})`
    )

    await expect(
      loadRepositoryConnectors(workspace, { fetch })
    ).rejects.toThrow('factory must return a connector named "custom"')
  })
})
