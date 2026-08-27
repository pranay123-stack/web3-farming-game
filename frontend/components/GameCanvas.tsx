'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Phaser from 'phaser'
import { MainScene } from '@/game/scenes/MainScene'
import { TILE_SIZE, type SceneBridge, type ScenePlot } from '@/game/types'
import { useGameState } from '@/providers/GameStateProvider'
import { useGameActions } from '@/hooks/useGameActions'
import { useMultiplayerState } from '@/hooks/useMultiplayer'
import { useWallet } from '@/hooks/useWallet'
import { seedMeta } from '@/lib/gameMeta'
import { formatToken } from '@/lib/format'

/**
 * Mounts Phaser and keeps it fed with chain and socket state.
 *
 * The game is created exactly once and then updated imperatively. The previous
 * version polled with `setInterval` for the scene to exist, restarted the
 * scene whenever a prop changed, and never cleared that interval - so
 * navigating away left a timer running against a destroyed game.
 */
export function GameCanvas({
  selectedPlotId,
  onSelectPlot,
}: {
  selectedPlotId: bigint | null
  onSelectPlot: (tokenId: bigint | null) => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const gameRef = useRef<Phaser.Game | null>(null)
  const sceneRef = useRef<MainScene | null>(null)

  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const { lands, chainNow } = useGameState()
  const { harvestCrop } = useGameActions()
  const { players, move, presenceVersion } = useMultiplayerState()
  const { address } = useWallet()

  // Latest values for the bridge, which must not be rebuilt on every render.
  const latest = useRef({ chainNow, harvestCrop, onSelectPlot, move })
  latest.current = { chainNow, harvestCrop, onSelectPlot, move }

  const bridge = useMemo<SceneBridge>(() => ({
    now: () => latest.current.chainNow,
    onPlotSelected: (tokenId) => {
      latest.current.onSelectPlot(tokenId === null ? null : BigInt(tokenId))
    },
    onHarvestRequested: (tokenId) => {
      const landTokenId = BigInt(tokenId)
      void latest.current.harvestCrop(landTokenId).then((result) => {
        // Reward feedback only after the chain confirms it.
        if (result.ok) {
          const plot = lands.find((l) => l.tokenId === landTokenId)
          const amount = plot?.farm?.expectedYield
          sceneRef.current?.showRewardBurst(
            tokenId,
            amount ? `+${formatToken(amount)} FGOLD` : 'Harvested'
          )
        }
      })
    },
    onMove: (x, y, facing, moving) => latest.current.move(x, y, facing, moving),
    // `lands` is intentionally read through the closure at call time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [])

  // --- create the game once ------------------------------------------------
  useEffect(() => {
    if (typeof window === 'undefined') return
    const container = containerRef.current
    if (!container || gameRef.current) return

    let disposed = false

    try {
      const game = new Phaser.Game({
        type: Phaser.AUTO,
        parent: container,
        width: container.clientWidth || 800,
        height: container.clientHeight || 600,
        backgroundColor: '#17140f',
        pixelArt: false,
        roundPixels: true,
        scale: {
          mode: Phaser.Scale.RESIZE,
          autoCenter: Phaser.Scale.CENTER_BOTH,
        },
        scene: [MainScene],
        input: { keyboard: true, mouse: true, touch: true },
        // The browser throttles rAF in a background tab anyway; pausing
        // explicitly stops the scene burning CPU when nobody is watching.
        autoFocus: true,
      })
      gameRef.current = game

      game.events.once(Phaser.Core.Events.READY, () => {
        if (disposed) return
        const scene = game.scene.getScene('MainScene') as MainScene | null
        if (!scene) {
          setError('Could not start the game scene.')
          return
        }
        scene.events.once('scene-ready', () => {
          if (disposed) return
          sceneRef.current = scene
          setReady(true)
        })
        scene.scene.start('MainScene', { bridge, playerAddress: address })
      })
    } catch (err) {
      console.error('[game] failed to initialise Phaser', err)
      setError('Could not start the game engine. Try reloading the page.')
    }

    const handleResize = () => {
      const game = gameRef.current
      const element = containerRef.current
      if (game && element) {
        game.scale.resize(element.clientWidth, element.clientHeight)
      }
    }
    window.addEventListener('resize', handleResize)

    return () => {
      disposed = true
      window.removeEventListener('resize', handleResize)
      sceneRef.current = null
      // `true` also removes the canvas from the DOM, so a remount does not
      // stack a second canvas on top of the first.
      gameRef.current?.destroy(true)
      gameRef.current = null
    }
    // Created once for the lifetime of the component; state flows in below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // --- feed plot state -----------------------------------------------------
  const scenePlots = useMemo<ScenePlot[]>(
    () =>
      lands.map((land) => {
        const meta = land.farm ? seedMeta(land.farm.seedTypeId) : null
        return {
          tokenId: land.tokenId.toString(),
          x: land.x,
          y: land.y,
          level: land.level,
          fertility: land.fertility,
          crop: land.farm && meta
            ? {
                seedTypeId: land.farm.seedTypeId,
                plantedAt: land.farm.plantedAt,
                harvestAt: land.farm.harvestAt,
                emoji: meta.emoji,
                cropEmoji: meta.cropEmoji,
                accent: meta.accent,
              }
            : null,
        }
      }),
    [lands]
  )

  useEffect(() => {
    if (!ready) return
    sceneRef.current?.syncPlots(scenePlots)
  }, [ready, scenePlots])

  // --- feed remote players -------------------------------------------------
  useEffect(() => {
    if (!ready) return
    sceneRef.current?.syncRemotePlayers(
      players.map((player) => ({
        id: player.id,
        username: player.username,
        x: player.x,
        y: player.y,
        facing: player.facing,
        moving: player.moving,
      }))
    )
    // presenceVersion changes on every presence mutation, which is cheaper to
    // compare than the player array itself.
  }, [ready, presenceVersion, players])

  // --- mirror selection ----------------------------------------------------
  useEffect(() => {
    if (!ready) return
    sceneRef.current?.setSelectedPlot(selectedPlotId ? selectedPlotId.toString() : null)
  }, [ready, selectedPlotId])

  return (
    <div ref={containerRef} className="relative h-full w-full overflow-hidden bg-soil-900">
      {!ready && !error && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-soil-900">
          <div className="text-center">
            <div className="mx-auto mb-3 h-10 w-10 animate-spin rounded-full border-2 border-leaf-500 border-t-transparent" />
            <p className="text-sm text-text-secondary">Preparing the farm…</p>
          </div>
        </div>
      )}

      {error && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-soil-900 p-6">
          <div className="panel max-w-sm p-4 text-center">
            <p className="text-2xl" aria-hidden>⚠️</p>
            <p className="mt-2 text-sm font-medium text-rose-500">Game failed to start</p>
            <p className="mt-1 text-xs text-text-secondary">{error}</p>
            <button className="btn-secondary mt-3 text-xs" onClick={() => window.location.reload()}>
              Reload
            </button>
          </div>
        </div>
      )}

      {ready && (
        <div className="pointer-events-none absolute bottom-3 left-3 flex gap-3 rounded-lg bg-soil-950/70 px-3 py-1.5 text-[11px] text-text-muted backdrop-blur">
          <span><kbd className="text-text-secondary">WASD</kbd> move</span>
          <span><kbd className="text-text-secondary">Click</kbd> plot</span>
          <span><kbd className="text-text-secondary">Scroll</kbd> zoom</span>
        </div>
      )}
    </div>
  )
}

export default GameCanvas
