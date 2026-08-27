'use client'

import { useMemo, useState } from 'react'
import { useGameState } from '@/providers/GameStateProvider'
import { useGameActions } from '@/hooks/useGameActions'
import { seedMeta, ItemType } from '@/lib/gameMeta'
import { formatDuration, formatToken, formatMultiplier, growthProgress } from '@/lib/format'
import type { LandPlotInfo } from '@/lib/state/gameTypes'

/**
 * Plot management: what is growing, what is ready, and what to do next.
 *
 * Growth countdowns are driven by the provider's chain-anchored clock rather
 * than `Date.now()`, so a plot never shows as ready before the chain agrees.
 */
export function FarmPanel({
  selectedPlotId,
  onSelectPlot,
}: {
  selectedPlotId: bigint | null
  onSelectPlot: (tokenId: bigint | null) => void
}) {
  const { lands, playerState, chainNow, catalog } = useGameState()

  if (playerState === 'loading' && lands.length === 0) {
    return <PanelSkeleton rows={2} />
  }

  if (lands.length === 0) {
    return (
      <EmptyState
        icon="🏞️"
        title="No plots yet"
        body="Claim your starter pack to receive your first plot of land, or buy one from the shop."
      />
    )
  }

  const ready = lands.filter((l) => l.farm && chainNow >= l.farm.harvestAt)
  const growing = lands.filter((l) => l.farm && chainNow < l.farm.harvestAt)
  const idle = lands.filter((l) => !l.farm)

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between px-3 py-2">
        <h2 className="heading">Your land</h2>
        <span className="text-xs text-text-muted tabular">
          {lands.length} plot{lands.length === 1 ? '' : 's'}
        </span>
      </div>

      {ready.length > 0 && <HarvestAllBar plots={ready} />}

      <div className="scrollbar-thin flex-1 space-y-2 overflow-y-auto px-3 pb-3">
        {[...ready, ...growing, ...idle].map((plot) => (
          <PlotCard
            key={plot.tokenId.toString()}
            plot={plot}
            now={chainNow}
            maxLevel={catalog?.maxLandLevel ?? 10}
            selected={selectedPlotId === plot.tokenId}
            onSelect={() => onSelectPlot(selectedPlotId === plot.tokenId ? null : plot.tokenId)}
          />
        ))}
      </div>
    </div>
  )
}

function HarvestAllBar({ plots }: { plots: LandPlotInfo[] }) {
  const { harvestCrop } = useGameActions()
  const [busy, setBusy] = useState(false)

  const total = plots.reduce((sum, plot) => sum + (plot.farm?.expectedYield ?? 0n), 0n)

  return (
    <div className="mx-3 mb-2 rounded-lg border border-leaf-500/40 bg-leaf-500/10 p-2.5">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium text-leaf-300">
            {plots.length} crop{plots.length === 1 ? '' : 's'} ready
          </p>
          <p className="text-xs text-text-secondary tabular">
            about {formatToken(total)} FGOLD waiting
          </p>
        </div>
        <button
          className="btn-primary shrink-0 text-xs"
          disabled={busy}
          onClick={async () => {
            setBusy(true)
            // Sequential on purpose: each harvest is its own signature, and
            // firing them together produces nonce races in most wallets.
            for (const plot of plots) {
              const result = await harvestCrop(plot.tokenId)
              if (!result.ok && result.error?.kind === 'rejected') break
            }
            setBusy(false)
          }}
        >
          {busy ? 'Harvesting…' : 'Harvest all'}
        </button>
      </div>
    </div>
  )
}

function PlotCard({
  plot, now, maxLevel, selected, onSelect,
}: {
  plot: LandPlotInfo
  now: number
  maxLevel: number
  selected: boolean
  onSelect: () => void
}) {
  const { harvestCrop, upgradeLand } = useGameActions()
  const { inventory, balances } = useGameState()
  const [busy, setBusy] = useState<'harvest' | 'upgrade' | null>(null)

  const farm = plot.farm
  const isReady = Boolean(farm && now >= farm.harvestAt)
  const meta = farm ? seedMeta(farm.seedTypeId) : null
  const progress = farm ? growthProgress(farm.plantedAt, farm.harvestAt, now) : 0

  const seedsAvailable = useMemo(
    () => inventory.filter((item) => item.itemType === ItemType.SEED).length,
    [inventory]
  )

  const atMaxLevel = plot.level >= maxLevel
  const canAffordUpgrade = balances ? balances.fgold >= plot.upgradeCost : false

  return (
    <div
      className={`panel-flush overflow-hidden transition-all ${
        selected ? 'ring-2 ring-leaf-500/40' : ''
      } ${isReady ? 'border-leaf-500/50' : ''}`}
    >
      <button
        onClick={onSelect}
        className="flex w-full items-center gap-3 p-2.5 text-left hover:bg-soil-800/60"
        aria-expanded={selected}
      >
        <div
          className={`slot h-11 w-11 shrink-0 text-xl ${isReady ? 'border-leaf-400' : ''}`}
          aria-hidden
        >
          {farm ? (isReady ? meta!.cropEmoji : meta!.emoji) : '🟫'}
          {isReady && (
            <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-leaf-400" />
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <p className="truncate text-sm font-medium">
              Plot #{plot.tokenId.toString()}
              <span className="ml-1.5 text-xs text-text-muted">
                ({plot.x}, {plot.y})
              </span>
            </p>
            <span className="shrink-0 text-xs text-text-muted tabular">
              {formatMultiplier(plot.yieldBps)}
            </span>
          </div>

          {farm ? (
            <>
              <p className="mt-0.5 text-xs text-text-secondary">
                {meta!.name} ·{' '}
                <span className={isReady ? 'text-leaf-400' : ''}>
                  {isReady ? 'Ready to harvest' : formatDuration(farm.harvestAt - now)}
                </span>
              </p>
              <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-soil-800">
                <div
                  className="growth-bar h-full rounded-full transition-[width] duration-1000 ease-linear"
                  style={{ width: `${progress * 100}%` }}
                />
              </div>
            </>
          ) : (
            <p className="mt-0.5 text-xs text-text-muted">
              Empty · Level {plot.level} · Fertility {plot.fertility}
            </p>
          )}
        </div>
      </button>

      {selected && (
        <div className="space-y-2 border-t px-2.5 py-2" style={{ borderColor: 'var(--soil-700)' }}>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
            <Stat label="Level" value={`${plot.level} / ${maxLevel}`} />
            <Stat label="Fertility" value={String(plot.fertility)} />
            <Stat label="Yield" value={formatMultiplier(plot.yieldBps)} />
            {farm && <Stat label="Expected" value={`${formatToken(farm.expectedYield)} FGOLD`} />}
          </dl>

          <div className="flex flex-wrap gap-2">
            {isReady && (
              <button
                className="btn-primary flex-1 text-xs"
                disabled={busy !== null}
                onClick={async () => {
                  setBusy('harvest')
                  await harvestCrop(plot.tokenId)
                  setBusy(null)
                }}
              >
                {busy === 'harvest' ? 'Harvesting…' : 'Harvest'}
              </button>
            )}

            {!farm && (
              <p className="flex-1 text-xs text-text-muted">
                {seedsAvailable > 0
                  ? 'Pick a seed from your inventory to plant here.'
                  : 'Buy a seed from the shop to plant here.'}
              </p>
            )}

            {!farm && !atMaxLevel && (
              <button
                className="btn-secondary shrink-0 text-xs"
                disabled={busy !== null || !canAffordUpgrade}
                title={
                  canAffordUpgrade
                    ? `Costs ${formatToken(plot.upgradeCost)} FGOLD`
                    : `Needs ${formatToken(plot.upgradeCost)} FGOLD`
                }
                onClick={async () => {
                  setBusy('upgrade')
                  await upgradeLand(plot.tokenId)
                  setBusy(null)
                }}
              >
                {busy === 'upgrade'
                  ? 'Upgrading…'
                  : `Upgrade · ${formatToken(plot.upgradeCost)}`}
              </button>
            )}

            {atMaxLevel && (
              <span className="chip border-gold-500/40 bg-gold-500/10 text-gold-400">
                Fully upgraded
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2">
      <dt className="text-text-muted">{label}</dt>
      <dd className="text-text-secondary tabular">{value}</dd>
    </div>
  )
}

export function EmptyState({ icon, title, body, action }: {
  icon: string
  title: string
  body: string
  action?: React.ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-10 text-center">
      <span className="text-3xl opacity-70" aria-hidden>{icon}</span>
      <p className="text-sm font-medium text-text-secondary">{title}</p>
      <p className="max-w-[26ch] text-xs leading-relaxed text-text-muted">{body}</p>
      {action}
    </div>
  )
}

export function PanelSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-2 p-3" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="h-16 animate-pulse rounded-lg bg-soil-800/60" />
      ))}
    </div>
  )
}

export default FarmPanel
