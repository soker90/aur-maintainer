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
  const originalRepository = process.env.GITHUB_REPOSITORY

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
    process.env.GITHUB_REPOSITORY = 'test/repo'
    core.getInput.mockImplementation((name) =>
      name === 'github-token'
        ? 'test-token'
        : name === 'auto-merge-timeout'
          ? '600'
          : name === 'config'
            ? '.aur-maintainer.yml'
            : ''
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
    process.env.GITHUB_REPOSITORY = originalRepository
    jest.resetAllMocks()
  })

  it('updates a manually selected package without loading connectors or publishing to AUR', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'aur-manual-'))
    const pkgbuildPath = path.join(directory, 'PKGBUILD')
    const srcinfoPath = path.join(directory, '.SRCINFO')
    await writeFile(pkgbuildPath, 'pkgname=example\npkgver=1.0.0\npkgrel=1\n')
    await writeFile(srcinfoPath, 'pkgname = example\npkgver = 1.0.0\n')
    const manualPackage: PackageDefinition = {
      ...pkg,
      name: 'example',
      path: directory,
      pkgbuildPath,
      srcinfoPath,
      updateConfigPath: path.join(directory, 'update.yml'),
      config: { config: {}, updates: {} }
    }
    discoverPackages.mockResolvedValue([manualPackage])
    core.getInput.mockImplementation((name) => {
      if (name === 'github-token') return 'test-token'
      if (name === 'manual-package') return 'example'
      if (name === 'manual-version') return '2.0.0'
      if (name === 'auto-merge-timeout') return '600'
      return name === 'config' ? '.aur-maintainer.yml' : ''
    })
    updatePackage.mockResolvedValue({
      changed: true,
      currentVersion: '1.0.0',
      version: '2.0.0',
      previousPkgbuild: 'pkgname=example\npkgver=1.0.0\npkgrel=1\n'
    })
    createUpdatePullRequest.mockResolvedValue(
      'https://github.com/test/repo/pull/1'
    )

    await run()

    expect(updatePackage).toHaveBeenCalledWith(manualPackage, {
      version: '2.0.0'
    })
    expect(loadRepositoryConnectors).not.toHaveBeenCalled()
    expect(updatePackageMetadata).toHaveBeenCalledWith(manualPackage)
    expect(validatePackage).toHaveBeenCalledWith(manualPackage)
    expect(createUpdatePullRequest).toHaveBeenCalledWith(
      '/workspace',
      expect.objectContaining({
        packages: [manualPackage],
        currentVersion: '1.0.0',
        version: '2.0.0'
      })
    )
    expect(publishAurPackage).not.toHaveBeenCalled()
    expect(core.setFailed).not.toHaveBeenCalled()
  })

  it('requires both manual inputs together', async () => {
    core.getInput.mockImplementation((name) => {
      if (name === 'github-token') return 'test-token'
      if (name === 'manual-package') return 'example'
      return name === 'config' ? '.aur-maintainer.yml' : ''
    })

    await run()

    expect(core.setFailed).toHaveBeenCalledWith(
      'manual-package and manual-version must both be provided'
    )
    expect(loadRepositoryConnectors).not.toHaveBeenCalled()
  })

  it('requires a GitHub token when auto-merge is enabled', async () => {
    core.getBooleanInput.mockImplementation((name) => name === 'auto-merge')
    core.getInput.mockImplementation((name) =>
      name === 'github-token'
        ? ''
        : name === 'config'
          ? '.aur-maintainer.yml'
          : ''
    )

    await run()

    expect(core.setFailed).toHaveBeenCalledWith(
      'github-token is required when auto-merge is enabled'
    )
    expect(loadRepositoryConnectors).not.toHaveBeenCalled()
  })

  it('publishes packages when AUR publishing is enabled', async () => {
    core.getBooleanInput.mockImplementation((name) => name === 'aur-publish')
    core.getInput.mockImplementation((name) => {
      if (name === 'github-token') return ''
      if (name === 'aur-ssh-key') return 'PRIVATE KEY'
      if (name === 'aur-known-hosts') return 'KNOWN HOST'
      return name === 'config' ? '.aur-maintainer.yml' : ''
    })
    updatePackage.mockResolvedValue({
      changed: true,
      currentVersion: '1.0.0',
      version: '1.1.0',
      previousPkgbuild: 'pkgname=example\npkgver=1.0.0\n'
    })

    await run()

    expect(publishAurPackage).toHaveBeenCalledWith(pkg, {
      sshKey: 'PRIVATE KEY',
      knownHosts: 'KNOWN HOST'
    })
    expect(core.setFailed).not.toHaveBeenCalled()
  })

  it('publishes only the package named by the merged update branch', async () => {
    const otherPackage = {
      ...pkg,
      name: 'other',
      path: '/workspace/packages/other',
      pkgbuildPath: '/workspace/packages/other/PKGBUILD',
      srcinfoPath: '/workspace/packages/other/.SRCINFO'
    }
    discoverPackages.mockResolvedValue([pkg, otherPackage])
    core.getBooleanInput.mockImplementation(
      (name) => name === 'aur-publish-only'
    )
    core.getInput.mockImplementation((name) => {
      if (name === 'github-token') return 'test-token'
      if (name === 'aur-ssh-key') return 'PRIVATE KEY'
      if (name === 'aur-known-hosts') return 'KNOWN HOST'
      if (name === 'aur-publish-branch') return 'update/example'
      if (name === 'update-branch') return 'update'
      return name === 'config' ? '.aur-maintainer.yml' : ''
    })

    await run()

    expect(publishAurPackage).toHaveBeenCalledTimes(1)
    expect(publishAurPackage).toHaveBeenCalledWith(pkg, {
      sshKey: 'PRIVATE KEY',
      knownHosts: 'KNOWN HOST'
    })
    expect(validatePackage).toHaveBeenCalledTimes(1)
    expect(validatePackage).toHaveBeenCalledWith(pkg)
    expect(loadRepositoryConnectors).not.toHaveBeenCalled()
    expect(updatePackage).not.toHaveBeenCalled()
    expect(core.setOutput).toHaveBeenCalledWith(
      'packages',
      JSON.stringify([{ package: 'example' }])
    )
  })

  it('fails closed when the merged update branch does not identify a configured package', async () => {
    core.getBooleanInput.mockImplementation(
      (name) => name === 'aur-publish-only'
    )
    core.getInput.mockImplementation((name) => {
      if (name === 'aur-ssh-key') return 'PRIVATE KEY'
      if (name === 'aur-known-hosts') return 'KNOWN HOST'
      if (name === 'aur-publish-branch') return 'update/not-configured'
      if (name === 'update-branch') return 'update'
      return name === 'config' ? '.aur-maintainer.yml' : ''
    })

    await run()

    expect(publishAurPackage).not.toHaveBeenCalled()
    expect(validatePackage).not.toHaveBeenCalled()
    expect(core.setFailed).toHaveBeenCalledWith(
      'No configured package matches merged update branch "update/not-configured"'
    )
  })

  it('does not fail when the optional repository configuration is absent', async () => {
    discoverPackages.mockResolvedValue([])
    await run()
    expect(core.setFailed).not.toHaveBeenCalled()
  })

  it('warns when an update is found without a GitHub token', async () => {
    core.getInput.mockImplementation((name) =>
      name === 'github-token'
        ? ''
        : name === 'config'
          ? '.aur-maintainer.yml'
          : ''
    )
    updatePackage.mockResolvedValue({
      changed: true,
      currentVersion: '1.0.0',
      version: '1.1.0',
      previousPkgbuild: 'pkgname=example\npkgver=1.0.0\n'
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
    await writeFile(pkgbuildPath, 'pkgname=example\npkgver=1.0.0\n')
    await writeFile(srcinfoPath, 'pkgname=example\npkgver=1.0.0\n')

    const updatedPkg = {
      ...pkg,
      path: packagePath,
      pkgbuildPath,
      srcinfoPath
    }
    discoverPackages.mockResolvedValue([updatedPkg])
    updatePackage.mockImplementation(async (item) => {
      await writeFile(item.pkgbuildPath, 'pkgname=example\npkgver=1.1.0\n')
      return {
        changed: true,
        currentVersion: '1.0.0',
        version: '1.1.0',
        previousPkgbuild: 'pkgname=example\npkgver=1.0.0\n'
      }
    })
    validatePackage.mockRejectedValue(new Error('makepkg failed'))
    createValidationFailureIssue.mockResolvedValue(
      'https://github.com/test/repo/issues/1'
    )

    await run()

    await expect(readFile(pkgbuildPath, 'utf8')).resolves.toBe(
      'pkgname=example\npkgver=1.1.0\n'
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

  it('creates a separate update pull request for every outdated package', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'aur-maintainer-'))
    const packages = ['first', 'second', 'third'].map((name) => ({
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
    createUpdatePullRequest.mockImplementation(
      async (_workspace, options) =>
        `https://github.com/test/repo/pull/${options.packages[0].name}`
    )

    await run()

    expect(updatePackage).toHaveBeenCalledTimes(3)
    expect(createUpdatePullRequest).toHaveBeenCalledTimes(3)
    for (const item of packages) {
      expect(createUpdatePullRequest).toHaveBeenCalledWith(
        '/workspace',
        expect.objectContaining({ packages: [item] })
      )
    }
    expect(core.setFailed).not.toHaveBeenCalled()
    expect(core.setOutput).toHaveBeenCalledWith(
      'pull-requests',
      JSON.stringify([
        'https://github.com/test/repo/pull/first',
        'https://github.com/test/repo/pull/second',
        'https://github.com/test/repo/pull/third'
      ])
    )
  })

  it('continues processing packages after a validation failure', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'aur-maintainer-'))
    const packages = ['invalid', 'valid'].map((name) => ({
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
    validatePackage.mockImplementation(async (item) => {
      if (item.name === 'invalid') throw new Error('invalid PKGBUILD')
    })
    createValidationFailureIssue.mockResolvedValue(
      'https://github.com/test/repo/issues/invalid'
    )
    createUpdatePullRequest.mockResolvedValue(
      'https://github.com/test/repo/pull/valid'
    )

    await run()

    expect(createValidationFailureIssue).toHaveBeenCalledTimes(1)
    expect(createUpdatePullRequest).toHaveBeenCalledTimes(1)
    expect(createUpdatePullRequest).toHaveBeenCalledWith(
      '/workspace',
      expect.objectContaining({ packages: [packages[1]] })
    )
    expect(core.setFailed).toHaveBeenCalledWith('invalid PKGBUILD')
  })
})
