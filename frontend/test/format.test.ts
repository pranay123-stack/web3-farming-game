import { describe, expect, it } from 'vitest'
import {
  formatToken, formatTokenExact, formatEth, shortAddress, formatDuration,
  formatGrowthTime, formatBps, formatMultiplier, growthProgress,
} from '@/lib/format'

describe('formatToken', () => {
  /**
   * A missing value renders as a dash. It must never fall back to a number -
   * the previous client substituted a hardcoded "1000" balance whenever a read
   * failed, showing players money they did not have.
   */
  it('renders an unknown value as a dash, never as a number', () => {
    expect(formatToken(null)).toBe('—')
    expect(formatToken(undefined)).toBe('—')
  })

  it('formats whole and fractional amounts', () => {
    expect(formatToken(0n)).toBe('0')
    expect(formatToken(10n ** 18n)).toBe('1')
    expect(formatToken(1500n * 10n ** 15n)).toBe('1.5')
  })

  it('collapses dust rather than rendering a misleading zero', () => {
    expect(formatToken(1n)).toBe('<0.01')
    expect(formatToken(10n ** 15n)).toBe('<0.01')
  })

  it('groups large numbers', () => {
    expect(formatToken(1_234_567n * 10n ** 18n)).toMatch(/1[,.\s]?234[,.\s]?567/)
  })

  it('keeps full precision when asked', () => {
    expect(formatTokenExact(1234567890123456789n)).toBe('1.234567890123456789')
  })
})

describe('formatEth', () => {
  it('formats with the requested precision', () => {
    expect(formatEth(10n ** 18n)).toBe('1')
    expect(formatEth(5n * 10n ** 15n, 4)).toBe('0.005')
  })

  it('renders unknown as a dash', () => {
    expect(formatEth(null)).toBe('—')
  })
})

describe('shortAddress', () => {
  it('truncates the middle', () => {
    expect(shortAddress('0x1234567890abcdef1234567890abcdef12345678'))
      .toBe('0x1234…5678')
  })

  it('leaves short strings alone and handles empties', () => {
    expect(shortAddress('0xabc')).toBe('0xabc')
    expect(shortAddress(null)).toBe('')
    expect(shortAddress(undefined)).toBe('')
  })
})

describe('formatDuration', () => {
  it('says Ready at or past zero', () => {
    expect(formatDuration(0)).toBe('Ready')
    expect(formatDuration(-10)).toBe('Ready')
  })

  it('picks a sensible unit pair', () => {
    expect(formatDuration(45)).toBe('45s')
    expect(formatDuration(90)).toBe('1m 30s')
    expect(formatDuration(3700)).toBe('1h 1m')
    expect(formatDuration(90000)).toBe('1d 1h')
  })

  it('handles non-finite input without crashing the countdown', () => {
    expect(formatDuration(NaN)).toBe('Ready')
    expect(formatDuration(Infinity)).toBe('Ready')
  })
})

describe('formatGrowthTime', () => {
  it('matches the tiers used by the shipped seeds', () => {
    expect(formatGrowthTime(300)).toBe('5m')      // wheat
    expect(formatGrowthTime(900)).toBe('15m')     // corn
    expect(formatGrowthTime(3600)).toBe('1h')     // tomato
    expect(formatGrowthTime(14400)).toBe('4h')    // golden apple
  })

  it('shows a fraction for an awkward hour count', () => {
    expect(formatGrowthTime(5400)).toBe('1.5h')
  })

  it('accepts bigint growth times straight from the contract', () => {
    expect(formatGrowthTime(3600n)).toBe('1h')
  })
})

describe('basis points', () => {
  it('renders the documented yield band', () => {
    expect(formatMultiplier(10000)).toBe('100%')
    expect(formatMultiplier(14000)).toBe('140%')
    expect(formatMultiplier(15000)).toBe('150%')
  })

  it('renders a fee percentage', () => {
    expect(formatBps(250)).toBe('2.5%')
    expect(formatBps(1000)).toBe('10%')
  })
})

describe('growthProgress', () => {
  it('runs from 0 to 1 across the window', () => {
    expect(growthProgress(0, 100, 0)).toBe(0)
    expect(growthProgress(0, 100, 50)).toBe(0.5)
    expect(growthProgress(0, 100, 100)).toBe(1)
  })

  it('clamps outside the window', () => {
    expect(growthProgress(0, 100, -10)).toBe(0)
    expect(growthProgress(0, 100, 500)).toBe(1)
  })

  it('treats a degenerate window as complete', () => {
    expect(growthProgress(100, 100, 100)).toBe(1)
    expect(growthProgress(100, 50, 100)).toBe(1)
  })
})
