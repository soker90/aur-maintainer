export interface MaintainerConfig {
  packages?: string[]
}

export interface PackageConfig {
  connector: string
  config: Record<string, unknown>
}

export interface PackageDefinition {
  name: string
  path: string
  pkgbuildPath: string
  srcinfoPath: string
  updateConfigPath: string
  config: PackageConfig
}

export interface UpdateCandidate {
  version: string
  source?: string
  sha256?: string
  metadata?: Record<string, string>
}
