import { describe, expect, it, jest } from '@jest/globals'
import { createConnectorRegistry } from '../src/connectors.js'

const pkg = {
  name: 'example-bin',
  path: '/workspace/example-bin',
  pkgbuildPath: '/workspace/example-bin/PKGBUILD',
  srcinfoPath: '/workspace/example-bin/.SRCINFO',
  updateConfigPath: '/workspace/example-bin/update.yml',
  config: { connector: 'github-release', config: {} }
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
    const connector = createConnectorRegistry({ fetch: fetchMock }).get(
      'github-release'
    )!({})

    await expect(
      connector.detect(pkg, { repository: 'stacklok/toolhive-studio' })
    ).resolves.toMatchObject({ version: '1.4.3' })

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.github.com/repos/stacklok/toolhive-studio/releases/latest',
      expect.objectContaining({
        headers: expect.objectContaining({
          accept: 'application/vnd.github+json'
        })
      })
    )
  })

  it('accepts unprefixed versions', async () => {
    const fetchMock = jest.fn(async () => response({ tag_name: '1.2.3' }))
    const connector = createConnectorRegistry({ fetch: fetchMock }).get(
      'github-release'
    )!({})
    await expect(
      connector.detect(pkg, { repository: 'owner/project' })
    ).resolves.toMatchObject({ version: '1.2.3' })
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
        { name: '1.10.0-alpha.1' },
        { name: '1.10.0+build.1' }
      ])
    )
    const connector = createConnectorRegistry({ fetch: fetchMock }).get(
      'github-tag'
    )!({})

    await expect(
      connector.detect(pkg, { repository: 'owner/project' })
    ).resolves.toMatchObject({
      version: '1.10.0+build.1',
      metadata: { tag: '1.10.0+build.1' }
    })

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.github.com/repos/owner/project/tags?per_page=100',
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
