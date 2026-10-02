import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from '@jest/globals'
import type { PackageDefinition } from '../src/types.js'
import {
  readPkgver,
  replacePkgver,
  rollbackPackageUpdate,
  updatePackage
} from '../src/update.js'

describe('package updates', () => {
  it('updates the package file and reports the previous version', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'aur-maintainer-'))
    const pkgbuildPath = path.join(directory, 'PKGBUILD')
    await writeFile(pkgbuildPath, 'pkgname=demo\npkgver=1.0.0\npkgrel=1\n')
    const pkg = {
      name: 'demo',
      path: directory,
      pkgbuildPath,
      srcinfoPath: path.join(directory, '.SRCINFO'),
      updateConfigPath: path.join(directory, 'update.yml'),
      config: { connector: 'github-release', config: {} }
    } satisfies PackageDefinition

    await expect(updatePackage(pkg, { version: '1.1.0' })).resolves.toEqual({
      changed: true,
      currentVersion: '1.0.0',
      version: '1.1.0'
    })
    await expect(readFile(pkgbuildPath, 'utf8')).resolves.toContain(
      'pkgver=1.1.0'
    )
  })

  it('updates Arch-compatible alphanumeric versions', () => {
    expect(replacePkgver('pkgver=1.2.3\n', '1.2.3alpha')).toBe(
      'pkgver=1.2.3alpha\n'
    )
  })

  it('reads a single pkgver assignment', () => {
    expect(readPkgver('pkgname=demo\npkgver=1.2.3\npkgrel=1\n')).toBe('1.2.3')
  })

  it('replaces only the pkgver assignment', () => {
    const content = [
      'pkgname=demo',
      'pkgver=1.2.3',
      'pkgrel=1',
      'source=("demo-$pkgver.tar.gz")',
      ''
    ].join('\n')
    expect(replacePkgver(content, '1.3.0')).toBe(
      [
        'pkgname=demo',
        'pkgver=1.3.0',
        'pkgrel=1',
        'source=("demo-$pkgver.tar.gz")',
        ''
      ].join('\n')
    )
  })

  it('rejects multiple pkgver assignments', () => {
    expect(() => readPkgver('pkgver=1.0.0\npkgver=2.0.0\n')).toThrow(
      'exactly one simple pkgver assignment'
    )
  })

  it('rejects unsupported versions', () => {
    expect(() => replacePkgver('pkgver=1.0.0\n', 'latest')).toThrow(
      'Unsupported update version'
    )
  })

  it('rolls back a failed package update', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'aur-maintainer-'))
    const pkgbuildPath = path.join(directory, 'PKGBUILD')
    await writeFile(pkgbuildPath, 'pkgname=demo\npkgver=1.1.0\npkgrel=1\n')
    const pkg = {
      name: 'demo',
      path: directory,
      pkgbuildPath,
      srcinfoPath: path.join(directory, '.SRCINFO'),
      updateConfigPath: path.join(directory, 'update.yml'),
      config: { connector: 'github-release', config: {} }
    } satisfies PackageDefinition

    await rollbackPackageUpdate(pkg, {
      changed: true,
      currentVersion: '1.0.0',
      version: '1.1.0'
    })

    await expect(readFile(pkgbuildPath, 'utf8')).resolves.toContain(
      'pkgver=1.0.0'
    )
  })
})
