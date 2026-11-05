import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { jest } from '@jest/globals'
import {
  getAurPackageFiles,
  MAX_AUR_BLOB_SIZE,
  normalizeSshKey,
  publishAurPackage
} from '../src/aur.js'
import type { PackageDefinition } from '../src/types.js'

describe('AUR publishing', () => {
  const originalRunnerTemp = process.env.RUNNER_TEMP

  afterEach(() => {
    if (originalRunnerTemp === undefined) delete process.env.RUNNER_TEMP
    else process.env.RUNNER_TEMP = originalRunnerTemp
  })

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

  async function createPackageDirectory(): Promise<string> {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'aur-publish-'))
    await writeFile(path.join(directory, 'PKGBUILD'), 'pkgname=example-bin\n')
    await writeFile(path.join(directory, '.SRCINFO'), 'pkgbase = example-bin\n')
    return directory
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

  it('rejects oversized files in the current package before contacting AUR', async () => {
    const directory = await createPackageDirectory()
    await writeFile(
      path.join(directory, 'local.patch'),
      Buffer.alloc(MAX_AUR_BLOB_SIZE + 1)
    )
    const run = jest.fn()

    await expect(
      publishAurPackage(
        { ...pkg, path: directory },
        { sshKey: 'PRIVATE KEY', knownHosts: 'KNOWN HOST' },
        { run }
      )
    ).rejects.toThrow(/local\.patch.*500000-byte blob limit/)

    expect(run).not.toHaveBeenCalled()
  })

  it('publishes a changed package without rewriting clean AUR history', async () => {
    const directory = await createPackageDirectory()
    const packageDefinition = { ...pkg, path: directory }
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
      ['rm', '-r', '--ignore-unmatch', '--', '.'],
      expect.any(String),
      expect.any(Object)
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

  it('requires explicit history-rewrite opt-in when old oversized blobs exist', async () => {
    const directory = await createPackageDirectory()
    const run = jest
      .fn()
      .mockImplementation(async (_command: string, args: string[]) => {
        if (args[0] === 'clone') await mkdir(args[2], { recursive: true })
        if (_command === 'bash') {
          return 'blob 0123456789012345678901234567890123456789 600001 old.patch\n'
        }
        return ''
      })

    await expect(
      publishAurPackage(
        { ...pkg, path: directory },
        { sshKey: 'PRIVATE KEY', knownHosts: 'KNOWN HOST' },
        { run }
      )
    ).rejects.toThrow(/aur-rewrite-history/)

    expect(run.mock.calls.some((call) => call[1]?.[0] === 'bundle')).toBe(false)
    expect(run.mock.calls.some((call) => call[1]?.[0] === 'push')).toBe(false)
  })

  it('backs up and sanitizes oversized AUR history before force-pushing', async () => {
    const directory = await createPackageDirectory()
    const runnerTemp = await mkdtemp(path.join(os.tmpdir(), 'aur-runner-'))
    process.env.RUNNER_TEMP = runnerTemp
    let historyScans = 0
    const run = jest
      .fn()
      .mockImplementation(async (_command: string, args: string[]) => {
        if (args[0] === 'clone') await mkdir(args[2], { recursive: true })
        if (_command === 'bash') {
          historyScans += 1
          return historyScans === 1
            ? 'blob 0123456789012345678901234567890123456789 600001 old.patch\n'
            : ''
        }
        if (args[0] === 'status') return ' M PKGBUILD\n'
        return ''
      })

    await expect(
      publishAurPackage(
        { ...pkg, path: directory },
        {
          sshKey: 'PRIVATE KEY',
          knownHosts: 'KNOWN HOST',
          rewriteHistory: true
        },
        { run }
      )
    ).resolves.toBe(true)

    const backupPath = path.join(
      runnerTemp,
      'aur-maintainer-aur-backups',
      'example-bin.bundle'
    )
    expect(run).toHaveBeenCalledWith(
      'git',
      ['bundle', 'create', backupPath, '--all'],
      expect.any(String),
      expect.any(Object)
    )
    expect(run).toHaveBeenCalledWith(
      'git',
      [
        'filter-branch',
        '--force',
        '--tree-filter',
        'find . -type f -size +500000c -delete',
        '--',
        'master'
      ],
      expect.any(String),
      expect.objectContaining({ FILTER_BRANCH_SQUELCH_WARNING: '1' })
    )
    expect(run).toHaveBeenCalledWith(
      'git',
      ['push', '--force', 'origin', 'master'],
      expect.any(String),
      expect.objectContaining({
        AUR_OVERWRITE: '1',
        GIT_SSH_COMMAND: expect.stringContaining('SendEnv=AUR_OVERWRITE')
      })
    )
    expect(historyScans).toBe(2)
  })
  it('pushes sanitized history even when package files are already synchronized', async () => {
    const directory = await createPackageDirectory()
    const runnerTemp = await mkdtemp(path.join(os.tmpdir(), 'aur-runner-'))
    process.env.RUNNER_TEMP = runnerTemp
    let historyScans = 0
    const run = jest
      .fn()
      .mockImplementation(async (_command: string, args: string[]) => {
        if (args[0] === 'clone') await mkdir(args[2], { recursive: true })
        if (_command === 'bash') {
          historyScans += 1
          return historyScans === 1
            ? 'blob 0123456789012345678901234567890123456789 600001 old.patch\n'
            : ''
        }
        return ''
      })

    await expect(
      publishAurPackage(
        { ...pkg, path: directory },
        {
          sshKey: 'PRIVATE KEY',
          knownHosts: 'KNOWN HOST',
          rewriteHistory: true
        },
        { run }
      )
    ).resolves.toBe(true)

    expect(run.mock.calls.some((call) => call[1]?.[0] === 'commit')).toBe(false)
    expect(run).toHaveBeenCalledWith(
      'git',
      ['push', '--force', 'origin', 'master'],
      expect.any(String),
      expect.objectContaining({ AUR_OVERWRITE: '1' })
    )
  })
})
