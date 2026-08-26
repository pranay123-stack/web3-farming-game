'use client'

import { useState, useEffect } from 'react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import WalletConnect from '@/components/WalletConnect'
import Inventory from '@/components/Inventory'
import Chat from '@/components/Chat'
import { useWallet } from '@/hooks/useWallet'
import { useGameContract } from '@/hooks/useGameContract'

// Dynamic import for Phaser (client-side only)
const GameCanvas = dynamic(() => import('@/components/GameCanvas'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full flex items-center justify-center bg-game-darker">
      <div className="text-center">
        <div className="animate-spin w-16 h-16 border-4 border-game-primary border-t-transparent rounded-full mx-auto mb-4" />
        <p className="font-pixel text-game-primary text-sm">Loading Game...</p>
      </div>
    </div>
  ),
})

export default function GamePage() {
  const { address, isConnected } = useWallet()
  const { tokenBalance, plantCrop, harvestCrop, craftItem, isLoading } = useGameContract()
  const [selectedAction, setSelectedAction] = useState<'plant' | 'harvest' | 'craft' | null>(null)
  const [showInventory, setShowInventory] = useState(true)
  const [showChat, setShowChat] = useState(true)
  const [showMinimap, setShowMinimap] = useState(true)
  const [gameReady, setGameReady] = useState(false)

  // Game actions
  const handlePlant = async (plotId: number, seedType: number) => {
    if (!isConnected) return
    await plantCrop(plotId, seedType)
  }

  const handleHarvest = async (plotId: number) => {
    if (!isConnected) return
    await harvestCrop(plotId)
  }

  const handleCraft = async (recipeId: number) => {
    if (!isConnected) return
    await craftItem(recipeId)
  }

  return (
    <div className="min-h-screen flex flex-col bg-game-darker">
      {/* Game Header */}
      <header className="bg-game-dark/95 backdrop-blur border-b border-game-border z-50">
        <div className="container mx-auto px-4 py-2 flex justify-between items-center">
          <div className="flex items-center gap-4">
            <Link href="/" className="flex items-center gap-2 hover:opacity-80 transition">
              <div className="w-8 h-8 bg-game-primary rounded flex items-center justify-center">
                <span className="text-lg">🌾</span>
              </div>
              <span className="font-pixel text-game-primary text-xs hidden sm:block">
                GameFi Farm
              </span>
            </Link>

            {/* Token Balance */}
            <div className="panel py-1 px-3 flex items-center gap-2">
              <span className="text-lg">🪙</span>
              <span className="font-pixel text-game-accent text-xs">
                {tokenBalance} FARM
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Toggle Buttons */}
            <button
              onClick={() => setShowMinimap(!showMinimap)}
              className={`btn-secondary text-xs ${showMinimap ? 'bg-game-primary text-game-darker' : ''}`}
            >
              Map
            </button>
            <button
              onClick={() => setShowInventory(!showInventory)}
              className={`btn-secondary text-xs ${showInventory ? 'bg-game-primary text-game-darker' : ''}`}
            >
              Inv
            </button>
            <button
              onClick={() => setShowChat(!showChat)}
              className={`btn-secondary text-xs ${showChat ? 'bg-game-primary text-game-darker' : ''}`}
            >
              Chat
            </button>
            <WalletConnect compact />
          </div>
        </div>
      </header>

      {/* Main Game Area */}
      <div className="flex-1 flex relative">
        {/* Left Sidebar - Actions */}
        <aside className="w-16 bg-game-dark/80 border-r border-game-border flex flex-col items-center py-4 gap-2">
          <ActionButton
            icon="🌱"
            label="Plant"
            active={selectedAction === 'plant'}
            onClick={() => setSelectedAction(selectedAction === 'plant' ? null : 'plant')}
            disabled={!isConnected}
          />
          <ActionButton
            icon="🌾"
            label="Harvest"
            active={selectedAction === 'harvest'}
            onClick={() => setSelectedAction(selectedAction === 'harvest' ? null : 'harvest')}
            disabled={!isConnected}
          />
          <ActionButton
            icon="🔨"
            label="Craft"
            active={selectedAction === 'craft'}
            onClick={() => setSelectedAction(selectedAction === 'craft' ? null : 'craft')}
            disabled={!isConnected}
          />
          <div className="flex-1" />
          <ActionButton
            icon="⚙️"
            label="Settings"
            onClick={() => {}}
          />
        </aside>

        {/* Game Canvas */}
        <main className="flex-1 relative">
          <div className="absolute inset-0 game-container">
            <GameCanvas
              playerAddress={address || ''}
              selectedAction={selectedAction}
              onPlant={handlePlant}
              onHarvest={handleHarvest}
              onGameReady={() => setGameReady(true)}
            />
          </div>

          {/* Mini-map Overlay */}
          {showMinimap && (
            <div className="absolute top-4 right-4 w-40 h-40 panel overflow-hidden">
              <div className="text-xs font-pixel text-game-primary mb-1">Mini-Map</div>
              <div className="w-full h-28 bg-game-darker rounded border border-game-border relative">
                {/* Simplified minimap representation */}
                <div className="absolute inset-0 grid grid-cols-8 grid-rows-8 gap-px p-1">
                  {Array.from({ length: 64 }).map((_, i) => (
                    <div
                      key={i}
                      className={`rounded-sm ${
                        Math.random() > 0.7 ? 'bg-game-primary/50' :
                        Math.random() > 0.5 ? 'bg-blue-500/30' : 'bg-amber-700/30'
                      }`}
                    />
                  ))}
                </div>
                {/* Player position indicator */}
                <div className="absolute top-1/2 left-1/2 w-2 h-2 bg-red-500 rounded-full transform -translate-x-1/2 -translate-y-1/2 animate-pulse" />
              </div>
            </div>
          )}

          {/* Action Info Overlay */}
          {selectedAction && (
            <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 panel">
              <p className="font-pixel text-xs text-game-primary">
                {selectedAction === 'plant' && 'Click on an empty plot to plant a seed'}
                {selectedAction === 'harvest' && 'Click on a mature crop to harvest'}
                {selectedAction === 'craft' && 'Open inventory to craft items'}
              </p>
            </div>
          )}

          {/* Connection Warning */}
          {!isConnected && (
            <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 panel text-center">
              <p className="font-pixel text-game-accent text-sm mb-4">
                Connect your wallet to start farming!
              </p>
              <WalletConnect />
            </div>
          )}
        </main>

        {/* Right Sidebar - Inventory & Chat */}
        <aside className="w-72 bg-game-dark/80 border-l border-game-border flex flex-col">
          {showInventory && (
            <div className="flex-1 border-b border-game-border overflow-hidden">
              <Inventory onCraft={handleCraft} />
            </div>
          )}
          {showChat && (
            <div className="h-64">
              <Chat playerAddress={address || ''} />
            </div>
          )}
        </aside>
      </div>

      {/* Loading Overlay */}
      {isLoading && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="panel text-center">
            <div className="animate-spin w-12 h-12 border-4 border-game-primary border-t-transparent rounded-full mx-auto mb-4" />
            <p className="font-pixel text-game-primary text-sm">Processing Transaction...</p>
          </div>
        </div>
      )}
    </div>
  )
}

function ActionButton({
  icon,
  label,
  active = false,
  disabled = false,
  onClick,
}: {
  icon: string
  label: string
  active?: boolean
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`
        w-12 h-12 rounded-lg flex flex-col items-center justify-center
        transition-all duration-200
        ${active ? 'bg-game-primary text-game-darker glow' : 'bg-game-darker hover:bg-game-border'}
        ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
      `}
      title={label}
    >
      <span className="text-xl">{icon}</span>
      <span className="text-[8px] font-pixel mt-1">{label}</span>
    </button>
  )
}
