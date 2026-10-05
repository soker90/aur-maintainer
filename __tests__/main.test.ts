import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { jest } from '@jest/globals'
import * as core from '../__fixtures__/core.js'
import type { PackageDefinition } from '../src/types.js'

const discoverPackages = jest.fn()
const loadMaintainerConfig = jest.fn()
const loadPackageConnector = jest.fn()
const PACKAGE_LOCAL_CONNECTOR = 'custom'
const loadRepositoryConnectors = jest.fn()
const updatePackage = jest.fn()
const rollbackPackageUpdate = jest.fn()
const updatePackageMetadata = jest.fn()
const validatePackage = jest.fn()
const publishAurPackage = jest.fn()
const createUpdatePullRequest = jest.fn()
const createValidationFailureIssue = jest.fn()

jest.unstable_mockModule('@actions/core', () => core)
jest.unstable_mockModule('../src/discovery.js', () => ({ discoverPackages }))
jest.unstable_mockModule('../src/config.js', () => ({ loadMaintainerConfig }))
jest.unstable_mockModule('../src/connectors.js', () => ({
  loadPackageConnector,
  loadRepositoryConnectors,
  PACKAGE_LOCAL_CONNECTOR
}))
jest.unstable_mockModule('../src/update.js', () => ({
  updatePackage,
  rollbackPackageUpdate
}))
jest.unstable_mockModule('../src/metadata.js', () => ({
  updatePackageMetadata
}))
jest.unstable_mockModule('../src/validation.js', () => ({
  validatePackage
}))
jest.unstable_mockModule('../src/aur.js', () => ({
  publishAurPackage
}))
jest.unstable_mockModule('../src/pull-request.js', () => ({
  createUpdatePullRequest,
  createValidationFailureIssue
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
      name === 'github-token'
        ? 'test-token'
        : name === 'auto-merge-timeout'
          ? '600'
          : '.aur-maintainer.yml'
    )
    core.getBooleanInput.mockReturnValue(false)
    discoverPackages.mockResolvedValue([pkg])
    loadMaintainerConfig.mockResolvedValue({})
    updatePackage.mockResolvedValue({
      changed: false,
      currentVersion: '1.0.0',
      version: '1.0.0'
    })
    publishAurPackage.mockResolvedValue(false)
    loadRepositoryConnectors.mockResolvedValue(
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

  it('publishes packages when AUR publishing is enabled', async () => {
    core.getBooleanInput.mockImplementation((name) => name === 'aur-publish')
    core.getInput.mockImplementation((name) => {
      if (name === 'github-token') return ''
      if (name === 'aur-ssh-key') return 'PRIVATE KEY'
      if (name === 'aur-known-hosts') return 'KNOWN HOST'
      return '.aur-maintainer.yml'
    })
    updatePackage.mockResolvedValue({
      changed: true,
      currentVersion: '1.0.0',
      version: '1.1.0',
      previousPkgbuild: 'pkgname=example\\npkgver=1.0.0\\n'
    })

    await run()

    expect(publishAurPackage).toHaveBeenCalledWith(pkg, {
      sshKey: 'PRIVATE KEY',
      knownHosts: 'KNOWN HOST'
    })
    expect(core.setFailed).not.toHaveBeenCalled()
  })

  it('publishes without checking upstream updates in publish-only mode', async () => {
    core.getBooleanInput.mockImplementation(
      (name) => name === 'aur-publish-only'
    )
    core.getInput.mockImplementation((name) => {
      if (name === 'github-token') return 'test-token'
      if (name === 'aur-ssh-key') return 'PRIVATE KEY'
      if (name === 'aur-known-hosts') return 'KNOWN HOST'
      return '.aur-maintainer.yml'
    })

    await run()

    expect(publishAurPackage).toHaveBeenCalledWith(pkg, {
      sshKey: 'PRIVATE KEY',
      knownHosts: 'KNOWN HOST'
    })
    expect(loadRepositoryConnectors).not.toHaveBeenCalled()
    expect(updatePackage).not.toHaveBeenCalled()
  })

  it('does not fail when the optional repository configuration is absent', async () => {
    discoverPackages.mockResolvedValue([])
    await run()
    expect(core.setFailed).not.toHaveBeenCalled()
  })

  it('warns when an update is found without a GitHub token', async () => {
    core.getInput.mockImplementation((name) =>
      name === 'github-token' ? '' : '.aur-maintainer.yml'
    )
    updatePackage.mockResolvedValue({
      changed: true,
      currentVersion: '1.0.0',
      version: '1.1.0',
      previousPkgbuild: 'pkgname=example\\npkgver=1.0.0\\n'
    })

    await run()

    expect(core.warning).toHaveBeenCalledWith(
      'Updated example, but github-token was not provided; no GitHub branch or pull request was created.'
    )
    expect(createUpdatePullRequest).not.toHaveBeenCalled()
    expect(core.setFailed).not.toHaveBeenCalled()
  })

  it('passes the GitHub token to connector detection', async () => {
    await run()

    expect(loadRepositoryConnectors).toHaveBeenCalledWith(
      '/workspace',
      expect.objectContaining({ token: 'test-token' })
    )
    expect(core.setFailed).not.toHaveBeenCalled()
  })

  it('rolls back a package when snapshot completion fails', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'aur-maintainer-'))
    const packagePath = path.join(directory, 'example')
    const pkgbuildPath = path.join(packagePath, 'PKGBUILD')
    const srcinfoPath = path.join(packagePath, '.SRCINFO')

    await mkdir(packagePath, { recursive: true })
    await mkdir(srcinfoPath)
    await writeFile(pkgbuildPath, 'pkgname=example\npkgver=1.0.0\n')

    discoverPackages.mockResolvedValue([
      { ...pkg, path: packagePath, pkgbuildPath, srcinfoPath }
    ])
    rollbackPackageUpdate.mockImplementation(async (item, result) => {
      await writeFile(item.pkgbuildPath, result.previousPkgbuild)
    })
    updatePackage.mockImplementation(async (item) => {
      await writeFile(item.pkgbuildPath, 'pkgname=example\npkgver=1.1.0\n')
      return {
        changed: true,
        currentVersion: '1.0.0',
        version: '1.1.0',
        previousPkgbuild: 'pkgname=example\npkgver=1.0.0\n'
      }
    })

    await run()

    await expect(readFile(pkgbuildPath, 'utf8')).resolves.toBe(
      'pkgname=example\npkgver=1.0.0\n'
    )
    expect(core.setFailed).toHaveBeenCalled()
  })


  it('creates a validation failure issue and preserves the update', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'aur-maintainer-'))
    const packagePath = path.join(directory, 'example')
    const pkgbuildPath = path.join(packagePath, 'PKGBUILD')
    const srcinfoPath = path.join(packagePath, '.SRCINFO')

    await mkdir(packagePath, { recursive: true })
    await writeFile(pkgbuildPath, 'pkgname=example\\npkgver=1.0.0\\n')
    await writeFile(srcinfoPath, 'pkgname=example\\npkgver=1.0.0\\n')

    const updatedPkg = {
      ...pkg,
      path: packagePath,
      pkgbuildPath,
      srcinfoPath
    }
    discoverPackages.mockResolvedValue([updatedPkg])
    updatePackage.mockImplementation(async (item) => {
      await writeFile(item.pkgbuildPath, 'pkgname=example\\npkgver=1.1.0\\n')
      return {
        changed: true,
        currentVersion: '1.0.0',
        version: '1.1.0',
        previousPkgbuild: 'pkgname=example\\npkgver=1.0.0\\n'
      }
    })
    validatePackage.mockRejectedValue(new Error('makepkg failed'))
    createValidationFailureIssue.mockResolvedValue(
      'https://github.com/test/repo/issues/1'
    )

    await run()

    await expect(readFile(pkgbuildPath, 'utf8')).resolves.toBe(
      'pkgname=example\\npkgver=1.1.0\\n'
    )
    expect(createValidationFailureIssue).toHaveBeenCalledWith(
      '/workspace',
      expect.objectContaining({
        pkg: updatedPkg,
        currentVersion: '1.0.0',
        version: '1.1.0',
        error: expect.any(Error)
      })
    )
    expect(rollbackPackageUpdate).not.toHaveBeenCalled()
    expect(core.setFailed).toHaveBeenCalledWith('makepkg failed')
  })

  it('stops after the first package with an update', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'aur-maintainer-'))
    const packages = ['first', 'second'].map((name) => ({
      ...pkg,
      name,
      path: path.join(directory, name),
      pkgbuildPath: path.join(directory, name, 'PKGBUILD'),
      srcinfoPath: path.join(directory, name, '.SRCINFO')
    }))

    for (const item of packages) {
      await mkdir(item.path, { recursive: true })
      await writeFile(item.pkgbuildPath, `pkgname=${item.name}\npkgver=1.0.0\n`)
      await writeFile(item.srcinfoPath, `pkgname=${item.name}\npkgver=1.0.0\n`)
    }

    discoverPackages.mockResolvedValue(packages)
    loadRepositoryConnectors.mockResolvedValue(
      new Map([
        [
          'github-tag',
          () => ({
            name: 'github-tag',
            detect: jest.fn().mockResolvedValue({ version: '1.1.0' })
          })
        ]
      ])
    )
    updatePackage.mockImplementation(async (item) => {
      await writeFile(item.pkgbuildPath, `pkgname=${item.name}\npkgver=1.1.0\n`)
      return {
        changed: true,
        currentVersion: '1.0.0',
        version: '1.1.0',
        previousPkgbuild: `pkgname=${item.name}\npkgver=1.0.0\n`
      }
    })
    createUpdatePullRequest.mockResolvedValue(
      'https://github.com/test/repo/pull/1'
    )

    await run()

    expect(updatePackage).toHaveBeenCalledTimes(1)
    expect(updatePackage).toHaveBeenCalledWith(
      packages[0],
      expect.objectContaining({ version: '1.1.0' })
    )
    expect(createUpdatePullRequest).toHaveBeenCalledTimes(1)
    expect(createUpdatePullRequest).toHaveBeenCalledWith(
      '/workspace',
      expect.objectContaining({ packages: [packages[0]] })
    )
    await expect(readFile(packages[1].pkgbuildPath, 'utf8')).resolves.toBe(
      'pkgname=second\npkgver=1.0.0\n'
    )
    expect(core.setFailed).not.toHaveBeenCalled()
  })
})
