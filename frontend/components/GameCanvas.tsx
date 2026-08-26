'use client'

import { useEffect, useRef, useState } from 'react'
import Phaser from 'phaser'
import { MainScene } from '@/game/scenes/MainScene'

interface GameCanvasProps {
  playerAddress: string
  selectedAction: 'plant' | 'harvest' | 'craft' | null
  onPlant: (plotId: number, seedType: number) => void
  onHarvest: (plotId: number) => void
  onGameReady?: () => void
}

export default function GameCanvas({
  playerAddress,
  selectedAction,
  onPlant,
  onHarvest,
  onGameReady,
}: GameCanvasProps) {
  const gameRef = useRef<Phaser.Game | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    // Only run on client
    if (typeof window === 'undefined') return

    // Prevent multiple game instances
    if (gameRef.current) return

    // Wait for container to be ready
    if (!containerRef.current) return

    const initGame = async () => {
      try {
        setIsLoading(true)
        setError(null)

        // Get container dimensions
        const container = containerRef.current!
        const width = container.clientWidth || 800
        const height = container.clientHeight || 600

        // Phaser game configuration
        const config: Phaser.Types.Core.GameConfig = {
          type: Phaser.AUTO,
          parent: container,
          width,
          height,
          backgroundColor: '#0f172a',
          pixelArt: true,
          roundPixels: true,
          antialias: false,
          scale: {
            mode: Phaser.Scale.RESIZE,
            autoCenter: Phaser.Scale.CENTER_BOTH,
          },
          physics: {
            default: 'arcade',
            arcade: {
              gravity: { x: 0, y: 0 },
              debug: false,
            },
          },
          scene: [MainScene],
          input: {
            keyboard: true,
            mouse: true,
            touch: true,
          },
        }

        // Create game instance
        gameRef.current = new Phaser.Game(config)

        // Wait for scene to be created and start it with config
        const checkSceneReady = setInterval(() => {
          if (!gameRef.current) {
            clearInterval(checkSceneReady)
            return
          }

          const mainScene = gameRef.current.scene.getScene('MainScene') as MainScene
          if (mainScene) {
            clearInterval(checkSceneReady)

            // Listen for the scene's ready event
            mainScene.events.once('create', () => {
              setIsLoading(false)
              onGameReady?.()
            })

            // Restart scene with config data
            mainScene.scene.restart({
              playerAddress,
              selectedAction,
              onPlant,
              onHarvest,
            })
          }
        }, 100)

        // Handle resize
        const handleResize = () => {
          if (gameRef.current && containerRef.current) {
            gameRef.current.scale.resize(
              containerRef.current.clientWidth,
              containerRef.current.clientHeight
            )
          }
        }

        window.addEventListener('resize', handleResize)

        // Cleanup resize listener
        return () => {
          window.removeEventListener('resize', handleResize)
        }
      } catch (err) {
        console.error('Error initializing Phaser:', err)
        setError('Failed to initialize game engine')
        setIsLoading(false)
      }
    }

    initGame()

    // Cleanup on unmount
    return () => {
      if (gameRef.current) {
        gameRef.current.destroy(true)
        gameRef.current = null
      }
    }
  }, [])

  // Update scene config when props change
  useEffect(() => {
    if (!gameRef.current) return

    const mainScene = gameRef.current.scene.getScene('MainScene') as MainScene
    if (mainScene && mainScene.scene.isActive()) {
      mainScene.updateConfig({
        playerAddress,
        selectedAction,
        onPlant,
        onHarvest,
      })
    }
  }, [playerAddress, selectedAction, onPlant, onHarvest])

  return (
    <div ref={containerRef} className="w-full h-full relative">
      {/* Loading overlay */}
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-game-darker z-10">
          <div className="text-center">
            <div className="animate-spin w-16 h-16 border-4 border-game-primary border-t-transparent rounded-full mx-auto mb-4" />
            <p className="font-pixel text-game-primary text-sm">Loading Farm...</p>
            <p className="text-slate-500 text-xs mt-2">Generating world...</p>
          </div>
        </div>
      )}

      {/* Error overlay */}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-game-darker z-10">
          <div className="text-center panel max-w-md">
            <div className="text-4xl mb-4">⚠️</div>
            <h3 className="font-pixel text-red-400 text-sm mb-2">Error</h3>
            <p className="text-slate-400 text-sm mb-4">{error}</p>
            <button
              onClick={() => window.location.reload()}
              className="btn-game"
            >
              Retry
            </button>
          </div>
        </div>
      )}

      {/* Controls hint */}
      {!isLoading && !error && (
        <div className="absolute bottom-4 left-4 panel opacity-75 hover:opacity-100 transition">
          <div className="flex items-center gap-4 text-xs text-slate-400">
            <div className="flex items-center gap-1">
              <kbd className="px-2 py-1 bg-game-darker rounded text-[10px]">WASD</kbd>
              <span>Move</span>
            </div>
            <div className="flex items-center gap-1">
              <kbd className="px-2 py-1 bg-game-darker rounded text-[10px]">Click</kbd>
              <span>Interact</span>
            </div>
            <div className="flex items-center gap-1">
              <kbd className="px-2 py-1 bg-game-darker rounded text-[10px]">Scroll</kbd>
              <span>Zoom</span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
