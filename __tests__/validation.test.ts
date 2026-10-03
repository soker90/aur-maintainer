import { describe, expect, it, jest } from '@jest/globals'
import { mkdtemp, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { PackageDefinition } from '../src/types.js'
import { validatePackage } from '../src/validation.js'

describe('package validation', () => {
  it('runs the complete Arch validation pipeline', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'aur-validation-'))
    const artifactPath = path.join(
      directory,
      'demo-1.1.0-1-x86_64.pkg.tar.zst'
    )
    const staleArtifactPath = path.join(
      directory,
      'demo-1.0.0-1-x86_64.pkg.tar.zst'
    )
    const pkg = {
      name: 'demo',
      path: directory,
      pkgbuildPath: path.join(directory, 'PKGBUILD'),
      srcinfoPath: path.join(directory, '.SRCINFO'),
      updateConfigPath: path.join(directory, 'update.yml'),
      config: { connector: 'github-release', config: {} }
    } satisfies PackageDefinition
    await writeFile(pkg.srcinfoPath, 'pkgbase = demo\n\tpkgver = 1.1.0\n')
    await writeFile(artifactPath, '')
    await writeFile(staleArtifactPath, '')

    const run = jest
      .fn()
      .mockResolvedValueOnce('')
      .mockResolvedValueOnce('')
      .mockResolvedValueOnce('pkgbase = demo\n\tpkgver = 1.1.0\n')
      .mockResolvedValueOnce('')
      .mockResolvedValueOnce('')
      .mockResolvedValueOnce(artifactPath + '\n')
      .mockResolvedValueOnce('')
      .mockResolvedValueOnce('')

    await validatePackage(pkg, { run })

    expect(run).toHaveBeenNthCalledWith(1, 'namcap', [pkg.pkgbuildPath])
    expect(run).toHaveBeenNthCalledWith(
      2,
      'makepkg',
      ['--verifysource'],
      pkg.path
    )
    expect(run).toHaveBeenNthCalledWith(
      3,
      'makepkg',
      ['--printsrcinfo'],
      pkg.path
    )
    expect(run).toHaveBeenNthCalledWith(
      4,
      'makepkg',
      ['-sf', '--noconfirm'],
      pkg.path
    )
    expect(run).toHaveBeenNthCalledWith(
      5,
      'makepkg',
      ['--packagelist'],
      pkg.path
    )
    expect(run).toHaveBeenNthCalledWith(
      6,
      'namcap',
      [path.join(pkg.path, 'demo-1.1.0-1-x86_64.pkg.tar.zst')],
      pkg.path
    )
    expect(run).toHaveBeenNthCalledWith(
      7,
      'sudo',
      ['-n', 'pacman', '-U', '--noconfirm', 'demo-1.1.0-1-x86_64.pkg.tar.zst'],
      pkg.path
    )
  })

  it('rejects an out-of-sync .SRCINFO', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'aur-validation-'))
    const pkg = {
      name: 'demo',
      path: directory,
      pkgbuildPath: path.join(directory, 'PKGBUILD'),
      srcinfoPath: path.join(directory, '.SRCINFO'),
      updateConfigPath: path.join(directory, 'update.yml'),
      config: { connector: 'github-release', config: {} }
    } satisfies PackageDefinition
    await writeFile(pkg.srcinfoPath, 'pkgbase = demo\n\tpkgver = 1.0.0\n')

    const run = jest
      .fn()
      .mockResolvedValueOnce('')
      .mockResolvedValueOnce('')
      .mockResolvedValueOnce('pkgbase = demo\n\tpkgver = 1.1.0\n')

    await expect(validatePackage(pkg, { run })).rejects.toThrow(
      'does not match'
    )
    expect(run).toHaveBeenCalledTimes(3)
  })

  it('fails when no package artifact is produced', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'aur-validation-'))
    const pkg = {
      name: 'demo',
      path: directory,
      pkgbuildPath: path.join(directory, 'PKGBUILD'),
      srcinfoPath: path.join(directory, '.SRCINFO'),
      updateConfigPath: path.join(directory, 'update.yml'),
      config: { connector: 'github-release', config: {} }
    } satisfies PackageDefinition
    await writeFile(pkg.srcinfoPath, 'pkgbase = demo\n\tpkgver = 1.1.0\n')

    const run = jest
      .fn()
      .mockResolvedValueOnce('')
      .mockResolvedValueOnce('')
      .mockResolvedValueOnce('pkgbase = demo\n\tpkgver = 1.1.0\n')
      .mockResolvedValueOnce('')
      .mockResolvedValueOnce('')

    await expect(validatePackage(pkg, { run })).rejects.toThrow(
      'No package artifact was produced'
    )
    expect(run).toHaveBeenCalledTimes(5)
  })
})
