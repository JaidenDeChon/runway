/**
 * Integer minor-units money helpers.
 *
 * Money is stored and summed as integer minor units (e.g. cents) so that
 * repeated addition never accumulates floating-point error. Major-unit
 * numbers (e.g. dollars) are only for display/input at the edges.
 */

export type MinorUnits = number

/** Converts a major-unit amount (e.g. 19.99) to integer minor units (e.g. 1999). */
export function toMinorUnits(major: number): MinorUnits {
  return Math.round(major * 100)
}

/** Converts integer minor units (e.g. 1999) back to a major-unit amount (e.g. 19.99). */
export function toMajorUnits(minor: MinorUnits): number {
  return minor / 100
}

/** Sums a list of minor-units amounts, staying in integer arithmetic throughout. */
export function sumMinorUnits(values: readonly MinorUnits[]): MinorUnits {
  return values.reduce((total, value) => total + value, 0)
}
