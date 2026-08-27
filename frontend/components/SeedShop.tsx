'use client'

import { useState } from 'react'
import { useGameState } from '@/providers/GameStateProvider'
import { useGameActions } from '@/hooks/useGameActions'
import { seedMeta } from '@/lib/gameMeta'
import { formatToken, formatGrowthTime } from '@/lib/format'
import { EmptyState, PanelSkeleton } from './FarmPanel'

/**
 * Seed shop, populated from `GameManager.getAllSeedTypes()`.
 *
 * Costs, growth times, yields and level gates are all read from the chain, so
 * the shop cannot advertise a price the contract will not honour.
 */
export function SeedShop() {
  const { catalog, catalogState, profile, balances } = useGameState()
  const { purchaseSeed, approveGameSpend } = useGameActions()
  const [busyId, setBusyId] = useState<number | null>(null)
  const [approving, setApproving] = useState(false)

  if (catalogState === 'loading') return <PanelSkeleton rows={3} />

  if (catalogState === 'error' || !catalog) {
    return (
      <EmptyState
        icon="⚠️"
        title="Shop unavailable"
        body="Could not read the seed catalogue from the chain. Check your network connection."
      />
    )
  }

  const activeSeeds = catalog.seeds.filter((seed) => seed.isActive)
  const level = profile?.level ?? 1

  // A single approval covers every FGOLD spend in the game.
  const cheapestSeed = activeSeeds.reduce<bigint | null>(
    (min, seed) => (min === null || seed.seedCost < min ? seed.seedCost : min),
    null
  )
  const needsApproval =
    balances !== null && cheapestSeed !== null && balances.gameAllowance < cheapestSeed

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between px-3 py-2">
        <h2 className="heading">Seed shop</h2>
        <span className="text-xs text-text-muted">Level {level}</span>
      </div>

      {needsApproval && (
        <div className="mx-3 mb-2 rounded-lg border border-gold-500/40 bg-gold-500/10 p-2.5">
          <p className="text-xs font-medium text-gold-400">One-time approval needed</p>
          <p className="mt-0.5 text-[11px] leading-snug text-text-secondary">
            The game burns FGOLD when you spend it, which needs your permission.
            You approve once, and stay in control of your balance.
          </p>
          <button
            className="btn-gold mt-2 w-full text-xs"
            disabled={approving}
            onClick={async () => {
              setApproving(true)
              await approveGameSpend()
              setApproving(false)
            }}
          >
            {approving ? 'Approving…' : 'Approve FGOLD'}
          </button>
        </div>
      )}

      <div className="scrollbar-thin flex-1 space-y-2 overflow-y-auto px-3 pb-3">
        {activeSeeds.map((seed) => {
          const meta = seedMeta(seed.id)
          const locked = level < seed.requiredLevel
          const affordable = balances ? balances.fgold >= seed.seedCost : false
          const profit = seed.baseYield - seed.seedCost

          return (
            <div
              key={seed.id}
              className={`panel-flush p-2.5 transition ${locked ? 'opacity-55' : ''}`}
              style={locked ? undefined : { borderColor: `${meta.accent}44` }}
            >
              <div className="flex items-start gap-2.5">
                <div className="slot h-10 w-10 shrink-0 text-lg" aria-hidden>
                  {meta.cropEmoji}
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="truncate text-sm font-medium">{meta.name}</p>
                    <span className="shrink-0 text-xs text-gold-400 tabular">
                      {formatToken(seed.seedCost)}
                    </span>
                  </div>

                  <p className="mt-0.5 text-[11px] leading-snug text-text-muted">
                    {meta.description}
                  </p>

                  <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-text-secondary">
                    <span className="tabular">⏱ {formatGrowthTime(seed.growthTime)}</span>
                    <span className="tabular">🪙 {formatToken(seed.baseYield)}</span>
                    <span className="tabular text-leaf-400">+{formatToken(profit)} min</span>
                    <span className="tabular">✦ {seed.xpReward.toString()} XP</span>
                  </div>
                </div>
              </div>

              <button
                className="btn-primary mt-2 w-full text-xs"
                disabled={locked || busyId !== null || needsApproval || !affordable}
                title={
                  locked ? `Unlocks at level ${seed.requiredLevel}`
                  : !affordable ? `Needs ${formatToken(seed.seedCost)} FGOLD`
                  : undefined
                }
                onClick={async () => {
                  setBusyId(seed.id)
                  await purchaseSeed(seed.id)
                  setBusyId(null)
                }}
              >
                {busyId === seed.id ? 'Buying…'
                  : locked ? `🔒 Level ${seed.requiredLevel}`
                  : !affordable ? 'Not enough FGOLD'
                  : 'Buy seed'}
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default SeedShop
