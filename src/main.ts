import * as core from '@actions/core'
import { discoverPackages } from './discovery.js'
import { loadMaintainerConfig } from './config.js'
import { createConnectorRegistry } from './connectors.js'

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
      candidates.push({ package: pkg.name, candidate })
      core.info(
        `Detected ${candidate.version} for ${pkg.name} using ${pkg.config.connector}`
      )
    }

    core.setOutput('packages', JSON.stringify(candidates))
  } catch (error) {
    if (error instanceof Error) core.setFailed(error.message)
    else core.setFailed(String(error))
  }
}
