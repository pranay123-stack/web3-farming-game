'use client'

import { useMemo, useState } from 'react'
import { useGameState } from '@/providers/GameStateProvider'
import { useGameActions } from '@/hooks/useGameActions'
import {
  ItemType, RARITY_COLOR, RARITY_LABEL, itemEmoji, itemName, seedMeta, type Rarity,
} from '@/lib/gameMeta'
import { formatToken, formatGrowthTime } from '@/lib/format'
import type { InventoryItem } from '@/lib/state/gameTypes'
import { EmptyState, PanelSkeleton } from './FarmPanel'

type Tab = 'seeds' | 'crops' | 'tools'

/**
 * Player inventory, read entirely from FarmNFT.
 *
 * Every item shown is a token the wallet actually holds. The previous version
 * rendered a fixed array of invented items - wheat, corn, a "Golden Hoe" -
 * that existed nowhere on chain.
 */
export function Inventory({ selectedPlotId }: { selectedPlotId: bigint | null }) {
  const { inventory, playerState, lands } = useGameState()
  const [tab, setTab] = useState<Tab>('seeds')

  const grouped = useMemo(() => ({
    seeds: inventory.filter((i) => i.itemType === ItemType.SEED),
    crops: inventory.filter((i) => i.itemType === ItemType.CROP),
    tools: inventory.filter(
      (i) => i.itemType === ItemType.TOOL || i.itemType === ItemType.CONSUMABLE
    ),
  }), [inventory])

  if (playerState === 'loading' && inventory.length === 0) {
    return <PanelSkeleton rows={2} />
  }

  const tabs: { id: Tab; label: string; count: number }[] = [
    { id: 'seeds', label: 'Seeds', count: grouped.seeds.length },
    { id: 'crops', label: 'Crops', count: grouped.crops.length },
    { id: 'tools', label: 'Tools', count: grouped.tools.length },
  ]

  const items = grouped[tab]
  const plot = selectedPlotId ? lands.find((l) => l.tokenId === selectedPlotId) : null
  const canPlant = Boolean(plot && !plot.isLocked)

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between px-3 py-2">
        <h2 className="heading">Inventory</h2>
        <span className="text-xs text-text-muted tabular">{inventory.length} items</span>
      </div>

      <div className="flex gap-1 px-3 pb-2">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex-1 rounded-md px-2 py-1.5 text-xs font-medium transition ${
              tab === t.id
                ? 'bg-leaf-500 text-soil-950'
                : 'bg-soil-800 text-text-secondary hover:text-text-primary'
            }`}
          >
            {t.label}
            {t.count > 0 && <span className="ml-1 opacity-70 tabular">{t.count}</span>}
          </button>
        ))}
      </div>

      {tab === 'seeds' && selectedPlotId && canPlant && (
        <p className="mx-3 mb-2 rounded-md bg-leaf-500/10 px-2 py-1.5 text-xs text-leaf-300">
          Choose a seed to plant on plot #{selectedPlotId.toString()}.
        </p>
      )}

      <div className="scrollbar-thin flex-1 overflow-y-auto px-3 pb-3">
        {items.length === 0 ? (
          <EmptyState
            icon={tab === 'seeds' ? '🌱' : tab === 'crops' ? '🌾' : '🔨'}
            title={`No ${tab} yet`}
            body={
              tab === 'seeds' ? 'Buy seeds from the shop to start farming.'
              : tab === 'crops' ? 'Harvest a crop and it will appear here as an NFT.'
              : 'Craft a tool to see it here.'
            }
          />
        ) : (
          <div className="grid grid-cols-4 gap-2">
            {items.map((item) => (
              <ItemSlot
                key={item.tokenId.toString()}
                item={item}
                plantablePlotId={tab === 'seeds' && canPlant ? selectedPlotId : null}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function ItemSlot({
  item, plantablePlotId,
}: {
  item: InventoryItem
  plantablePlotId: bigint | null
}) {
  const { plantCrop } = useGameActions()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  const rarityColor = RARITY_COLOR[item.rarity as Rarity] ?? RARITY_COLOR[0]
  const name = itemName(item.itemType, item.seedTypeId)

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="slot-interactive w-full text-xl"
        style={{ borderColor: rarityColor }}
        title={name}
        aria-label={name}
        aria-expanded={open}
      >
        <span aria-hidden>{itemEmoji(item.itemType, item.seedTypeId)}</span>
        <span className="absolute bottom-0.5 right-1 text-[9px] text-text-muted tabular">
          #{item.tokenId.toString()}
        </span>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} aria-hidden />
          <div className="panel absolute left-1/2 z-50 mt-1 w-52 -translate-x-1/2 p-2.5 shadow-xl">
            <p className="text-sm font-medium">{name}</p>
            <p className="text-xs" style={{ color: rarityColor }}>
              {RARITY_LABEL[item.rarity as Rarity] ?? 'Common'}
            </p>

            <dl className="mt-2 space-y-0.5 text-xs">
              <Row label="Token" value={`#${item.tokenId.toString()}`} />
              {item.itemType === ItemType.SEED && (
                <>
                  <Row label="Grows in" value={formatGrowthTime(item.growthTime)} />
                  <Row label="Base yield" value={`${formatToken(item.yieldAmount)} FGOLD`} />
                </>
              )}
              {item.itemType === ItemType.CROP && (
                <Row label="Harvest value" value={`${formatToken(item.yieldAmount)} FGOLD`} />
              )}
              {item.itemType === ItemType.TOOL && (
                <>
                  <Row label="Power" value={String(item.power)} />
                  <Row label="Durability" value={String(item.durability)} />
                </>
              )}
            </dl>

            {plantablePlotId !== null && item.itemType === ItemType.SEED && (
              <button
                className="btn-primary mt-2 w-full text-xs"
                disabled={busy}
                onClick={async () => {
                  setBusy(true)
                  const result = await plantCrop(plantablePlotId, item.tokenId)
                  setBusy(false)
                  if (result.ok) setOpen(false)
                }}
              >
                {busy ? 'Planting…' : `Plant on #${plantablePlotId.toString()}`}
              </button>
            )}

            {item.itemType === ItemType.SEED && plantablePlotId === null && (
              <p className="mt-2 text-[11px] leading-snug text-text-muted">
                Select an empty plot to plant this seed.
              </p>
            )}
          </div>
        </>
      )}
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2">
      <dt className="text-text-muted">{label}</dt>
      <dd className="text-text-secondary tabular">{value}</dd>
    </div>
  )
}

export default Inventory
