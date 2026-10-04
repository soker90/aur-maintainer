import { afterEach, describe, expect, it, jest } from '@jest/globals'
import type { PackageDefinition } from '../src/types.js'
import { createUpdatePullRequest } from '../src/pull-request.js'

describe('update pull request creation', () => {
  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('commits, pushes, and creates a pull request', async () => {
    const pkg = {
      name: 'demo',
      path: '/workspace/packages/demo',
      pkgbuildPath: '/workspace/packages/demo/PKGBUILD',
      srcinfoPath: '/workspace/packages/demo/.SRCINFO',
      updateConfigPath: '/workspace/packages/demo/update.yml',
      config: { connector: 'github-release', config: {} }
    } satisfies PackageDefinition
    const run = jest.fn().mockImplementation(async (_command, args) => {
      if (args[0] === 'diff') return 'packages/demo/PKGBUILD\n'
      if (args[0] === 'rev-parse') return 'abc123\n'
      if (args[0] === 'ls-remote') {
        const error = new Error('branch not found') as Error & {
          code: number
        }
        error.code = 2
        throw error
      }
      return ''
    })
    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify([]), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ html_url: 'https://github.com/test/pr/1' }),
          {
            status: 201,
            headers: { 'content-type': 'application/json' }
          }
        )
      )

    await expect(
      createUpdatePullRequest(
        '/workspace',
        {
          token: 'token',
          repository: 'test/repo',
          baseBranch: 'main',
          updateBranch: 'aur-maintainer/updates',
          packages: [pkg],
          autoMerge: false
        },
        { run }
      )
    ).resolves.toBe('https://github.com/test/pr/1')

    expect(run).toHaveBeenCalledWith(
      'git',
      ['add', '--', 'packages/demo'],
      '/workspace'
    )
    expect(run).toHaveBeenCalledWith(
      'git',
      ['switch', '-c', 'aur-maintainer/updates'],
      '/workspace'
    )
    expect(run).toHaveBeenCalledWith(
      'git',
      ['push', '--set-upstream', 'origin', 'aur-maintainer/updates'],
      '/workspace'
    )
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('enables squash auto-merge when requested', async () => {
    const pkg = {
      name: 'demo',
      path: '/workspace/packages/demo',
      pkgbuildPath: '/workspace/packages/demo/PKGBUILD',
      srcinfoPath: '/workspace/packages/demo/.SRCINFO',
      updateConfigPath: '/workspace/packages/demo/update.yml',
      config: { connector: 'github-release', config: {} }
    } satisfies PackageDefinition
    const run = jest.fn().mockImplementation(async (_command, args) => {
      if (args[0] === 'diff') return 'packages/demo/PKGBUILD\\n'
      if (args[0] === 'rev-parse') return 'abc123\\n'
      if (args[0] === 'ls-remote') {
        const error = new Error('branch not found') as Error & {
          status: number
        }
        error.status = 2
        throw error
      }
      return ''
    })
    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            html_url: 'https://github.com/test/pr/1',
            node_id: 'PR_node',
            head: { sha: 'abc123' }
          }),
          { status: 201 }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              enablePullRequestAutoMerge: { pullRequest: { id: 'PR_node' } }
            }
          }),
          { status: 200 }
        )
      )

    await expect(
      createUpdatePullRequest(
        '/workspace',
        {
          token: 'token',
          repository: 'test/repo',
          baseBranch: 'main',
          updateBranch: 'aur-maintainer/updates',
          packages: [pkg],
          autoMerge: true
        },
        { run }
      )
    ).resolves.toBe('https://github.com/test/pr/1')

    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(fetchMock.mock.calls[2]?.[0]).toBe('https://api.github.com/graphql')
    expect(String(fetchMock.mock.calls[2]?.[1]?.body)).toContain('SQUASH')
    expect(String(fetchMock.mock.calls[2]?.[1]?.body)).toContain('PR_node')
    expect(String(fetchMock.mock.calls[2]?.[1]?.body)).toContain('abc123')
  })
})
