import { mkdir, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { loadMaintainerConfig, loadPackageConfig } from '../src/config.js'

async function tempDirectory(prefix: string): Promise<string> {
  return mkdir(
    path.join(os.tmpdir(), `${prefix}-${Date.now()}-${Math.random()}`),
    { recursive: true }
  )
}

describe('config', () => {
  it('loads the optional repository configuration', async () => {
    const workspace = await tempDirectory('aur-config')
    await writeFile(path.join(workspace, '.aur-maintainer.yml'), 'packages:\n  - packages/foo-bin\n')
    await expect(loadMaintainerConfig(workspace)).resolves.toEqual({ packages: ['packages/foo-bin'] })
  })

  it('returns an empty configuration when the repository file is absent', async () => {
    const workspace = await tempDirectory('aur-config')
    await expect(loadMaintainerConfig(workspace)).resolves.toEqual({})
  })

  it('requires a connector in package configuration', async () => {
    const packagePath = await tempDirectory('aur-package')
    await writeFile(path.join(packagePath, 'update.yml'), 'config: {}\n')
    await expect(loadPackageConfig(packagePath)).rejects.toThrow('"connector" is required')
  })

  it('loads package connector configuration', async () => {
    const packagePath = await tempDirectory('aur-package')
    await writeFile(path.join(packagePath, 'update.yml'), 'connector: github-release\nconfig:\n  repository: example/project\n')
    await expect(loadPackageConfig(packagePath)).resolves.toEqual({ connector: 'github-release', config: { repository: 'example/project' } })
  })
})
