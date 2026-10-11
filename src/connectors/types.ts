import type { PackageDefinition, UpdateCandidate } from '../types.js'

export interface Connector {
  readonly name: string
  detect(
    pkg: PackageDefinition,
    config: Record<string, unknown>
  ): Promise<UpdateCandidate>
}

export const PACKAGE_LOCAL_CONNECTOR = 'custom' as const

export interface PackageLocalConnectorOutput {
  version: string
  source: string
  sha256: string
}

export interface ConnectorContext {
  fetch(input: string | URL, init?: RequestInit): Promise<Response>
  token?: string
}

export type ConnectorFactory = (context: ConnectorContext) => Connector
