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

  it('matches ALPM numeric and alphanumeric ordering', () => {
    const orderedVersions = [
      '1.0a',
      '1.0b',
      '1.0beta',
      '1.0p',
      '1.0pre',
      '1.0rc',
      '1.0',
      '1.0.a',
      '1.0.1'
    ]

    for (let index = 1; index < orderedVersions.length; index += 1) {
      expect(
        comparePackageVersions(
          orderedVersions[index - 1]!,
          orderedVersions[index]!
        )
      ).toBeLessThan(0)
    }
  })

  it('compares numeric and alphanumeric sub-segments correctly', () => {
    expect(comparePackageVersions('1.10.0', '1.9.9')).toBeGreaterThan(0)
    expect(comparePackageVersions('1.0.0', '1.0.0alpha')).toBeGreaterThan(0)
    expect(comparePackageVersions('1.0.0alpha', '1.0.0beta')).toBeLessThan(0)
    expect(comparePackageVersions('1.0alpha', '1.0.1')).toBeLessThan(0)
    expect(comparePackageVersions('1.0', '1.0foo.2')).toBeGreaterThan(0)
    expect(comparePackageVersions('1.foo', '1.foo2')).toBeLessThan(0)
  })

  it('handles delimiter counts and trailing delimiters', () => {
    expect(comparePackageVersions('1...0', '1.2')).toBeGreaterThan(0)
    expect(comparePackageVersions('1...', '1.')).toBe(0)
  })
})
