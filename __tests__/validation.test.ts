import { describe, expect, it, jest } from '@jest/globals'
import type { PackageDefinition } from '../src/types.js'
import { validatePackage } from '../src/validation.js'

describe('package validation', () => {
  it('runs makepkg and namcap with the package directory', async () => {
    const pkg = {
      name: 'demo',
      path: '/workspace/demo',
      pkgbuildPath: '/workspace/demo/PKGBUILD',
      srcinfoPath: '/workspace/demo/.SRCINFO',
      updateConfigPath: '/workspace/demo/update.yml',
      config: { connector: 'github-release', config: {} }
    } satisfies PackageDefinition
    const run = jest.fn().mockResolvedValueOnce('').mockResolvedValueOnce('')

    await validatePackage(pkg, { run })

    expect(run).toHaveBeenNthCalledWith(
      1,
      'makepkg',
      ['--nobuild', '--nodeps', '--noconfirm', '--nocolor'],
      pkg.path
    )
    expect(run).toHaveBeenNthCalledWith(2, 'namcap', [pkg.pkgbuildPath])
  })
})
