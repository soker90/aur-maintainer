const INVALID_VERSION_CHARACTER = /[:/\\<>=-\\s]/

export function isSupportedPackageVersion(version: string): boolean {
  return (
    version.length > 0 &&
    /^[\\x21-\\x7e]+$/.test(version) &&
    !INVALID_VERSION_CHARACTER.test(version)
  )
}

export function assertSupportedPackageVersion(version: string): void {
  if (!isSupportedPackageVersion(version)) {
    throw new Error('Unsupported update version "' + version + '"')
  }
}

export function comparePackageVersions(left: string, right: string): number {
  if (left === right) return 0

  const leftSegments = splitVersion(left)
  const rightSegments = splitVersion(right)
  const length = Math.max(leftSegments.length, rightSegments.length)

  for (let index = 0; index < length; index += 1) {
    const comparison = compareSegment(
      leftSegments[index],
      rightSegments[index]
    )
    if (comparison !== 0) return comparison
  }

  return leftSegments.length - rightSegments.length
}

type VersionSegment = {
  parts: string[]
  delimiters: number
}

function splitVersion(version: string): VersionSegment[] {
  const segments: VersionSegment[] = []
  let delimiters = 0
  let segment = ''

  for (const character of version) {
    if (/^[A-Za-z0-9]$/.test(character)) {
      const previousIsAlpha = /[A-Za-z]$/.test(segment)
      const currentIsAlpha = /[A-Za-z]$/.test(character)
      if (segment && previousIsAlpha !== currentIsAlpha) {
        segments.push({ parts: splitAlphaNumeric(segment), delimiters })
        delimiters = 0
        segment = ''
      }
      segment += character
    } else {
      if (segment) {
        segments.push({ parts: splitAlphaNumeric(segment), delimiters })
        segment = ''
      }
      delimiters += 1
    }
  }

  if (segment || delimiters) {
    segments.push({
      parts: segment ? splitAlphaNumeric(segment) : [''],
      delimiters
    })
  }

  return segments
}

function splitAlphaNumeric(segment: string): string[] {
  return segment.match(/[A-Za-z]+|[0-9]+/g) ?? ['']
}

function compareSegment(
  left: VersionSegment | undefined,
  right: VersionSegment | undefined
): number {
  if (!left && !right) return 0
  if (!left) return compareParts([], right?.parts ?? [])
  if (!right) return -compareParts([], left.parts)

  if (left.delimiters !== right.delimiters) {
    return left.delimiters - right.delimiters
  }

  return compareParts(left.parts, right.parts)
}

function compareParts(left: string[], right: string[]): number {
  const length = Math.max(left.length, right.length)

  for (let index = 0; index < length; index += 1) {
    const leftPart = left[index]
    const rightPart = right[index]
    if (leftPart === rightPart) continue
    if (leftPart === undefined) return compareMissingPart(rightPart)
    if (rightPart === undefined) return -compareMissingPart(leftPart)

    const leftNumeric = /^\\d+$/.test(leftPart)
    const rightNumeric = /^\\d+$/.test(rightPart)
    if (leftNumeric && rightNumeric) {
      const comparison = compareNumericParts(leftPart, rightPart)
      if (comparison !== 0) return comparison
    } else if (leftNumeric !== rightNumeric) {
      return leftNumeric ? 1 : -1
    } else {
      return leftPart.localeCompare(rightPart)
    }
  }

  return 0
}

function compareMissingPart(part: string | undefined): number {
  if (part === undefined) return 0
  return /^\\d+$/.test(part) ? -1 : 1
}

function compareNumericParts(left: string, right: string): number {
  const normalizedLeft = left.replace(/^0+(?=\\d)/, '')
  const normalizedRight = right.replace(/^0+(?=\\d)/, '')
  if (normalizedLeft.length !== normalizedRight.length) {
    return normalizedLeft.length - normalizedRight.length
  }
  return normalizedLeft < normalizedRight ? -1 : 1
}
