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
      config: { connector: 'github-release', config: {}, updates: {} }
    } satisfies PackageDefinition

    await expect(updatePackage(pkg, { version: '1.1.0' })).resolves.toEqual({
      changed: true,
      currentVersion: '1.0.0',
      version: '1.1.0',
      previousPkgbuild: 'pkgname=demo\npkgver=1.0.0\npkgrel=1\n'
    })
    await expect(readFile(pkgbuildPath, 'utf8')).resolves.toContain(
      'pkgver=1.1.0'
    )
  })

  it('updates source and checksum fields from connector metadata', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'aur-maintainer-'))
    const pkgbuildPath = path.join(directory, 'PKGBUILD')
    await writeFile(
      pkgbuildPath,
      [
        'pkgname=demo',
        'pkgver=1.0.0',
        '_sha256=old',
        'source=("demo-1.0.0.tar.gz::https://example.test/old.tar.gz")',
        ''
      ].join('\n')
    )
    const pkg = {
      name: 'demo',
      path: directory,
      pkgbuildPath,
      srcinfoPath: path.join(directory, '.SRCINFO'),
      updateConfigPath: path.join(directory, 'update.yml'),
      config: {
        connector: 'custom',
        config: {},
        updates: {
          source: 'source=("demo-${version}.tar.gz::${source}")',
          sha256: '_sha256=${sha256}'
        }
      }
    } satisfies PackageDefinition

    await expect(
      updatePackage(pkg, {
        version: '1.0.0',
        source: 'https://example.test/demo-1.0.0.tar.gz',
        sha256: 'new'
      })
    ).resolves.toMatchObject({
      changed: true,
      currentVersion: '1.0.0',
      version: '1.0.0'
    })

    await expect(readFile(pkgbuildPath, 'utf8')).resolves.toBe(
      [
        'pkgname=demo',
        'pkgver=1.0.0',
        '_sha256=new',
        'source=("demo-1.0.0.tar.gz::https://example.test/demo-1.0.0.tar.gz")',
        ''
      ].join('\n')
    )
  })

  it('updates version-derived assignments when the connector only returns a version', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'aur-maintainer-'))
    const pkgbuildPath = path.join(directory, 'PKGBUILD')
    const original = [
      'pkgname=nodejs-npm-check',
      '_npmname=npm-check',
      '_npmver=6.0.1',
      'pkgver=6.0.1',
      'source=(http://registry.npmjs.org/$_npmname/-/$_npmname-$_npmver.tgz)',
      "sha1sums=('old')",
      ''
    ].join('\\n')
    await writeFile(pkgbuildPath, original)
    const pkg = {
      name: 'nodejs-npm-check',
      path: directory,
      pkgbuildPath,
      srcinfoPath: path.join(directory, '.SRCINFO'),
      updateConfigPath: path.join(directory, 'update.yml'),
      config: {
        connector: 'github-release',
        config: { repository: 'dylang/npm-check' },
        updates: { version: '_npmver=${version}' }
      }
    } satisfies PackageDefinition

    await expect(updatePackage(pkg, { version: '6.1.0' })).resolves.toMatchObject({
      changed: true,
      currentVersion: '6.0.1',
      version: '6.1.0'
    })
    await expect(readFile(pkgbuildPath, 'utf8')).resolves.toBe([
      'pkgname=nodejs-npm-check',
      '_npmname=npm-check',
      '_npmver=6.1.0',
      'pkgver=6.1.0',
      'source=(http://registry.npmjs.org/$_npmname/-/$_npmname-$_npmver.tgz)',
      "sha1sums=('old')",
      ''
    ].join('\\n'))
  })

  it('ignores optional connector metadata without update mappings', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'aur-maintainer-'))
    const pkgbuildPath = path.join(directory, 'PKGBUILD')
    await writeFile(pkgbuildPath, 'pkgname=demo\npkgver=1.0.0\n')
    const pkg = {
      name: 'demo',
      path: directory,
      pkgbuildPath,
      srcinfoPath: path.join(directory, '.SRCINFO'),
      updateConfigPath: path.join(directory, 'update.yml'),
      config: { connector: 'custom', config: {}, updates: {} }
    } satisfies PackageDefinition

    await expect(
      updatePackage(pkg, {
        version: '1.0.0',
        source: 'https://example.test/demo.tar.gz',
        sha256: 'new'
      })
    ).resolves.toEqual({
      changed: false,
      currentVersion: '1.0.0',
      version: '1.0.0'
    })
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
