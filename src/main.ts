import * as core from '@actions/core'
import { readFile, unlink, writeFile } from 'node:fs/promises'
import { discoverPackages } from './discovery.js'
import { loadMaintainerConfig } from './config.js'
import {
  loadPackageConnector,
  loadRepositoryConnectors,
  PACKAGE_LOCAL_CONNECTOR
} from './connectors.js'
import { updatePackageMetadata } from './metadata.js'
import { rollbackPackageUpdate, updatePackage } from './update.js'
import { createUpdatePullRequest } from './pull-request.js'
import { validatePackage } from './validation.js'
import { publishAurPackage } from './aur.js'
import type { PackageDefinition } from './types.js'

interface PackageSnapshot {
  pkg: PackageDefinition
  pkgbuild: string
  srcinfo: string | undefined
}

export async function run(): Promise<void> {
  const snapshots: PackageSnapshot[] = []

  try {
    const workspace = process.env.GITHUB_WORKSPACE ?? process.cwd()
    const configPath = core.getInput('config') || '.aur-maintainer.yml'
    const config = await loadMaintainerConfig(workspace, configPath)
    const packages = await discoverPackages(workspace, config)
    const token = core.getInput('github-token')
    const aurPublish = core.getBooleanInput('aur-publish')
    const aurPublishOnly = core.getBooleanInput('aur-publish-only')
    const aurSshKey = core.getInput('aur-ssh-key')
    const aurKnownHosts = core.getInput('aur-known-hosts')

    if (aurPublishOnly) {
      if (!aurSshKey || !aurKnownHosts) {
        throw new Error(
          'aur-ssh-key and aur-known-hosts are required when AUR publishing is enabled'
        )
      }
      for (const pkg of packages) {
        const published = await publishAurPackage(pkg, {
          sshKey: aurSshKey,
          knownHosts: aurKnownHosts
        })
        if (published) core.info(`Published ${pkg.name} to the AUR`)
        else core.info(`AUR package ${pkg.name} is already up to date`)
      }
      return
    }

    const registryContext = {
      fetch: (input: string | URL, init?: RequestInit) => fetch(input, init),
      token: token || undefined
    }
    const registry = await loadRepositoryConnectors(workspace, registryContext)

    if (packages.length === 0) {
      core.info('No managed AUR packages found.')
      return
    }

    const candidates = []
    const updatedPackages = []
    for (const pkg of packages) {
      const factory =
        pkg.config.connector === PACKAGE_LOCAL_CONNECTOR
          ? loadPackageConnector(pkg)
          : registry.get(pkg.config.connector)
      if (!factory)
        throw new Error(
          `Unknown connector "${pkg.config.connector}" for package "${pkg.name}"`
        )
      const candidate = await factory(registryContext).detect(
        pkg,
        pkg.config.config
      )
      const update = await updatePackage(pkg, candidate)
      candidates.push({ package: pkg.name, candidate, update })
      if (update.changed) {
        const snapshot: PackageSnapshot = {
          pkg,
          pkgbuild: update.previousPkgbuild ?? '',
          srcinfo: undefined
        }
        snapshots.push(snapshot)
        try {
          await completePackageSnapshot(snapshot)
        } catch (error) {
          await rollbackPackageUpdate(pkg, update)
          snapshots.pop()
          throw error
        }
        try {
          await updatePackageMetadata(pkg)
          await validatePackage(pkg)
          updatedPackages.push(pkg)
          core.info(
            `Updated ${pkg.name} from ${update.currentVersion} to ${update.version}`
          )
        } catch (error) {
          await rollbackPackageUpdate(pkg, update)
          throw error
        }
      } else {
        core.info(`Package ${pkg.name} is already at ${update.version}`)
      }
    }

    core.setOutput('packages', JSON.stringify(candidates))

    if (aurPublish) {
      if (!aurSshKey || !aurKnownHosts) {
        throw new Error(
          'aur-ssh-key and aur-known-hosts are required when AUR publishing is enabled'
        )
      }
      for (const pkg of packages) {
        const published = await publishAurPackage(pkg, {
          sshKey: aurSshKey,
          knownHosts: aurKnownHosts
        })
        if (published) core.info(`Published ${pkg.name} to the AUR`)
        else core.info(`AUR package ${pkg.name} is already up to date`)
      }
    }

    if (token && updatedPackages.length > 0) {
      const repository = process.env.GITHUB_REPOSITORY
      if (!repository) throw new Error('GITHUB_REPOSITORY is required')
      const pullRequest = await createUpdatePullRequest(workspace, {
        token,
        repository,
        baseBranch: core.getInput('base-branch') || 'main',
        updateBranch:
          core.getInput('update-branch') || 'aur-maintainer/updates',
        packages: updatedPackages,
        autoMerge: core.getBooleanInput('auto-merge')
      })
      if (pullRequest) core.setOutput('pull-request', pullRequest)
    }
  } catch (error) {
    await rollbackSnapshots(snapshots)
    if (error instanceof Error) core.setFailed(error.message)
    else core.setFailed(String(error))
  }
}

async function completePackageSnapshot(
  snapshot: PackageSnapshot
): Promise<void> {
  const pkg = snapshot.pkg
  let srcinfo: string | undefined
  try {
    srcinfo = await readFile(pkg.srcinfoPath, 'utf8')
  } catch (error) {
    if (!isMissingFile(error)) throw error
  }

  snapshot.srcinfo = srcinfo
}

async function rollbackSnapshots(snapshots: PackageSnapshot[]): Promise<void> {
  for (const snapshot of snapshots.toReversed()) {
    await writeFile(snapshot.pkg.pkgbuildPath, snapshot.pkgbuild)
    if (snapshot.srcinfo === undefined) {
      await unlink(snapshot.pkg.srcinfoPath).catch((error: unknown) => {
        if (!isMissingFile(error)) throw error
      })
    } else {
      await writeFile(snapshot.pkg.srcinfoPath, snapshot.srcinfo)
    }
  }
}

function isMissingFile(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'ENOENT'
  )
}
