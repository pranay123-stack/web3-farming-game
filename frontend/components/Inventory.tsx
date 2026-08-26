'use client'

import { useState } from 'react'
import { useGameContract } from '@/hooks/useGameContract'
import { SEED_INFO, RECIPE_INFO, SEED_TYPES, RECIPES } from '@/lib/contracts'

interface InventoryProps {
  onCraft?: (recipeId: number) => void
}

type TabType = 'items' | 'seeds' | 'crops' | 'crafting'

export default function Inventory({ onCraft }: InventoryProps) {
  const { ownedNFTs, playerStats, tokenBalance, isLoading } = useGameContract()
  const [activeTab, setActiveTab] = useState<TabType>('items')
  const [selectedItem, setSelectedItem] = useState<number | null>(null)

  // Mock inventory data for demo
  const seeds = [
    { id: SEED_TYPES.WHEAT, amount: 10, ...SEED_INFO[SEED_TYPES.WHEAT] },
    { id: SEED_TYPES.CORN, amount: 5, ...SEED_INFO[SEED_TYPES.CORN] },
    { id: SEED_TYPES.TOMATO, amount: 3, ...SEED_INFO[SEED_TYPES.TOMATO] },
    { id: SEED_TYPES.CARROT, amount: 8, ...SEED_INFO[SEED_TYPES.CARROT] },
    { id: SEED_TYPES.PUMPKIN, amount: 2, ...SEED_INFO[SEED_TYPES.PUMPKIN] },
  ]

  const items = [
    { id: 1, name: 'Watering Can', emoji: '🪣', amount: 1, rarity: 'common' },
    { id: 2, name: 'Fertilizer', emoji: '🧪', amount: 5, rarity: 'common' },
    { id: 3, name: 'Golden Hoe', emoji: '⛏️', amount: 1, rarity: 'rare' },
    { id: 4, name: 'Magic Seeds', emoji: '✨', amount: 2, rarity: 'epic' },
  ]

  const crops = [
    { id: 1, name: 'Wheat', emoji: '🌾', amount: 25, quality: 'A' },
    { id: 2, name: 'Corn', emoji: '🌽', amount: 12, quality: 'S' },
    { id: 3, name: 'Tomato', emoji: '🍅', amount: 8, quality: 'B' },
  ]

  const recipes = [
    { id: RECIPES.BASIC_FERTILIZER, ...RECIPE_INFO[RECIPES.BASIC_FERTILIZER], cost: '5 Wheat' },
    { id: RECIPES.WATER_CAN, ...RECIPE_INFO[RECIPES.WATER_CAN], cost: '10 Wood' },
    { id: RECIPES.SCARECROW, ...RECIPE_INFO[RECIPES.SCARECROW], cost: '15 Straw' },
    { id: RECIPES.SEED_BAG, ...RECIPE_INFO[RECIPES.SEED_BAG], cost: '5 Leather' },
  ]

  const getRarityColor = (rarity: string) => {
    switch (rarity) {
      case 'common': return 'border-gray-500'
      case 'uncommon': return 'border-green-500'
      case 'rare': return 'border-blue-500'
      case 'epic': return 'border-purple-500'
      case 'legendary': return 'border-yellow-500'
      default: return 'border-gray-500'
    }
  }

  const tabs: { id: TabType; label: string; icon: string }[] = [
    { id: 'items', label: 'Items', icon: '🎒' },
    { id: 'seeds', label: 'Seeds', icon: '🌱' },
    { id: 'crops', label: 'Crops', icon: '🌾' },
    { id: 'crafting', label: 'Craft', icon: '🔨' },
  ]

  return (
    <div className="h-full flex flex-col bg-game-dark/50">
      {/* Header */}
      <div className="p-3 border-b border-game-border">
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-pixel text-game-primary text-xs">Inventory</h3>
          {playerStats && (
            <div className="text-xs text-slate-400">
              Lv.{playerStats.level}
            </div>
          )}
        </div>

        {/* Tabs */}
        <div className="flex gap-1">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`
                flex-1 py-1 px-2 text-xs rounded transition-all
                ${activeTab === tab.id
                  ? 'bg-game-primary text-game-darker'
                  : 'bg-game-darker text-slate-400 hover:text-white'
                }
              `}
            >
              <span className="mr-1">{tab.icon}</span>
              <span className="hidden sm:inline">{tab.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-3">
        {activeTab === 'items' && (
          <div className="grid grid-cols-4 gap-2">
            {items.map((item) => (
              <button
                key={item.id}
                onClick={() => setSelectedItem(selectedItem === item.id ? null : item.id)}
                className={`
                  inventory-slot relative
                  ${getRarityColor(item.rarity)}
                  ${selectedItem === item.id ? 'selected' : ''}
                `}
                title={item.name}
              >
                <span className="text-xl">{item.emoji}</span>
                {item.amount > 1 && (
                  <span className="absolute bottom-0 right-0 text-[10px] font-bold text-white bg-game-darker px-1 rounded">
                    {item.amount}
                  </span>
                )}
              </button>
            ))}
            {/* Empty slots */}
            {Array.from({ length: Math.max(0, 12 - items.length) }).map((_, i) => (
              <div key={`empty-${i}`} className="inventory-slot opacity-50" />
            ))}
          </div>
        )}

        {activeTab === 'seeds' && (
          <div className="grid grid-cols-4 gap-2">
            {seeds.map((seed) => (
              <button
                key={seed.id}
                onClick={() => setSelectedItem(selectedItem === seed.id ? null : seed.id)}
                className={`
                  inventory-slot relative
                  ${getRarityColor(seed.rarity)}
                  ${selectedItem === seed.id ? 'selected' : ''}
                `}
                title={`${seed.name} (${seed.growthTime}s)`}
              >
                <span className="text-xl">{seed.emoji}</span>
                {seed.amount > 0 && (
                  <span className="absolute bottom-0 right-0 text-[10px] font-bold text-white bg-game-darker px-1 rounded">
                    {seed.amount}
                  </span>
                )}
              </button>
            ))}
            {/* Empty slots */}
            {Array.from({ length: Math.max(0, 12 - seeds.length) }).map((_, i) => (
              <div key={`empty-${i}`} className="inventory-slot opacity-50" />
            ))}
          </div>
        )}

        {activeTab === 'crops' && (
          <div className="grid grid-cols-4 gap-2">
            {crops.map((crop) => (
              <button
                key={crop.id}
                onClick={() => setSelectedItem(selectedItem === crop.id ? null : crop.id)}
                className={`
                  inventory-slot relative
                  ${selectedItem === crop.id ? 'selected' : ''}
                `}
                title={`${crop.name} (Quality: ${crop.quality})`}
              >
                <span className="text-xl">{crop.emoji}</span>
                <span className="absolute top-0 right-0 text-[8px] font-bold text-game-accent">
                  {crop.quality}
                </span>
                {crop.amount > 1 && (
                  <span className="absolute bottom-0 right-0 text-[10px] font-bold text-white bg-game-darker px-1 rounded">
                    {crop.amount}
                  </span>
                )}
              </button>
            ))}
            {/* Empty slots */}
            {Array.from({ length: Math.max(0, 12 - crops.length) }).map((_, i) => (
              <div key={`empty-${i}`} className="inventory-slot opacity-50" />
            ))}
          </div>
        )}

        {activeTab === 'crafting' && (
          <div className="space-y-2">
            {recipes.map((recipe) => (
              <div
                key={recipe.id}
                className="panel p-2 flex items-center gap-2 hover:border-game-primary transition cursor-pointer"
                onClick={() => onCraft?.(recipe.id)}
              >
                <span className="text-2xl">{recipe.emoji}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold text-white truncate">{recipe.name}</p>
                  <p className="text-[10px] text-slate-400 truncate">{recipe.description}</p>
                  <p className="text-[10px] text-game-accent">{recipe.cost}</p>
                </div>
                <button
                  className="btn-secondary text-[10px] px-2 py-1"
                  disabled={isLoading}
                >
                  Craft
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer - Selected Item Info */}
      {selectedItem !== null && activeTab !== 'crafting' && (
        <div className="p-3 border-t border-game-border bg-game-darker">
          <div className="flex items-center gap-2">
            <span className="text-2xl">
              {activeTab === 'items' && items.find(i => i.id === selectedItem)?.emoji}
              {activeTab === 'seeds' && seeds.find(s => s.id === selectedItem)?.emoji}
              {activeTab === 'crops' && crops.find(c => c.id === selectedItem)?.emoji}
            </span>
            <div className="flex-1">
              <p className="text-xs font-bold text-white">
                {activeTab === 'items' && items.find(i => i.id === selectedItem)?.name}
                {activeTab === 'seeds' && seeds.find(s => s.id === selectedItem)?.name}
                {activeTab === 'crops' && crops.find(c => c.id === selectedItem)?.name}
              </p>
              {activeTab === 'seeds' && (
                <p className="text-[10px] text-slate-400">
                  Growth: {seeds.find(s => s.id === selectedItem)?.growthTime}s
                </p>
              )}
            </div>
            <button className="btn-secondary text-[10px] px-2 py-1">
              Use
            </button>
          </div>
        </div>
      )}

      {/* Stats Footer */}
      <div className="p-2 border-t border-game-border bg-game-darker/50 flex justify-between text-[10px] text-slate-400">
        <span>Balance: {tokenBalance} FARM</span>
        <span>Harvests: {playerStats?.totalHarvests || 0}</span>
      </div>
    </div>
  )
}
