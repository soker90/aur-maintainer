import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { jest } from '@jest/globals'
import * as core from '../__fixtures__/core.js'
import type { PackageDefinition } from '../src/types.js'

const discoverPackages = jest.fn()
const loadMaintainerConfig = jest.fn()
const createConnectorRegistry = jest.fn()
const updatePackage = jest.fn()
const updatePackageMetadata = jest.fn()
const validatePackage = jest.fn()

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
  updatePackageMetadata
}))
jest.unstable_mockModule('../src/validation.js', () => ({
  validatePackage
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

  it('rolls back all modified packages when a later package fails', async () => {
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
    createConnectorRegistry.mockReturnValue(
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
    updatePackageMetadata.mockImplementation(async (item) => {
      await writeFile(
        item.pkgbuildPath,
        `pkgname=${item.name}\npkgver=1.1.0\nsha256sums=('changed')\n`
      )
      await writeFile(item.srcinfoPath, `pkgname=${item.name}\npkgver=1.1.0\n`)
    })
    validatePackage.mockImplementation(async (item) => {
      if (item.name === 'second') throw new Error('validation failed')
    })

    await run()

    for (const item of packages) {
      await expect(readFile(item.pkgbuildPath, 'utf8')).resolves.toBe(
        `pkgname=${item.name}\npkgver=1.0.0\n`
      )
      await expect(readFile(item.srcinfoPath, 'utf8')).resolves.toBe(
        `pkgname=${item.name}\npkgver=1.0.0\n`
      )
    }
    expect(core.setFailed).toHaveBeenCalledWith('validation failed')
  })
})
