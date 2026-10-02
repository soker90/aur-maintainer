import * as core from '@actions/core'
import path from 'node:path'
import { discoverPackages } from './discovery.js'
import { loadMaintainerConfig } from './config.js'

export async function run(): Promise<void> {
  try {
    const workspace = process.env.GITHUB_WORKSPACE ?? process.cwd()
    const configPath = core.getInput('config') || '.aur-maintainer.yml'
    const config = await loadMaintainerConfig(workspace, configPath)
    const packages = await discoverPackages(workspace, config)

    if (packages.length === 0) {
      core.info('No managed AUR packages found.')
      return
    }

    for (const pkg of packages) {
      core.info(
        `Discovered ${pkg.name} (connector: ${pkg.config.connector})`
      )
    }

    core.setOutput('packages', JSON.stringify(packages.map((pkg) => pkg.name)))
  } catch (error) {
    if (error instanceof Error) core.setFailed(error.message)
    else core.setFailed(String(error))
  }
}
