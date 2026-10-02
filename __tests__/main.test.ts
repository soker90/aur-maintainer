import { jest } from '@jest/globals'
import * as core from '../__fixtures__/core.js'
import type { PackageDefinition } from '../src/types.js'

const discoverPackages = jest.fn()
const loadMaintainerConfig = jest.fn()
const createConnectorRegistry = jest.fn()
const updatePackage = jest.fn()

jest.unstable_mockModule('@actions/core', () => core)
jest.unstable_mockModule('../src/discovery.js', () => ({ discoverPackages }))
jest.unstable_mockModule('../src/config.js', () => ({ loadMaintainerConfig }))
jest.unstable_mockModule('../src/connectors.js', () => ({
  createConnectorRegistry
}))
jest.unstable_mockModule('../src/update.js', () => ({
  updatePackage,
  rollbackPackageUpdate: jest.fn()
}))
jest.unstable_mockModule('../src/metadata.js', () => ({
  updatePackageMetadata: jest.fn()
}))
jest.unstable_mockModule('../src/validation.js', () => ({
  validatePackage: jest.fn()
}))
jest.unstable_mockModule('../src/pull-request.js', () => ({
  createUpdatePullRequest: jest.fn()
}))

const { run } = await import('../src/main.js')

describe('main.ts', () => {
  const originalWorkspace = process.env.GITHUB_WORKSPACE

  const pkg: PackageDefinition = {
    name: 'example',
    path: '/workspace/packages/example',
    pkgbuildPath: '/workspace/packages/example/PKGBUILD',
    srcinfoPath: '/workspace/packages/example/.SRCINFO',
    updateConfigPath: '/workspace/packages/example/update.yml',
    config: {
      connector: 'github-tag',
      config: { repository: 'owner/example' }
    }
  }

  beforeEach(() => {
    process.env.GITHUB_WORKSPACE = '/workspace'
    core.getInput.mockImplementation((name) =>
      name === 'github-token' ? 'test-token' : '.aur-maintainer.yml'
    )
    discoverPackages.mockResolvedValue([pkg])
    loadMaintainerConfig.mockResolvedValue({})
    updatePackage.mockResolvedValue({
      changed: false,
      currentVersion: '1.0.0',
      version: '1.0.0'
    })
    createConnectorRegistry.mockReturnValue(
      new Map([
        [
          'github-tag',
          () => ({
            name: 'github-tag',
            detect: jest.fn().mockResolvedValue({ version: '1.0.0' })
          })
        ]
      ])
    )
  })

  afterEach(() => {
    process.env.GITHUB_WORKSPACE = originalWorkspace
    jest.resetAllMocks()
  })

  it('does not fail when the optional repository configuration is absent', async () => {
    discoverPackages.mockResolvedValue([])
    await run()
    expect(core.setFailed).not.toHaveBeenCalled()
  })

  it('passes the GitHub token to connector detection', async () => {
    await run()

    expect(createConnectorRegistry).toHaveBeenCalledWith(
      expect.objectContaining({ token: 'test-token' })
    )
    expect(core.setFailed).not.toHaveBeenCalled()
  })
})
