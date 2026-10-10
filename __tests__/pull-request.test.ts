import { afterEach, describe, expect, it, jest } from '@jest/globals'
import type { PackageDefinition } from '../src/types.js'
import {
  createUpdatePullRequest,
  createValidationFailureIssue
} from '../src/pull-request.js'

describe('update pull request creation', () => {
  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('creates a package-specific branch and pull request', async () => {
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
      return ''
    })
    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ html_url: 'https://github.com/test/pr/1' }),
          { status: 201 }
        )
      )

    await expect(
      createUpdatePullRequest(
        '/workspace',
        {
          token: 'token',
          repository: 'test/repo',
          baseBranch: 'main',
          updateBranch: 'update',
          packages: [pkg],
          currentVersion: '1.0.0',
          version: '1.1.0',
          autoMerge: false,
          autoMergeTimeoutSeconds: 600
        },
        { run }
      )
    ).resolves.toBe('https://github.com/test/pr/1')

    expect(run).toHaveBeenCalledWith(
      'git',
      ['add', '--', 'packages/demo/PKGBUILD', 'packages/demo/.SRCINFO'],
      '/workspace'
    )
    expect(run).toHaveBeenCalledWith(
      'git',
      [
        'fetch',
        '--no-tags',
        'origin',
        '+refs/heads/main:refs/remotes/origin/main'
      ],
      '/workspace'
    )
    expect(run).toHaveBeenCalledWith(
      'git',
      ['switch', '-C', 'main', 'refs/remotes/origin/main'],
      '/workspace'
    )
    expect(run).toHaveBeenCalledWith(
      'git',
      ['switch', '-C', 'update/demo'],
      '/workspace'
    )
    expect(run).toHaveBeenCalledWith(
      'git',
      ['push', '--force', '--set-upstream', 'origin', 'update/demo'],
      '/workspace'
    )
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('creates a branch and issue for a validation failure', async () => {
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
      return ''
    })
    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(
          JSON.stringify({ html_url: 'https://github.com/test/repo/issues/1' }),
          { status: 201 }
        )
      )

    await expect(
      createValidationFailureIssue(
        '/workspace',
        {
          token: 'token',
          repository: 'test/repo',
          baseBranch: 'main',
          updateBranch: 'update',
          pkg,
          currentVersion: '1.0.0',
          version: '1.1.0',
          error: new Error('makepkg failed')
        },
        { run }
      )
    ).resolves.toBe('https://github.com/test/repo/issues/1')

    expect(run).toHaveBeenCalledWith(
      'git',
      ['switch', '-C', 'update/demo'],
      '/workspace'
    )
    expect(run).toHaveBeenCalledWith(
      'git',
      ['push', '--force', '--set-upstream', 'origin', 'update/demo'],
      '/workspace'
    )
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      '/repos/test/repo/issues'
    )
    expect(String(fetchMock.mock.calls[0]?.[1]?.body)).toContain(
      'makepkg failed'
    )
    expect(String(fetchMock.mock.calls[0]?.[1]?.body)).toContain('update/demo')
  })

  it('updates an existing package pull request without cherry-picking', async () => {
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
      return ''
    })
    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            { html_url: 'https://github.com/test/pr/1', number: 1 }
          ]),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 200 }))

    await expect(
      createUpdatePullRequest(
        '/workspace',
        {
          token: 'token',
          repository: 'test/repo',
          baseBranch: 'main',
          updateBranch: 'update',
          packages: [pkg],
          currentVersion: '1.0.0',
          version: '1.1.0',
          autoMerge: false,
          autoMergeTimeoutSeconds: 600
        },
        { run }
      )
    ).resolves.toBe('https://github.com/test/pr/1')

    expect(run).not.toHaveBeenCalledWith(
      'git',
      ['cherry-pick', expect.any(String)],
      '/workspace'
    )
    expect(run).toHaveBeenCalledWith(
      'git',
      [
        'fetch',
        '--no-tags',
        'origin',
        '+refs/heads/main:refs/remotes/origin/main'
      ],
      '/workspace'
    )
    expect(run).toHaveBeenCalledWith(
      'git',
      ['switch', '-C', 'main', 'refs/remotes/origin/main'],
      '/workspace'
    )
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain(
      '/repos/test/repo/pulls/1'
    )
    expect(fetchMock.mock.calls[1]?.[1]?.method).toBe('PATCH')
    expect(String(fetchMock.mock.calls[1]?.[1]?.body)).toContain('1.0.0')
    expect(String(fetchMock.mock.calls[1]?.[1]?.body)).toContain('1.1.0')
  })

  it('rejects auto-merge when GitHub omits the pull request number', async () => {
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
      return ''
    })
    jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            html_url: 'https://github.com/test/pr/3',
            node_id: 'PR_node_3',
            head: { sha: 'abc123' }
          }),
          { status: 201 }
        )
      )

    await expect(
      createUpdatePullRequest(
        '/workspace',
        {
          token: 'token',
          repository: 'test/repo',
          baseBranch: 'main',
          updateBranch: 'update',
          packages: [pkg],
          currentVersion: '1.0.0',
          version: '1.1.0',
          autoMerge: true,
          autoMergeTimeoutSeconds: 600
        },
        { run }
      )
    ).rejects.toThrow('GitHub did not return the pull request number')
  })

  it('merges a clean pull request when no checks are configured', async () => {
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
      return ''
    })
    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            html_url: 'https://github.com/test/pr/2',
            number: 2,
            node_id: 'PR_node_2',
            head: { sha: 'abc123' }
          }),
          { status: 201 }
        )
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ check_runs: [] }), { status: 200 })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ number: 2, mergeable_state: 'clean' }), {
          status: 200
        })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              mergePullRequest: { pullRequest: { id: 'PR_node_2' } }
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
          updateBranch: 'update',
          packages: [pkg],
          currentVersion: '1.0.0',
          version: '1.1.0',
          autoMerge: true,
          autoMergeTimeoutSeconds: 600
        },
        { run }
      )
    ).resolves.toBe('https://github.com/test/pr/2')

    expect(fetchMock).toHaveBeenCalledTimes(5)
    expect(String(fetchMock.mock.calls[4]?.[1]?.body)).toContain('SQUASH')
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
      if (args[0] === 'diff') return 'packages/demo/PKGBUILD\n'
      return ''
    })
    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            html_url: 'https://github.com/test/pr/1',
            number: 1,
            node_id: 'PR_node',
            head: { sha: 'abc123' }
          }),
          { status: 201 }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            check_runs: [
              {
                name: 'Validate Packages',
                status: 'completed',
                conclusion: 'success'
              }
            ]
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              mergePullRequest: { pullRequest: { id: 'PR_node' } }
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
          updateBranch: 'update',
          packages: [pkg],
          currentVersion: '1.0.0',
          version: '1.1.0',
          autoMerge: true,
          autoMergeTimeoutSeconds: 600
        },
        { run }
      )
    ).resolves.toBe('https://github.com/test/pr/1')

    expect(fetchMock).toHaveBeenCalledTimes(4)
    expect(String(fetchMock.mock.calls[1]?.[1]?.body)).toContain('update: demo')
    expect(String(fetchMock.mock.calls[3]?.[1]?.body)).toContain(
      'MergePullRequestInput'
    )
    expect(String(fetchMock.mock.calls[3]?.[1]?.body)).toContain('SQUASH')
  })
})
