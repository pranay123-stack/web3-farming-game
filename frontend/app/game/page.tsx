'use client'

import { useState } from 'react'
import dynamic from 'next/dynamic'
import { GameStateProvider } from '@/providers/GameStateProvider'
import { useMultiplayerConnection } from '@/hooks/useMultiplayer'
import { GameHUD } from '@/components/GameHUD'
import { OnboardingGate } from '@/components/OnboardingGate'
import { FarmPanel } from '@/components/FarmPanel'
import { Inventory } from '@/components/Inventory'
import { SeedShop } from '@/components/SeedShop'
import { CraftingPanel } from '@/components/CraftingPanel'
import { Marketplace } from '@/components/Marketplace'
import { Chat } from '@/components/Chat'
import { TransactionFeed } from '@/components/TransactionFeed'
import { PlayerProfileCard } from '@/components/PlayerProfileCard'

// Phaser reaches for `window` at import time, so the canvas must never be
// server-rendered.
const GameCanvas = dynamic(() => import('@/components/GameCanvas'), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center bg-soil-900">
      <div className="text-center">
        <div className="mx-auto mb-3 h-10 w-10 animate-spin rounded-full border-2 border-leaf-500 border-t-transparent" />
        <p className="text-sm text-text-secondary">Loading game engine…</p>
      </div>
    </div>
  ),
})

type SidePanel = 'farm' | 'shop' | 'craft' | 'market'

const PANELS: { id: SidePanel; label: string; icon: string }[] = [
  { id: 'farm', label: 'Farm', icon: '🌱' },
  { id: 'shop', label: 'Shop', icon: '🛒' },
  { id: 'craft', label: 'Craft', icon: '🔨' },
  { id: 'market', label: 'Market', icon: '🏪' },
]

export default function GamePage() {
  return (
    <GameStateProvider>
      <GameShell />
    </GameStateProvider>
  )
}

function GameShell() {
  // One connection for the whole page; every other component reads the store.
  const multiplayer = useMultiplayerConnection()

  const [panel, setPanel] = useState<SidePanel>('farm')
  const [selectedPlotId, setSelectedPlotId] = useState<bigint | null>(null)
  const [mobilePanelOpen, setMobilePanelOpen] = useState(false)

  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden bg-soil-950">
      <GameHUD onlineCount={multiplayer.onlineCount} multiplayerStatus={multiplayer.status} />

      <OnboardingGate>
        <div className="flex min-h-0 flex-1">
          {/* Game viewport */}
          <main className="relative min-w-0 flex-1">
            <GameCanvas selectedPlotId={selectedPlotId} onSelectPlot={setSelectedPlotId} />

            <button
              className="btn-secondary absolute right-3 top-3 z-20 text-xs lg:hidden"
              onClick={() => setMobilePanelOpen((open) => !open)}
              aria-expanded={mobilePanelOpen}
            >
              {mobilePanelOpen ? 'Hide panel' : 'Open panel'}
            </button>
          </main>

          {/* Side panel */}
          <aside
            className={`flex w-full max-w-sm shrink-0 flex-col border-l bg-soil-900 lg:w-[340px] ${
              mobilePanelOpen
                ? 'absolute inset-y-0 right-0 top-[52px] z-30 shadow-2xl'
                : 'hidden lg:flex'
            }`}
            style={{ borderColor: 'var(--soil-700)' }}
          >
            <nav
              className="flex shrink-0 gap-1 border-b p-2"
              style={{ borderColor: 'var(--soil-700)' }}
              aria-label="Game panels"
            >
              {PANELS.map((item) => (
                <button
                  key={item.id}
                  onClick={() => setPanel(item.id)}
                  className={`flex flex-1 flex-col items-center gap-0.5 rounded-md px-1 py-1.5 text-[10px] font-medium transition ${
                    panel === item.id
                      ? 'bg-leaf-500 text-soil-950'
                      : 'text-text-secondary hover:bg-soil-800 hover:text-text-primary'
                  }`}
                  aria-current={panel === item.id ? 'page' : undefined}
                >
                  <span className="text-base" aria-hidden>{item.icon}</span>
                  {item.label}
                </button>
              ))}
            </nav>

            <div className="min-h-0 flex-1 overflow-hidden">
              {panel === 'farm' && (
                <div className="flex h-full flex-col">
                  <PlayerProfileCard />
                  <div className="min-h-0 flex-[3] overflow-hidden">
                    <FarmPanel
                      selectedPlotId={selectedPlotId}
                      onSelectPlot={setSelectedPlotId}
                    />
                  </div>
                  <div
                    className="min-h-0 flex-[2] overflow-hidden border-t"
                    style={{ borderColor: 'var(--soil-700)' }}
                  >
                    <Inventory selectedPlotId={selectedPlotId} />
                  </div>
                </div>
              )}
              {panel === 'shop' && <SeedShop />}
              {panel === 'craft' && <CraftingPanel />}
              {panel === 'market' && <Marketplace />}
            </div>

            <div
              className="h-56 shrink-0 border-t"
              style={{ borderColor: 'var(--soil-700)' }}
            >
              <Chat />
            </div>
          </aside>
        </div>
      </OnboardingGate>

      <TransactionFeed />
    </div>
  )
}
