'use client'

import { useMemo } from 'react'
import { useGameState } from '@/providers/GameStateProvider'
import { formatToken } from '@/lib/format'
import { seedMeta } from '@/lib/gameMeta'

/**
 * Progression summary: level, XP, and what the next level unlocks.
 *
 * The "next unlock" line is derived from the on-chain seed and recipe level
 * gates rather than a hardcoded list, so new content becomes a goal the moment
 * an operator publishes it.
 */
export function PlayerProfileCard() {
  const { profile, catalog, lands, balances } = useGameState()

  const nextUnlock = useMemo(() => {
    if (!profile || !catalog) return null
    const level = profile.level

    const seed = catalog.seeds
      .filter((s) => s.isActive && s.requiredLevel > level)
      .sort((a, b) => a.requiredLevel - b.requiredLevel)[0]

    const recipe = catalog.recipes
      .filter((r) => r.isActive && r.requiredLevel > level)
      .sort((a, b) => a.requiredLevel - b.requiredLevel)[0]

    if (seed && (!recipe || seed.requiredLevel <= recipe.requiredLevel)) {
      return { level: seed.requiredLevel, label: `${seedMeta(seed.id).name} seeds` }
    }
    if (recipe) {
      return { level: recipe.requiredLevel, label: 'a new recipe' }
    }
    return null
  }, [profile, catalog])

  if (!profile) return null

  const xpIntoLevel = profile.xp - profile.xpForCurrentLevel
  const xpSpan = profile.xpForNextLevel - profile.xpForCurrentLevel
  const percent = xpSpan > 0n ? Math.min(100, Number((xpIntoLevel * 100n) / xpSpan)) : 0
  const xpRemaining = profile.xpForNextLevel > profile.xp ? profile.xpForNextLevel - profile.xp : 0n

  return (
    <div className="shrink-0 border-b p-3" style={{ borderColor: 'var(--soil-700)' }}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-leaf-500/15 text-sm font-semibold text-leaf-300 tabular">
            {profile.level}
          </span>
          <div>
            <p className="text-sm font-medium">Level {profile.level}</p>
            <p className="text-[11px] text-text-muted tabular">
              {profile.xp.toString()} XP total
            </p>
          </div>
        </div>
        <div className="text-right">
          <p className="text-sm text-gold-400 tabular">{formatToken(balances?.fgold)}</p>
          <p className="text-[11px] text-text-muted">FGOLD</p>
        </div>
      </div>

      <div className="mt-2">
        <div className="h-1.5 overflow-hidden rounded-full bg-soil-800">
          <div
            className="growth-bar h-full rounded-full transition-[width] duration-500"
            style={{ width: `${percent}%` }}
          />
        </div>
        <div className="mt-1 flex items-baseline justify-between text-[11px] text-text-muted">
          <span className="tabular">{xpRemaining.toString()} XP to level {profile.level + 1}</span>
          {nextUnlock && (
            <span className="text-leaf-400">
              Lv {nextUnlock.level}: {nextUnlock.label}
            </span>
          )}
        </div>
      </div>

      <dl className="mt-2.5 grid grid-cols-4 gap-1 text-center">
        <Stat label="Plots" value={lands.length} />
        <Stat label="Harvests" value={profile.totalHarvests} />
        <Stat label="Crafted" value={profile.totalCrafted} />
        <Stat label="Upgrades" value={profile.totalUpgrades} />
      </dl>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md bg-soil-850 py-1.5">
      <dd className="text-sm font-medium tabular">{value}</dd>
      <dt className="text-[10px] text-text-muted">{label}</dt>
    </div>
  )
}

export default PlayerProfileCard
