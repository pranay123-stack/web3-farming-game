'use client'

import { useMemo, useState } from 'react'
import { useGameState } from '@/providers/GameStateProvider'
import { useGameActions } from '@/hooks/useGameActions'
import {
  ITEM_TYPE_LABEL, ItemType, RARITY_COLOR, RARITY_LABEL, itemEmoji, recipeMeta,
  type Rarity,
} from '@/lib/gameMeta'
import { formatToken } from '@/lib/format'
import { EmptyState, PanelSkeleton } from './FarmPanel'
import type { RecipeInfo } from '@/lib/state/gameTypes'

/**
 * Crafting, driven by the on-chain recipe registry.
 *
 * Recipes above the first tier consume harvested crop NFTs. Materials are
 * chosen explicitly and burned by the contract, which is what stops the same
 * crop backing two crafts.
 */
export function CraftingPanel() {
  const { catalog, catalogState, profile, balances, inventory } = useGameState()
  const [expandedId, setExpandedId] = useState<number | null>(null)

  if (catalogState === 'loading') return <PanelSkeleton rows={3} />

  if (!catalog || catalog.recipes.length === 0) {
    return <EmptyState icon="🔨" title="No recipes" body="No crafting recipes are published yet." />
  }

  const level = profile?.level ?? 1

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between px-3 py-2">
        <h2 className="heading">Workshop</h2>
        <span className="text-xs text-text-muted">Level {level}</span>
      </div>

      <div className="scrollbar-thin flex-1 space-y-2 overflow-y-auto px-3 pb-3">
        {catalog.recipes.filter((r) => r.isActive).map((recipe) => (
          <RecipeCard
            key={recipe.id}
            recipe={recipe}
            level={level}
            balance={balances?.fgold ?? 0n}
            inventory={inventory}
            expanded={expandedId === recipe.id}
            onToggle={() => setExpandedId(expandedId === recipe.id ? null : recipe.id)}
          />
        ))}
      </div>
    </div>
  )
}

function RecipeCard({
  recipe, level, balance, inventory, expanded, onToggle,
}: {
  recipe: RecipeInfo
  level: number
  balance: bigint
  inventory: ReturnType<typeof useGameState>['inventory']
  expanded: boolean
  onToggle: () => void
}) {
  const { craftItem } = useGameActions()
  const [selected, setSelected] = useState<bigint[]>([])
  const [busy, setBusy] = useState(false)

  const meta = recipeMeta(recipe.id)
  const locked = level < recipe.requiredLevel
  const affordable = balance >= recipe.tokenCost

  const eligibleMaterials = useMemo(
    () => inventory.filter((item) => item.itemType === recipe.materialType),
    [inventory, recipe.materialType]
  )

  const hasEnoughMaterials = eligibleMaterials.length >= recipe.materialCount
  const materialsChosen = selected.length === recipe.materialCount
  const canCraft = !locked && affordable && hasEnoughMaterials && materialsChosen

  const toggleMaterial = (tokenId: bigint) => {
    setSelected((current) => {
      if (current.includes(tokenId)) return current.filter((id) => id !== tokenId)
      if (current.length >= recipe.materialCount) return current
      return [...current, tokenId]
    })
  }

  return (
    <div className={`panel-flush overflow-hidden ${locked ? 'opacity-55' : ''}`}>
      <button
        onClick={onToggle}
        className="flex w-full items-start gap-2.5 p-2.5 text-left hover:bg-soil-800/60"
        aria-expanded={expanded}
      >
        <div
          className="slot h-10 w-10 shrink-0 text-lg"
          style={{ borderColor: RARITY_COLOR[recipe.resultRarity as Rarity] }}
          aria-hidden
        >
          {meta.emoji}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <p className="truncate text-sm font-medium">{meta.name}</p>
            <span className="shrink-0 text-xs text-gold-400 tabular">
              {formatToken(recipe.tokenCost)}
            </span>
          </div>
          <p className="mt-0.5 text-[11px] leading-snug text-text-muted">{meta.description}</p>
          <div className="mt-1 flex flex-wrap gap-x-3 text-[11px] text-text-secondary">
            <span style={{ color: RARITY_COLOR[recipe.resultRarity as Rarity] }}>
              {RARITY_LABEL[recipe.resultRarity as Rarity]}
            </span>
            <span>{ITEM_TYPE_LABEL[recipe.resultType as ItemType]}</span>
            {recipe.materialCount > 0 && (
              <span className={hasEnoughMaterials ? '' : 'text-rose-500'}>
                {recipe.materialCount} × {ITEM_TYPE_LABEL[recipe.materialType as ItemType]}
              </span>
            )}
          </div>
        </div>
      </button>

      {expanded && (
        <div className="space-y-2 border-t px-2.5 py-2" style={{ borderColor: 'var(--soil-700)' }}>
          {locked && (
            <p className="rounded-md bg-soil-800 px-2 py-1.5 text-xs text-text-muted">
              🔒 Unlocks at level {recipe.requiredLevel}.
            </p>
          )}

          {recipe.materialCount > 0 && (
            <div>
              <p className="heading mb-1.5">
                Materials · {selected.length}/{recipe.materialCount}
              </p>
              {eligibleMaterials.length === 0 ? (
                <p className="text-xs text-text-muted">
                  You have no {ITEM_TYPE_LABEL[recipe.materialType as ItemType].toLowerCase()}s.
                  Harvest crops to gather them.
                </p>
              ) : (
                <div className="grid grid-cols-6 gap-1.5">
                  {eligibleMaterials.slice(0, 24).map((item) => {
                    const isSelected = selected.includes(item.tokenId)
                    return (
                      <button
                        key={item.tokenId.toString()}
                        onClick={() => toggleMaterial(item.tokenId)}
                        className={`slot-interactive text-sm ${isSelected ? 'slot-selected' : ''}`}
                        title={`#${item.tokenId.toString()}`}
                        aria-pressed={isSelected}
                      >
                        <span aria-hidden>{itemEmoji(item.itemType, item.seedTypeId)}</span>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="text-text-muted">
              Grants {recipe.xpReward.toString()} XP
            </span>
            {!affordable && (
              <span className="text-rose-500">
                Needs {formatToken(recipe.tokenCost)} FGOLD
              </span>
            )}
          </div>

          <button
            className="btn-primary w-full text-xs"
            disabled={!canCraft || busy}
            onClick={async () => {
              setBusy(true)
              const result = await craftItem(recipe.id, selected)
              setBusy(false)
              if (result.ok) setSelected([])
            }}
          >
            {busy ? 'Crafting…'
              : locked ? `🔒 Level ${recipe.requiredLevel}`
              : !hasEnoughMaterials ? 'Not enough materials'
              : !materialsChosen ? `Select ${recipe.materialCount} material${recipe.materialCount === 1 ? '' : 's'}`
              : !affordable ? 'Not enough FGOLD'
              : `Craft ${meta.name}`}
          </button>
        </div>
      )}
    </div>
  )
}

export default CraftingPanel
