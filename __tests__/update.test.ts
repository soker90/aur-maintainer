import { describe, expect, it } from '@jest/globals'
import { readPkgver, replacePkgver } from '../src/update.js'

describe('package updates', () => {
  it('reads a single pkgver assignment', () => {
    expect(readPkgver('pkgname=demo\npkgver=1.2.3\npkgrel=1\n')).toBe('1.2.3')
  })

  it('replaces only the pkgver assignment', () => {
    const content = [
      'pkgname=demo',
      'pkgver=1.2.3',
      'pkgrel=1',
      'source=("demo-$pkgver.tar.gz")',
      ''
    ].join('\n')
    expect(replacePkgver(content, '1.3.0')).toBe([
      'pkgname=demo',
      'pkgver=1.3.0',
      'pkgrel=1',
      'source=("demo-$pkgver.tar.gz")',
      ''
    ].join('\n'))
  })

  it('rejects multiple pkgver assignments', () => {
    expect(() => readPkgver('pkgver=1.0.0\npkgver=2.0.0\n')).toThrow(
      'exactly one simple pkgver assignment'
    )
  })

  it('rejects unsupported versions', () => {
    expect(() => replacePkgver('pkgver=1.0.0\n', 'latest')).toThrow(
      'Unsupported update version'
    )
  })
})
