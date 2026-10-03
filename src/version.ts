const INVALID_VERSION_CHARACTER = /[-:/<>=\s]/

export function isSupportedPackageVersion(version: string): boolean {
  return (
    /\d/.test(version) &&
    version.length > 0 &&
    /^[\x21-\x7e]+$/.test(version) &&
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

  for (
    let index = 0;
    index < Math.max(leftSegments.length, rightSegments.length);
    index += 1
  ) {
    const leftSegment = leftSegments[index]
    const rightSegment = rightSegments[index]

    if (!leftSegment || !rightSegment) {
      if (!leftSegment && !rightSegment) return 0
      return leftSegment ? 1 : -1
    }

    if (
      leftSegment.delimiters !== rightSegment.delimiters &&
      !isTrailingEmptySegment(leftSegments, index) &&
      !isTrailingEmptySegment(rightSegments, index)
    ) {
      return leftSegment.delimiters - rightSegment.delimiters
    }

    const comparison = compareSegmentParts(
      leftSegment.parts,
      rightSegment.parts
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
  let parts: string[] = []

  for (const character of version) {
    if (/^[A-Za-z0-9]$/.test(character)) {
      if (
        segment &&
        /[A-Za-z]$/.test(segment) !== /[A-Za-z]$/.test(character)
      ) {
        parts.push(segment)
        segment = ''
      }
      segment += character
    } else {
      if (segment) {
        parts.push(segment)
        segment = ''
      }

      if (parts.length > 0) {
        segments.push({ parts, delimiters })
        parts = []
        delimiters = 1
      } else {
        delimiters += 1
      }
    }
  }

  if (segment) parts.push(segment)
  if (parts.length || delimiters) {
    segments.push({
      parts: parts.flatMap(splitAlphaNumeric),
      delimiters
    })
  }

  return segments
}

function splitAlphaNumeric(segment: string): string[] {
  return segment.match(/[A-Za-z]+|[0-9]+/g) ?? ['']
}

function compareSegmentParts(left: string[], right: string[]): number {
  const length = Math.max(left.length, right.length)

  for (let index = 0; index < length; index += 1) {
    const leftPart = left[index]
    const rightPart = right[index]

    if (leftPart === rightPart) continue

    if (leftPart === undefined) {
      return compareMissingPart(rightPart)
    }

    if (rightPart === undefined) {
      return -compareMissingPart(leftPart)
    }

    const comparison = compareParts(leftPart, rightPart)
    if (comparison !== 0) return comparison
  }

  return 0
}

function compareParts(left: string, right: string): number {
  const leftNumeric = /^\d+$/.test(left)
  const rightNumeric = /^\d+$/.test(right)

  if (leftNumeric && rightNumeric) {
    return compareNumericParts(left, right)
  }

  if (leftNumeric !== rightNumeric) {
    return leftNumeric ? 1 : -1
  }

  return left.localeCompare(right)
}

function compareMissingPart(part: string | undefined): number {
  if (part === undefined) return 0
  return /^\d+$/.test(part) ? -1 : 1
}

function compareNumericParts(left: string, right: string): number {
  const normalizedLeft = left.replace(/^0+(?=\d)/, '')
  const normalizedRight = right.replace(/^0+(?=\d)/, '')

  if (normalizedLeft.length !== normalizedRight.length) {
    return normalizedLeft.length - normalizedRight.length
  }

  if (normalizedLeft === normalizedRight) return 0
  return normalizedLeft < normalizedRight ? -1 : 1
}

function isTrailingEmptySegment(
  segments: VersionSegment[],
  index: number
): boolean {
  return (
    index === segments.length - 1 &&
    segments[index]?.parts.length === 1 &&
    segments[index]?.parts[0] === ''
  )
}
