import { describe, expect, it, jest } from '@jest/globals'
import { mkdtemp, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { PackageDefinition } from '../src/types.js'
import { validatePackage } from '../src/validation.js'

describe('package validation', () => {
  it('runs the complete Arch validation pipeline', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'aur-validation-'))
    const artifact = 'demo-1.1.0-1-x86_64.pkg.tar.zst'
    const staleArtifact = 'demo-1.0.0-1-x86_64.pkg.tar.zst'
    const artifactPath = path.join(directory, artifact)
    const staleArtifactPath = path.join(directory, staleArtifact)
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
      .mockResolvedValueOnce(artifactPath + '\n')
      .mockResolvedValueOnce('')
      .mockResolvedValueOnce('')

    await validatePackage(pkg, { run })

    expect(run.mock.calls).toEqual([
      ['namcap', [pkg.pkgbuildPath]],
      ['makepkg', ['--verifysource'], pkg.path],
      ['makepkg', ['--printsrcinfo'], pkg.path],
      ['makepkg', ['-sf', '--noconfirm'], pkg.path],
      ['makepkg', ['--packagelist'], pkg.path],
      ['namcap', [artifactPath], pkg.path],
      ['sudo', ['-n', 'pacman', '-U', '--noconfirm', artifact], pkg.path]
    ])
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