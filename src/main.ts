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
import {
  createUpdatePullRequest,
  createValidationFailureIssue
} from './pull-request.js'
import { validatePackage } from './validation.js'
import { publishAurPackage } from './aur.js'
import type { PackageDefinition } from './types.js'
import { isMissingFile } from './utils.js'

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
    const autoMerge = core.getBooleanInput('auto-merge')
    const aurPublish = core.getBooleanInput('aur-publish')
    const aurPublishOnly = core.getBooleanInput('aur-publish-only')
    const aurPublishBranch = core.getInput('aur-publish-branch')
    const aurSshKey = core.getInput('aur-ssh-key')
    const aurKnownHosts = core.getInput('aur-known-hosts')
    const pullRequests: string[] = []
    core.setOutput('pull-requests', JSON.stringify(pullRequests))

    if (autoMerge && !token) {
      throw new Error('github-token is required when auto-merge is enabled')
    }

    if (aurPublishOnly) {
      if (!aurSshKey || !aurKnownHosts) {
        throw new Error(
          'aur-ssh-key and aur-known-hosts are required when AUR publishing is enabled'
        )
      }

      const updateBranch = core.getInput('update-branch') || 'update'
      const branchPrefix = `${updateBranch}/`
      if (!aurPublishBranch.startsWith(branchPrefix)) {
        throw new Error(`aur-publish-branch must start with "${branchPrefix}"`)
      }

      const packageName = aurPublishBranch.slice(branchPrefix.length)
      const packageToPublish = packages.find((pkg) => pkg.name === packageName)
      if (!packageName || packageName.includes('/') || !packageToPublish) {
        throw new Error(
          `No configured package matches merged update branch "${aurPublishBranch}"`
        )
      }

      await validatePackage(packageToPublish)
      const published = await publishAurPackage(packageToPublish, {
        sshKey: aurSshKey,
        knownHosts: aurKnownHosts
      })
      if (published) core.info(`Published ${packageToPublish.name} to the AUR`)
      else
        core.info(`AUR package ${packageToPublish.name} is already up to date`)

      core.setOutput(
        'packages',
        JSON.stringify([{ package: packageToPublish.name }])
      )
      return
    }

    const repository = process.env.GITHUB_REPOSITORY
    const manualPackageName = core.getInput('manual-package').trim()
    const manualVersion = core.getInput('manual-version').trim()

    if (manualPackageName || manualVersion) {
      if (!manualPackageName || !manualVersion) {
        throw new Error(
          'manual-package and manual-version must both be provided'
        )
      }
      if (!token) {
        throw new Error('github-token is required for manual package updates')
      }
      if (!repository) throw new Error('GITHUB_REPOSITORY is required')

      const pkg = packages.find((candidate) => candidate.name === manualPackageName)
      if (!pkg) {
        throw new Error(
          `No managed package matches manual-package "${manualPackageName}"`
        )
      }

      const snapshot: PackageSnapshot = {
        pkg,
        pkgbuild: await readFile(pkg.pkgbuildPath, 'utf8'),
        srcinfo: undefined
      }
      snapshots.push(snapshot)
      await completePackageSnapshot(snapshot)

      const update = await updatePackage(pkg, { version: manualVersion })
      await updatePackageMetadata(pkg)
      await validatePackage(pkg)

      const pullRequest = await createUpdatePullRequest(workspace, {
        token,
        repository,
        baseBranch: core.getInput('base-branch') || 'main',
        updateBranch: core.getInput('update-branch') || 'update',
        packages: [pkg],
        currentVersion: update.currentVersion,
        version: update.version,
        autoMerge,
        autoMergeTimeoutSeconds: getPositiveIntegerInput('auto-merge-timeout')
      })
      if (pullRequest) {
        pullRequests.push(pullRequest)
        core.setOutput('pull-requests', JSON.stringify(pullRequests))
        core.setOutput('pull-request', pullRequest)
      }
      core.setOutput(
        'packages',
        JSON.stringify([
          {
            package: pkg.name,
            candidate: { version: manualVersion },
            update
          }
        ])
      )
      core.info(
        update.changed
          ? `Prepared manual update for ${pkg.name}: ${update.currentVersion} to ${update.version}`
          : `Validated ${pkg.name} at ${update.version} and refreshed package metadata`
      )
      snapshots.pop()
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
    for (const pkg of packages) {
      let update: Awaited<ReturnType<typeof updatePackage>> | undefined
      let snapshot: PackageSnapshot | undefined

      try {
        if (!pkg.config.connector) {
          core.info(
            `Skipping ${pkg.name}: no version connector is configured; use manual-package and manual-version for maintenance.`
          )
          continue
        }

        const factory =
          pkg.config.connector === PACKAGE_LOCAL_CONNECTOR
            ? loadPackageConnector(pkg)
            : registry.get(pkg.config.connector)
        if (!factory) {
          throw new Error(
            `Unknown connector "${pkg.config.connector}" for package "${pkg.name}"`
          )
        }

        const candidate = await factory(registryContext).detect(
          pkg,
          pkg.config.config
        )
        update = await updatePackage(pkg, candidate)
        candidates.push({ package: pkg.name, candidate, update })

        if (!update.changed) {
          core.info(`Package ${pkg.name} is already at ${update.version}`)
          continue
        }

        snapshot = {
          pkg,
          pkgbuild: update.previousPkgbuild ?? '',
          srcinfo: undefined
        }
        snapshots.push(snapshot)
        await completePackageSnapshot(snapshot)
        await updatePackageMetadata(pkg)

        try {
          await validatePackage(pkg)
        } catch (validationError) {
          if (!token || !repository) throw validationError

          const issue = await createValidationFailureIssue(workspace, {
            token,
            repository,
            baseBranch: core.getInput('base-branch') || 'main',
            updateBranch: core.getInput('update-branch') || 'update',
            pkg,
            currentVersion: update.currentVersion,
            version: update.version,
            error: validationError
          })
          core.setOutput('validation-failure-issue', issue)
          core.error(
            `Validation failed for ${pkg.name}; changes preserved and issue created: ${issue}`
          )
          core.setFailed(
            validationError instanceof Error
              ? validationError.message
              : String(validationError)
          )
          snapshots.pop()
          continue
        }

        if (aurPublish) {
          if (!aurSshKey || !aurKnownHosts) {
            throw new Error(
              'aur-ssh-key and aur-known-hosts are required when AUR publishing is enabled'
            )
          }
          const published = await publishAurPackage(pkg, {
            sshKey: aurSshKey,
            knownHosts: aurKnownHosts
          })
          if (published) core.info(`Published ${pkg.name} to the AUR`)
          else core.info(`AUR package ${pkg.name} is already up to date`)
        }

        if (token) {
          if (!repository) throw new Error('GITHUB_REPOSITORY is required')
          const pullRequest = await createUpdatePullRequest(workspace, {
            token,
            repository,
            baseBranch: core.getInput('base-branch') || 'main',
            updateBranch: core.getInput('update-branch') || 'update',
            packages: [pkg],
            currentVersion: update.currentVersion,
            version: update.version,
            autoMerge,
            autoMergeTimeoutSeconds:
              getPositiveIntegerInput('auto-merge-timeout')
          })
          if (pullRequest) pullRequests.push(pullRequest)
        } else {
          core.warning(
            `Updated ${pkg.name}, but github-token was not provided; ` +
              'no GitHub branch or pull request was created.'
          )
        }

        core.info(
          `Updated ${pkg.name} from ${update.currentVersion} to ${update.version}`
        )
        snapshots.pop()
      } catch (caught) {
        if (update?.changed) {
          await rollbackPackageUpdate(pkg, update)
          if (snapshot) {
            const snapshotIndex = snapshots.indexOf(snapshot)
            if (snapshotIndex >= 0) snapshots.splice(snapshotIndex, 1)
          }
        }
        const message =
          caught instanceof Error ? caught.message : String(caught)
        core.error(`Failed to process ${pkg.name}: ${message}`)
        core.setFailed(message)
      }
    }

    core.setOutput('packages', JSON.stringify(candidates))

    if (pullRequests.length > 0) {
      core.setOutput('pull-requests', JSON.stringify(pullRequests))
      core.setOutput('pull-request', pullRequests[0])
    }
  } catch (error) {
    await rollbackSnapshots(snapshots)
    if (error instanceof Error) core.setFailed(error.message)
    else core.setFailed(String(error))
  }
}

function getPositiveIntegerInput(name: string): number {
  const value = core.getInput(name)
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer`)
  }
  return parsed
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
