import { afterEach, describe, expect, it, jest } from '@jest/globals'
import type { PackageDefinition } from '../src/types.js'
import { createUpdatePullRequest } from '../src/pull-request.js'

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
          updateBranch: 'automation/aur-maintainer-updates',
          packages: [pkg],
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
    expect(run).toHaveBeenCalledWith('git', ['switch', 'main'], '/workspace')
    expect(run).toHaveBeenCalledWith(
      'git',
      ['switch', '-C', 'automation/aur-maintainer-updates/demo'],
      '/workspace'
    )
    expect(run).toHaveBeenCalledWith(
      'git',
      [
        'push',
        '--force',
        '--set-upstream',
        'origin',
        'automation/aur-maintainer-updates/demo'
      ],
      '/workspace'
    )
    expect(fetchMock).toHaveBeenCalledTimes(2)
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
      .mockResolvedValue(
        new Response(
          JSON.stringify([{ html_url: 'https://github.com/test/pr/1' }]),
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
          updateBranch: 'automation/aur-maintainer-updates',
          packages: [pkg],
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
    expect(run).toHaveBeenCalledWith('git', ['switch', 'main'], '/workspace')
    expect(fetchMock).toHaveBeenCalledTimes(1)
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
          updateBranch: 'automation/aur-maintainer-updates',
          packages: [pkg],
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
  it('waits for the dispatched validation workflow before merging', async () => {
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
            {
              html_url: 'https://github.com/test/pr/1',
              node_id: 'PR_node',
              head: { sha: 'abc123' }
            }
          ]),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            workflow_runs: [
              {
                id: 99,
                status: 'completed',
                conclusion: 'success',
                created_at: new Date().toISOString(),
                head_sha: 'abc123'
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
          updateBranch: 'automation/aur-maintainer-updates',
          packages: [pkg],
          autoMerge: true,
          autoMergeTimeoutSeconds: 600,
          validationWorkflow: 'validate-packages.yml'
        },
        { run }
      )
    ).resolves.toBe('https://github.com/test/pr/1')

    expect(fetchMock).toHaveBeenCalledTimes(5)
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain(
      '/actions/workflows/validate-packages.yml/dispatches'
    )
    expect(String(fetchMock.mock.calls[2]?.[0])).toContain(
      '/actions/workflows/validate-packages.yml/runs?branch='
    )
    expect(String(fetchMock.mock.calls[3]?.[0])).toContain('/actions/runs/99')
    expect(String(fetchMock.mock.calls[4]?.[1]?.body)).toContain('SQUASH')
  })

  it('waits for the dispatched validation workflow and rejects failures', async () => {
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
            {
              html_url: 'https://github.com/test/pr/1',
              node_id: 'PR_node',
              head: { sha: 'abc123' }
            }
          ]),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            workflow_runs: [
              {
                id: 99,
                status: 'completed',
                conclusion: 'failure',
                created_at: new Date().toISOString(),
                head_sha: 'abc123'
              }
            ]
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
          updateBranch: 'automation/aur-maintainer-updates',
          packages: [pkg],
          autoMerge: true,
          autoMergeTimeoutSeconds: 600,
          validationWorkflow: 'validate-packages.yml'
        },
        { run }
      )
    ).rejects.toThrow('Pull request validation workflow failed: failure')

    expect(fetchMock).toHaveBeenCalledTimes(4)
  })
})
