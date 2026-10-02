import { describe, expect, it } from '@jest/globals'
import {
  assertSupportedPackageVersion,
  comparePackageVersions,
  isSupportedPackageVersion
} from '../src/version.js'

describe('package versions', () => {
  it('accepts valid ALPM versions', () => {
    expect(isSupportedPackageVersion('1.2.3')).toBe(true)
    expect(isSupportedPackageVersion('1.2.3alpha')).toBe(true)
    expect(isSupportedPackageVersion('2026_10')).toBe(true)
    expect(isSupportedPackageVersion('1.2.3+build.4')).toBe(true)
  })

  it('rejects characters forbidden by ALPM', () => {
    for (const version of [
      '',
      '1.2-rc1',
      '1:2.3',
      '1/2.3',
      '1.2.3 rc1',
      '1.2.3=4'
    ]) {
      expect(isSupportedPackageVersion(version)).toBe(false)
    }
  })

  it('throws for unsupported versions', () => {
    expect(() => assertSupportedPackageVersion('release-latest')).toThrow(
      'Unsupported update version'
    )
  })

  it('compares numeric and alphanumeric versions', () => {
    expect(comparePackageVersions('1.10.0', '1.9.9')).toBeGreaterThan(0)
    expect(comparePackageVersions('1.0.0', '1.0.0alpha')).toBeGreaterThan(0)
    expect(comparePackageVersions('1.0.0alpha', '1.0.0beta')).toBeLessThan(0)
  })
})
