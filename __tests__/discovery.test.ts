import { mkdir, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { discoverPackages } from '../src/discovery.js'

async function workspace(): Promise<string> {
  return mkdir(
    path.join(os.tmpdir(), `aur-discovery-${Date.now()}-${Math.random()}`),
    { recursive: true }
  ).then((dir) => dir)
}

async function packageDirectory(
  workspace: string,
  relativePath: string,
  connector: string
): Promise<void> {
  const directory = path.join(workspace, relativePath)
  await mkdir(directory, { recursive: true })
  await writeFile(path.join(directory, 'PKGBUILD'), 'pkgname=test\n')
  await writeFile(
    path.join(directory, 'update.yml'),
    `connector: ${connector}\n`
  )
}

describe('discoverPackages', () => {
  it('discovers packages from the conventional packages directory', async () => {
    const root = await workspace()
    await packageDirectory(root, 'packages/zeta-bin', 'custom')
    await packageDirectory(root, 'packages/alpha-bin', 'github-release')

    await expect(discoverPackages(root, {})).resolves.toEqual([
      expect.objectContaining({
        name: 'alpha-bin',
        config: { connector: 'github-release', config: {} }
      }),
      expect.objectContaining({
        name: 'zeta-bin',
        config: { connector: 'custom', config: {} }
      })
    ])
  })

  it('supports a package at repository root', async () => {
    const root = await workspace()
    await packageDirectory(root, '.', 'github-release')

    await expect(discoverPackages(root, {})).resolves.toHaveLength(1)
  })

  it('honours an explicit package list', async () => {
    const root = await workspace()
    await packageDirectory(root, 'packages/foo-bin', 'github-release')
    await packageDirectory(root, 'packages/bar-bin', 'custom')

    await expect(
      discoverPackages(root, { packages: ['packages/bar-bin'] })
    ).resolves.toEqual([expect.objectContaining({ name: 'bar-bin' })])
  })

  it('rejects packages outside the workspace', async () => {
    const root = await workspace()
    await expect(
      discoverPackages(root, { packages: ['../outside'] })
    ).rejects.toThrow('outside the workspace')
  })

  it('rejects directories without PKGBUILD', async () => {
    const root = await workspace()
    const directory = path.join(root, 'packages/broken')
    await mkdir(directory, { recursive: true })
    await writeFile(path.join(directory, 'update.yml'), 'connector: custom\n')

    await expect(discoverPackages(root, {})).rejects.toThrow('has no PKGBUILD')
  })

  it('ignores files in the packages directory', async () => {
    const root = await workspace()
    await mkdir(path.join(root, 'packages'), { recursive: true })
    await writeFile(path.join(root, 'packages', 'not-a-package'), 'content\n')

    await expect(discoverPackages(root, {})).resolves.toEqual([])
  })

  it('rejects a PKGBUILD path that is a directory', async () => {
    const root = await workspace()
    const directory = path.join(root, 'packages/broken')
    await mkdir(path.join(directory, 'PKGBUILD'), { recursive: true })

    await expect(discoverPackages(root, { packages: ['packages/broken'] })).rejects.toThrow(
      'has no PKGBUILD'
    )
  })
})
