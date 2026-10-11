import { execFile as execFileCallback } from 'node:child_process'
import path from 'node:path'
import { promisify } from 'node:util'
import { stat } from 'node:fs/promises'
import { DEFAULT_PACKAGE_CONNECTOR_TIMEOUT } from '../../config.js'
import type { PackageDefinition, UpdateCandidate } from '../../types.js'
import type { Connector, PackageLocalConnectorOutput } from '../types.js'

const execFile = promisify(execFileCallback)

export function createCustomConnector(pkg: PackageDefinition): Connector {
  const scriptPath = path.join(pkg.path, 'connector', 'detect.sh')
  return {
    name: 'custom',
    detect: async () => detectWithScript(pkg, scriptPath)
  }
}

async function detectWithScript(
  pkg: PackageDefinition,
  scriptPath: string
): Promise<UpdateCandidate> {
  if (!(await isFile(scriptPath))) {
    throw new Error(
      `Package "${pkg.name}" custom connector must provide connector/detect.sh`
    )
  }

  let result: { stdout: string }
  try {
    result = await execFile('bash', [scriptPath], {
      cwd: pkg.path,
      timeout: (pkg.config.timeout ?? DEFAULT_PACKAGE_CONNECTOR_TIMEOUT) * 1000,
      killSignal: 'SIGTERM',
      env: {
        ...process.env,
        AUR_MAINTAINER_PACKAGE: pkg.name,
        AUR_MAINTAINER_PACKAGE_PATH: pkg.path,
        AUR_MAINTAINER_CONFIG_JSON: JSON.stringify(pkg.config.config)
      }
    })
  } catch (error) {
    if (isTimeoutError(error)) {
      throw new Error(
        `Package "${pkg.name}" custom connector timed out after ${
          pkg.config.timeout ?? DEFAULT_PACKAGE_CONNECTOR_TIMEOUT
        } seconds`,
        { cause: error }
      )
    }
    throw error
  }

  return parseCustomConnectorOutput(pkg.name, result.stdout)
}

function isTimeoutError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false

  const candidate = error as {
    code?: unknown
    killed?: unknown
    signal?: unknown
  }

  if (candidate.code === 'ETIMEDOUT') return true
  return candidate.killed === true && candidate.signal === 'SIGTERM'
}

function parseCustomConnectorOutput(
  packageName: string,
  output: string
): UpdateCandidate {
  const values = new Map<string, string>()
  for (const line of output.split(/\r?\n/)) {
    if (!line.trim()) continue
    const separator = line.indexOf('=')
    if (separator <= 0) {
      throw new Error(
        `Package "${packageName}" custom connector produced an invalid output line`
      )
    }

    const key = line.slice(0, separator)
    const value = line.slice(separator + 1)
    if (!['version', 'source', 'sha256'].includes(key)) {
      throw new Error(
        `Package "${packageName}" custom connector produced unknown output "${key}"`
      )
    }
    if (values.has(key)) {
      throw new Error(
        `Package "${packageName}" custom connector produced duplicate output "${key}"`
      )
    }
    if (!value) {
      throw new Error(
        `Package "${packageName}" custom connector produced an empty "${key}"`
      )
    }
    values.set(key, value)
  }

  const version = values.get('version')
  const source = values.get('source')
  const sha256 = values.get('sha256')
  if (!version || !source || !sha256) {
    throw new Error(
      `Package "${packageName}" custom connector must output version, source and sha256`
    )
  }

  const result: PackageLocalConnectorOutput = { version, source, sha256 }
  return result
}

async function isFile(filePath: string): Promise<boolean> {
  try {
    return (await stat(filePath)).isFile()
  } catch {
    return false
  }
}
