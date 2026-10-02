import * as core from '@actions/core'
import { discoverPackages } from './discovery.js'
import { loadMaintainerConfig } from './config.js'
import { createConnectorRegistry } from './connectors.js'
import { updatePackageMetadata } from './metadata.js'
import { rollbackPackageUpdate, updatePackage } from './update.js'
import { createUpdatePullRequest } from './pull-request.js'
import { validatePackage } from './validation.js'

export async function run(): Promise<void> {
  try {
    const workspace = process.env.GITHUB_WORKSPACE ?? process.cwd()
    const configPath = core.getInput('config') || '.aur-maintainer.yml'
    const config = await loadMaintainerConfig(workspace, configPath)
    const packages = await discoverPackages(workspace, config)

    const registryContext = {
      fetch: (input: string | URL, init?: RequestInit) => fetch(input, init)
    }
    const registry = createConnectorRegistry(registryContext)

    if (packages.length === 0) {
      core.info('No managed AUR packages found.')
      return
    }

    const candidates = []
    const updatedPackages = []
    for (const pkg of packages) {
      const factory = registry.get(pkg.config.connector)
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

    const token = core.getInput('github-token')
    if (token && updatedPackages.length > 0) {
      const repository = process.env.GITHUB_REPOSITORY
      if (!repository) throw new Error('GITHUB_REPOSITORY is required')
      const pullRequest = await createUpdatePullRequest(workspace, {
        token,
        repository,
        baseBranch: core.getInput('base-branch') || 'main',
        updateBranch:
          core.getInput('update-branch') || 'aur-maintainer/updates',
        packages: updatedPackages
      })
      if (pullRequest) core.setOutput('pull-request', pullRequest)
    }
  } catch (error) {
    if (error instanceof Error) core.setFailed(error.message)
    else core.setFailed(String(error))
  }
}
