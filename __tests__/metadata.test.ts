import { mkdtemp, readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it, jest } from '@jest/globals'
import type { PackageDefinition } from '../src/types.js'
import { updatePackageMetadata } from '../src/metadata.js'

describe('package metadata updates', () => {
  it('updates checksums and writes generated SRCINFO', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'aur-maintainer-'))
    const pkg = {
      name: 'demo',
      path: directory,
      pkgbuildPath: path.join(directory, 'PKGBUILD'),
      srcinfoPath: path.join(directory, '.SRCINFO'),
      updateConfigPath: path.join(directory, 'update.yml'),
      config: { connector: 'github-release', config: {} }
    } satisfies PackageDefinition
    const run = jest
      .fn()
      .mockResolvedValueOnce('')
      .mockResolvedValueOnce('pkgbase = demo\n\tpkgver = 1.1.0\n')

    await updatePackageMetadata(pkg, { run })

    await expect(readFile(pkg.srcinfoPath, 'utf8')).resolves.toBe(
      'pkgbase = demo\n\tpkgver = 1.1.0\n'
    )
    expect(run).toHaveBeenNthCalledWith(1, 'updpkgsums', [
      '--nocolor',
      pkg.pkgbuildPath
    ])
    expect(run).toHaveBeenNthCalledWith(
      2,
      'makepkg',
      ['--printsrcinfo'],
      pkg.path
    )
  })
})
