import Phaser from 'phaser'
import { Player } from '../sprites/Player'

// Tile types
const TILE_GRASS = 0
const TILE_DIRT = 1
const TILE_WATER = 2
const TILE_FENCE = 3
const TILE_PATH = 4

// Crop stages
const CROP_EMPTY = 0
const CROP_PLANTED = 1
const CROP_GROWING = 2
const CROP_READY = 3

interface FarmPlot {
  tileX: number
  tileY: number
  stage: number
  cropType: number
  plantedAt: number
  graphics: Phaser.GameObjects.Container
}

interface OtherPlayer {
  id: string
  player: Player
  lastUpdate: number
}

interface MainSceneConfig {
  playerAddress: string
  selectedAction: 'plant' | 'harvest' | 'craft' | null
  onPlant: (plotId: number, seedType: number) => void
  onHarvest: (plotId: number) => void
}

export class MainScene extends Phaser.Scene {
  // Configuration
  private config: MainSceneConfig
  private mapWidth: number = 32
  private mapHeight: number = 32
  private tileSize: number = 32

  // Player
  private localPlayer!: Player
  private otherPlayers: Map<string, OtherPlayer> = new Map()

  // Map data
  private tileMap: number[][] = []
  private farmPlots: Map<string, FarmPlot> = new Map()

  // Input
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys
  private wasdKeys!: {
    W: Phaser.Input.Keyboard.Key
    A: Phaser.Input.Keyboard.Key
    S: Phaser.Input.Keyboard.Key
    D: Phaser.Input.Keyboard.Key
  }

  // Graphics layers
  private groundLayer!: Phaser.GameObjects.Container
  private objectLayer!: Phaser.GameObjects.Container
  private uiLayer!: Phaser.GameObjects.Container

  // State
  private lastMoveTime: number = 0
  private moveDelay: number = 150 // ms between moves
  private selectedPlot: FarmPlot | null = null
  private hoverTile: { x: number; y: number } | null = null

  constructor() {
    super({ key: 'MainScene' })
    this.config = {
      playerAddress: '',
      selectedAction: null,
      onPlant: () => {},
      onHarvest: () => {},
    }
  }

  init(data: MainSceneConfig): void {
    this.config = data
  }

  create(): void {
    // Create layers
    this.groundLayer = this.add.container(0, 0)
    this.objectLayer = this.add.container(0, 0)
    this.uiLayer = this.add.container(0, 0)

    // Generate and render map
    this.generateMap()
    this.renderMap()

    // Create farm plots
    this.createFarmPlots()

    // Create local player
    this.createLocalPlayer()

    // Create some other players for demo
    this.createDemoPlayers()

    // Setup input
    this.setupInput()

    // Setup camera
    this.setupCamera()

    // Setup pointer events
    this.setupPointerEvents()

    // Emit ready event
    this.events.emit('gameReady')
  }

  private generateMap(): void {
    // Initialize with grass
    this.tileMap = Array(this.mapHeight).fill(null).map(() =>
      Array(this.mapWidth).fill(TILE_GRASS)
    )

    // Add some water (pond in corner)
    for (let y = 2; y < 6; y++) {
      for (let x = 2; x < 7; x++) {
        this.tileMap[y][x] = TILE_WATER
      }
    }

    // Add paths
    for (let x = 10; x < this.mapWidth - 2; x++) {
      this.tileMap[15][x] = TILE_PATH
    }
    for (let y = 5; y < 25; y++) {
      this.tileMap[y][10] = TILE_PATH
    }

    // Add fences around edges
    for (let x = 0; x < this.mapWidth; x++) {
      this.tileMap[0][x] = TILE_FENCE
      this.tileMap[this.mapHeight - 1][x] = TILE_FENCE
    }
    for (let y = 0; y < this.mapHeight; y++) {
      this.tileMap[y][0] = TILE_FENCE
      this.tileMap[y][this.mapWidth - 1] = TILE_FENCE
    }

    // Add dirt patches (farmable areas)
    const dirtPatches = [
      { x: 12, y: 5, w: 6, h: 4 },
      { x: 12, y: 18, w: 6, h: 4 },
      { x: 20, y: 5, w: 6, h: 4 },
      { x: 20, y: 18, w: 6, h: 4 },
    ]

    for (const patch of dirtPatches) {
      for (let y = patch.y; y < patch.y + patch.h; y++) {
        for (let x = patch.x; x < patch.x + patch.w; x++) {
          if (y < this.mapHeight && x < this.mapWidth) {
            this.tileMap[y][x] = TILE_DIRT
          }
        }
      }
    }
  }

  private renderMap(): void {
    const colors: Record<number, number> = {
      [TILE_GRASS]: 0x4ade80,
      [TILE_DIRT]: 0x8b5a2b,
      [TILE_WATER]: 0x38bdf8,
      [TILE_FENCE]: 0x78716c,
      [TILE_PATH]: 0xd6d3d1,
    }

    for (let y = 0; y < this.mapHeight; y++) {
      for (let x = 0; x < this.mapWidth; x++) {
        const tileType = this.tileMap[y][x]
        const color = colors[tileType] || 0x4ade80

        // Base tile
        const tile = this.add.rectangle(
          x * this.tileSize + this.tileSize / 2,
          y * this.tileSize + this.tileSize / 2,
          this.tileSize - 1,
          this.tileSize - 1,
          color
        )
        tile.setStrokeStyle(1, Phaser.Display.Color.IntegerToColor(color).darken(20).color)
        this.groundLayer.add(tile)

        // Add details based on tile type
        if (tileType === TILE_GRASS) {
          // Random grass blades
          if (Math.random() > 0.7) {
            const grass = this.add.text(
              x * this.tileSize + 8 + Math.random() * 16,
              y * this.tileSize + 8 + Math.random() * 16,
              Math.random() > 0.5 ? ',' : "'",
              { fontSize: '12px', color: '#22c55e' }
            )
            this.groundLayer.add(grass)
          }
        } else if (tileType === TILE_WATER) {
          // Water ripples
          if (Math.random() > 0.8) {
            const ripple = this.add.circle(
              x * this.tileSize + 16,
              y * this.tileSize + 16,
              4,
              0x7dd3fc,
              0.5
            )
            this.groundLayer.add(ripple)

            // Animate ripples
            this.tweens.add({
              targets: ripple,
              alpha: 0,
              scale: 2,
              duration: 2000,
              repeat: -1,
              delay: Math.random() * 2000,
            })
          }
        } else if (tileType === TILE_FENCE) {
          // Fence post
          const post = this.add.rectangle(
            x * this.tileSize + this.tileSize / 2,
            y * this.tileSize + this.tileSize / 2,
            8,
            this.tileSize - 4,
            0x57534e
          )
          post.setStrokeStyle(1, 0x44403c)
          this.objectLayer.add(post)
        }
      }
    }
  }

  private createFarmPlots(): void {
    // Find all dirt tiles and create farm plots
    let plotId = 0
    for (let y = 0; y < this.mapHeight; y++) {
      for (let x = 0; x < this.mapWidth; x++) {
        if (this.tileMap[y][x] === TILE_DIRT) {
          const plot = this.createFarmPlot(x, y, plotId++)
          this.farmPlots.set(`${x},${y}`, plot)
        }
      }
    }

    // Add some demo crops
    const demoCrops = [
      { x: 13, y: 6, stage: CROP_READY, type: 1 },
      { x: 14, y: 6, stage: CROP_GROWING, type: 1 },
      { x: 15, y: 6, stage: CROP_PLANTED, type: 2 },
      { x: 21, y: 6, stage: CROP_READY, type: 3 },
      { x: 22, y: 6, stage: CROP_READY, type: 2 },
    ]

    for (const crop of demoCrops) {
      const plot = this.farmPlots.get(`${crop.x},${crop.y}`)
      if (plot) {
        plot.stage = crop.stage
        plot.cropType = crop.type
        this.updatePlotGraphics(plot)
      }
    }
  }

  private createFarmPlot(tileX: number, tileY: number, plotId: number): FarmPlot {
    const container = this.add.container(
      tileX * this.tileSize + this.tileSize / 2,
      tileY * this.tileSize + this.tileSize / 2
    )
    this.objectLayer.add(container)

    const plot: FarmPlot = {
      tileX,
      tileY,
      stage: CROP_EMPTY,
      cropType: 0,
      plantedAt: 0,
      graphics: container,
    }

    return plot
  }

  private updatePlotGraphics(plot: FarmPlot): void {
    // Clear existing graphics
    plot.graphics.removeAll(true)

    if (plot.stage === CROP_EMPTY) {
      // Show empty soil lines
      const lines = this.add.graphics()
      lines.lineStyle(1, 0x6b4423, 0.5)
      lines.lineBetween(-10, -5, 10, -5)
      lines.lineBetween(-10, 0, 10, 0)
      lines.lineBetween(-10, 5, 10, 5)
      plot.graphics.add(lines)
    } else {
      // Show crop based on stage
      const cropEmojis: Record<number, string[]> = {
        1: ['🌱', '🌿', '🌾'], // Wheat
        2: ['🌱', '🌿', '🌽'], // Corn
        3: ['🌱', '🌿', '🍅'], // Tomato
      }

      const emojis = cropEmojis[plot.cropType] || cropEmojis[1]
      let emoji = ''
      let scale = 1

      switch (plot.stage) {
        case CROP_PLANTED:
          emoji = emojis[0]
          scale = 0.8
          break
        case CROP_GROWING:
          emoji = emojis[1]
          scale = 1
          break
        case CROP_READY:
          emoji = emojis[2]
          scale = 1.2
          break
      }

      const cropText = this.add.text(0, 0, emoji, {
        fontSize: `${20 * scale}px`,
      })
      cropText.setOrigin(0.5, 0.5)
      plot.graphics.add(cropText)

      // Add sparkle effect for ready crops
      if (plot.stage === CROP_READY) {
        const sparkle = this.add.text(8, -8, '✨', { fontSize: '10px' })
        plot.graphics.add(sparkle)

        this.tweens.add({
          targets: sparkle,
          alpha: 0.3,
          duration: 500,
          yoyo: true,
          repeat: -1,
        })
      }
    }
  }

  private createLocalPlayer(): void {
    // Start position (on a path)
    const startX = 11
    const startY = 12

    this.localPlayer = new Player({
      scene: this,
      x: startX * this.tileSize + this.tileSize / 2,
      y: startY * this.tileSize + this.tileSize / 2,
      texture: 'player',
      playerId: this.config.playerAddress || 'local',
      isLocalPlayer: true,
      username: this.config.playerAddress
        ? `${this.config.playerAddress.slice(0, 6)}...`
        : 'You',
    })
  }

  private createDemoPlayers(): void {
    // Add some demo players for multiplayer feel
    const demoPositions = [
      { x: 14, y: 7, id: '0x1234...5678' },
      { x: 22, y: 19, id: '0xabcd...efgh' },
      { x: 8, y: 20, id: '0x9876...5432' },
    ]

    for (const pos of demoPositions) {
      const player = new Player({
        scene: this,
        x: pos.x * this.tileSize + this.tileSize / 2,
        y: pos.y * this.tileSize + this.tileSize / 2,
        texture: 'player',
        playerId: pos.id,
        isLocalPlayer: false,
        username: pos.id,
      })

      this.otherPlayers.set(pos.id, {
        id: pos.id,
        player,
        lastUpdate: Date.now(),
      })

      // Make them move randomly
      this.time.addEvent({
        delay: 2000 + Math.random() * 3000,
        loop: true,
        callback: () => {
          const dx = Math.floor(Math.random() * 3) - 1
          const dy = Math.floor(Math.random() * 3) - 1
          player.moveByTile(dx, dy, this.tileSize)
        },
      })
    }
  }

  private setupInput(): void {
    this.cursors = this.input.keyboard!.createCursorKeys()
    this.wasdKeys = {
      W: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.W),
      A: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.A),
      S: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.S),
      D: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.D),
    }
  }

  private setupCamera(): void {
    // Set world bounds
    this.cameras.main.setBounds(
      0,
      0,
      this.mapWidth * this.tileSize,
      this.mapHeight * this.tileSize
    )

    // Follow player
    this.cameras.main.startFollow(this.localPlayer, true, 0.1, 0.1)
    this.cameras.main.setZoom(1.5)

    // Add zoom controls
    this.input.on('wheel', (pointer: Phaser.Input.Pointer, gameObjects: unknown[], deltaX: number, deltaY: number) => {
      const currentZoom = this.cameras.main.zoom
      const newZoom = Phaser.Math.Clamp(currentZoom - deltaY * 0.001, 0.5, 3)
      this.cameras.main.setZoom(newZoom)
    })
  }

  private setupPointerEvents(): void {
    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      const worldPoint = this.cameras.main.getWorldPoint(pointer.x, pointer.y)
      const tileX = Math.floor(worldPoint.x / this.tileSize)
      const tileY = Math.floor(worldPoint.y / this.tileSize)

      this.hoverTile = { x: tileX, y: tileY }
    })

    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (pointer.leftButtonDown()) {
        const worldPoint = this.cameras.main.getWorldPoint(pointer.x, pointer.y)
        const tileX = Math.floor(worldPoint.x / this.tileSize)
        const tileY = Math.floor(worldPoint.y / this.tileSize)

        this.handleTileClick(tileX, tileY)
      }
    })
  }

  private handleTileClick(tileX: number, tileY: number): void {
    const plotKey = `${tileX},${tileY}`
    const plot = this.farmPlots.get(plotKey)

    if (!plot) return

    // Calculate distance from player
    const playerTile = this.localPlayer.getTilePosition(this.tileSize)
    const distance = Math.abs(playerTile.x - tileX) + Math.abs(playerTile.y - tileY)

    if (distance > 2) {
      // Too far - move closer first
      return
    }

    const action = this.config.selectedAction

    if (action === 'plant' && plot.stage === CROP_EMPTY) {
      // Plant a crop
      plot.stage = CROP_PLANTED
      plot.cropType = 1 // Default to wheat
      plot.plantedAt = Date.now()
      this.updatePlotGraphics(plot)

      // Call the plant callback
      this.config.onPlant(tileX * this.mapWidth + tileY, 1)

      // Simulate growth
      this.simulateCropGrowth(plot)

    } else if (action === 'harvest' && plot.stage === CROP_READY) {
      // Harvest the crop
      this.config.onHarvest(tileX * this.mapWidth + tileY)

      // Add harvest animation
      this.add.particles(
        tileX * this.tileSize + this.tileSize / 2,
        tileY * this.tileSize + this.tileSize / 2,
        undefined,
        {
          speed: 100,
          scale: { start: 0.5, end: 0 },
          lifespan: 500,
          quantity: 10,
          emitting: false,
        }
      )

      // Reset plot
      plot.stage = CROP_EMPTY
      plot.cropType = 0
      plot.plantedAt = 0
      this.updatePlotGraphics(plot)
    }
  }

  private simulateCropGrowth(plot: FarmPlot): void {
    // Stage 1 -> Stage 2
    this.time.delayedCall(3000, () => {
      if (plot.stage === CROP_PLANTED) {
        plot.stage = CROP_GROWING
        this.updatePlotGraphics(plot)
      }
    })

    // Stage 2 -> Stage 3
    this.time.delayedCall(6000, () => {
      if (plot.stage === CROP_GROWING) {
        plot.stage = CROP_READY
        this.updatePlotGraphics(plot)
      }
    })
  }

  update(time: number, delta: number): void {
    // Handle input
    this.handleMovementInput(time)

    // Update local player
    this.localPlayer.update(time, delta)

    // Update other players
    this.otherPlayers.forEach((otherPlayer) => {
      otherPlayer.player.update(time, delta)
    })

    // Update UI layer based on hover
    this.updateHoverIndicator()
  }

  private handleMovementInput(time: number): void {
    if (time - this.lastMoveTime < this.moveDelay) return
    if (this.localPlayer.isCurrentlyMoving()) return

    let dx = 0
    let dy = 0

    if (this.cursors.left.isDown || this.wasdKeys.A.isDown) {
      dx = -1
    } else if (this.cursors.right.isDown || this.wasdKeys.D.isDown) {
      dx = 1
    } else if (this.cursors.up.isDown || this.wasdKeys.W.isDown) {
      dy = -1
    } else if (this.cursors.down.isDown || this.wasdKeys.S.isDown) {
      dy = 1
    }

    if (dx !== 0 || dy !== 0) {
      const currentTile = this.localPlayer.getTilePosition(this.tileSize)
      const newTileX = currentTile.x + dx
      const newTileY = currentTile.y + dy

      // Check bounds
      if (newTileX < 0 || newTileX >= this.mapWidth ||
          newTileY < 0 || newTileY >= this.mapHeight) {
        return
      }

      // Check for blocking tiles
      const tileType = this.tileMap[newTileY][newTileX]
      if (tileType === TILE_WATER || tileType === TILE_FENCE) {
        return
      }

      this.localPlayer.moveByTile(dx, dy, this.tileSize)
      this.lastMoveTime = time
    }
  }

  private updateHoverIndicator(): void {
    // Remove existing hover indicator
    this.uiLayer.removeAll(true)

    if (!this.hoverTile) return

    const { x: tileX, y: tileY } = this.hoverTile

    // Check if hovering over a farm plot
    const plotKey = `${tileX},${tileY}`
    const plot = this.farmPlots.get(plotKey)

    if (plot && this.config.selectedAction) {
      // Show action indicator
      const indicator = this.add.rectangle(
        tileX * this.tileSize + this.tileSize / 2,
        tileY * this.tileSize + this.tileSize / 2,
        this.tileSize - 2,
        this.tileSize - 2,
        this.config.selectedAction === 'plant' ? 0x4ade80 : 0xfbbf24,
        0.3
      )
      indicator.setStrokeStyle(2, this.config.selectedAction === 'plant' ? 0x22c55e : 0xf59e0b)
      this.uiLayer.add(indicator)
    }
  }

  // Public method to update config
  updateConfig(newConfig: Partial<MainSceneConfig>): void {
    this.config = { ...this.config, ...newConfig }
  }

  // Public method to add a new player
  addPlayer(playerId: string, x: number, y: number): void {
    if (this.otherPlayers.has(playerId)) return

    const player = new Player({
      scene: this,
      x: x * this.tileSize + this.tileSize / 2,
      y: y * this.tileSize + this.tileSize / 2,
      texture: 'player',
      playerId,
      isLocalPlayer: false,
    })

    this.otherPlayers.set(playerId, {
      id: playerId,
      player,
      lastUpdate: Date.now(),
    })
  }

  // Public method to remove a player
  removePlayer(playerId: string): void {
    const otherPlayer = this.otherPlayers.get(playerId)
    if (otherPlayer) {
      otherPlayer.player.destroy()
      this.otherPlayers.delete(playerId)
    }
  }

  // Public method to update player position
  updatePlayerPosition(playerId: string, x: number, y: number): void {
    const otherPlayer = this.otherPlayers.get(playerId)
    if (otherPlayer) {
      otherPlayer.player.moveTo(
        x * this.tileSize + this.tileSize / 2,
        y * this.tileSize + this.tileSize / 2
      )
      otherPlayer.lastUpdate = Date.now()
    }
  }
}
