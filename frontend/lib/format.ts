import { formatUnits } from 'ethers'

/**
 * Formats an 18-decimal FGOLD amount for display.
 *
 * Always derived from the on-chain value - the previous client fell back to a
 * hardcoded "1000" whenever a balance read threw, which showed players money
 * they did not have.
 */
export function formatToken(value: bigint | null | undefined, decimals = 2): string {
  if (value == null) return '—'
  const asNumber = Number(formatUnits(value, 18))
  if (!Number.isFinite(asNumber)) return '—'
  if (asNumber === 0) return '0'
  if (asNumber < 0.01) return '<0.01'
  return asNumber.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals,
  })
}

export function formatTokenExact(value: bigint | null | undefined): string {
  if (value == null) return '—'
  return formatUnits(value, 18)
}

export function formatEth(value: bigint | null | undefined, decimals = 4): string {
  if (value == null) return '—'
  const asNumber = Number(formatUnits(value, 18))
  if (!Number.isFinite(asNumber)) return '—'
  return asNumber.toLocaleString(undefined, { maximumFractionDigits: decimals })
}

export function shortAddress(address: string | null | undefined, size = 4): string {
  if (!address) return ''
  if (address.length <= size * 2 + 2) return address
  return `${address.slice(0, size + 2)}…${address.slice(-size)}`
}

/** "4h 12m", "5m 30s", "12s" - compact and stable in width. */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return 'Ready'
  const s = Math.floor(seconds)
  const days = Math.floor(s / 86400)
  const hours = Math.floor((s % 86400) / 3600)
  const minutes = Math.floor((s % 3600) / 60)
  const secs = s % 60

  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${minutes}m`
  if (minutes > 0) return `${minutes}m ${secs}s`
  return `${secs}s`
}

export function formatGrowthTime(seconds: number | bigint): string {
  const s = Number(seconds)
  if (s >= 3600) {
    const hours = s / 3600
    return hours === Math.floor(hours) ? `${hours}h` : `${hours.toFixed(1)}h`
  }
  if (s >= 60) return `${Math.round(s / 60)}m`
  return `${s}s`
}

export function formatBps(bps: number | bigint): string {
  const percent = Number(bps) / 100
  // Two decimals of precision, but no trailing zeros: 250bps -> "2.5%".
  return `${percent.toFixed(2).replace(/\.?0+$/, '')}%`
}

export function formatMultiplier(bps: number | bigint): string {
  return `${(Number(bps) / 100).toFixed(0)}%`
}

/** Percentage of a growth window elapsed, clamped to 0..1. */
export function growthProgress(plantedAt: number, harvestAt: number, now: number): number {
  if (harvestAt <= plantedAt) return 1
  return Math.max(0, Math.min(1, (now - plantedAt) / (harvestAt - plantedAt)))
}
