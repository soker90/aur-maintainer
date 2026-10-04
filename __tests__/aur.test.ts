import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { jest } from '@jest/globals'
import {
  getAurPackageFiles,
  normalizeSshKey,
  publishAurPackage
} from '../src/aur.js'
import type { PackageDefinition } from '../src/types.js'

describe('AUR publishing', () => {
  it('normalizes SSH keys from common secret formats', () => {
    const crlfKey = '-----BEGIN KEY-----\r\nabc\r\n-----END KEY-----'
    const lfKey = '-----BEGIN KEY-----\nabc\n-----END KEY-----'
    const expected = '-----BEGIN KEY-----\nabc\n-----END KEY-----\n'

    expect(normalizeSshKey(crlfKey)).toBe(expected)
    expect(normalizeSshKey(lfKey)).toBe(expected)
  })

  const pkg: PackageDefinition = {
    name: 'example-bin',
    path: '',
    pkgbuildPath: '',
    srcinfoPath: '',
    updateConfigPath: '',
    config: {
      connector: 'github-release',
      config: {}
    }
  }

  it('selects package files without maintainer-only metadata', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'aur-files-'))
    await writeFile(path.join(directory, 'PKGBUILD'), 'pkgname=example-bin\n')
    await writeFile(path.join(directory, '.SRCINFO'), 'pkgbase = example-bin\n')
    await writeFile(path.join(directory, 'example-bin.install'), '')
    await writeFile(path.join(directory, 'LICENSE'), '')
    await writeFile(path.join(directory, 'update.yml'), '')
    await mkdir(path.join(directory, 'connector'))

    await expect(getAurPackageFiles(directory)).resolves.toEqual([
      'PKGBUILD',
      '.SRCINFO',
      'LICENSE',
      'example-bin.install'
    ])
  })

  it('publishes a changed package to the AUR master branch', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'aur-publish-'))
    const packageDefinition = { ...pkg, path: directory }
    await writeFile(path.join(directory, 'PKGBUILD'), 'pkgname=example-bin\n')
    await writeFile(path.join(directory, '.SRCINFO'), 'pkgbase = example-bin\n')

    const run = jest
      .fn()
      .mockImplementation(async (_command: string, args: string[]) => {
        if (args[0] === 'clone') {
          await mkdir(args[2], { recursive: true })
        }
        if (args[0] === 'status') return ' M PKGBUILD\n'
        return ''
      })

    await expect(
      publishAurPackage(
        packageDefinition,
        { sshKey: 'PRIVATE KEY', knownHosts: 'KNOWN HOST' },
        { run }
      )
    ).resolves.toBe(true)

    expect(run).toHaveBeenCalledWith(
      'git',
      [
        'clone',
        'ssh://aur@aur.archlinux.org/example-bin.git',
        expect.any(String)
      ],
      undefined,
      expect.objectContaining({
        GIT_SSH_COMMAND: expect.stringContaining('StrictHostKeyChecking=yes')
      })
    )
    expect(run).toHaveBeenCalledWith(
      'git',
      ['push', 'origin', 'master'],
      expect.any(String),
      expect.objectContaining({
        GIT_SSH_COMMAND: expect.stringContaining('UserKnownHostsFile=')
      })
    )

    expect(
      run.mock.calls.some(
        (call) => call[1]?.[0] === 'add' && call[1]?.[1] === '-A'
      )
    ).toBe(true)
  })
})
