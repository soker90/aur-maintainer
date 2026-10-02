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
        new Response(JSON.stringify({ html_url: 'https://github.com/test/pr/1' }), {
          status: 201,
          headers: { 'content-type': 'application/json' }
        })
      )

    await expect(
      createUpdatePullRequest(
        '/workspace',
        {
          token: 'token',
          repository: 'test/repo',
          baseBranch: 'main',
          updateBranch: 'aur-maintainer/updates',
          packages: [pkg]
        },
        { run }
      )
    ).resolves.toBe('https://github.com/test/pr/1')

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
})
