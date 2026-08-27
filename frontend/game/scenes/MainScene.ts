import Phaser from 'phaser'
import { Player } from '../sprites/Player'
import { TILE_SIZE, type SceneBridge, type SceneInit, type ScenePlot, type SceneRemotePlayer } from '../types'
import { WORLD, type Facing } from '@/shared/protocol'

/**
 * The farm world.
 *
 * The scene draws whatever plot data it is given and reports player intent
 * back through the bridge. It holds no authority: it never decides that a crop
 * is harvestable, only that the player asked to harvest one. The contract
 * decides, and the result flows back in as new plot data.
 *
 * Plots are keyed by their real land token id. The previous scene invented
 * plot ids from tile coordinates (`tileX * mapWidth + tileY`), which had no
 * relationship to any NFT, so clicking a tile could only ever fail.
 */

const TILE_GRASS = 0
const TILE_DIRT = 1
const TILE_WATER = 2
const TILE_PATH = 3

const TILE_COLORS: Record<number, number> = {
  [TILE_GRASS]: 0x3f5c35,
  [TILE_DIRT]: 0x5c4632,
  [TILE_WATER]: 0x2f5d7c,
  [TILE_PATH]: 0x7a6a52,
}

const MOVE_SPEED = 150 // pixels per second
const NETWORK_TICK_MS = 80

interface PlotVisual {
  container: Phaser.GameObjects.Container
  soil: Phaser.GameObjects.Rectangle
  cropText: Phaser.GameObjects.Text
  progressBg: Phaser.GameObjects.Rectangle
  progressBar: Phaser.GameObjects.Rectangle
  levelPips: Phaser.GameObjects.Graphics
  readyRing: Phaser.GameObjects.Arc
  plot: ScenePlot
}

export class MainScene extends Phaser.Scene {
  private bridge!: SceneBridge
  private playerAddress: string | null = null

  private tileMap: number[][] = []
  private groundLayer!: Phaser.GameObjects.Container
  private plotLayer!: Phaser.GameObjects.Container

  private localPlayer!: Player
  private remotePlayers = new Map<string, Player>()

  private plotVisuals = new Map<string, PlotVisual>()
  private selectedPlotId: string | null = null
  private selectionMarker!: Phaser.GameObjects.Rectangle

  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys
  private wasd!: Record<'W' | 'A' | 'S' | 'D', Phaser.Input.Keyboard.Key>

  private facing: Facing = 'down'
  private lastNetworkSend = 0
  private lastSentX = -1
  private lastSentY = -1

  // Timers and listeners registered here are torn down in shutdown().
  private teardown: Array<() => void> = []

  constructor() {
    super({ key: 'MainScene' })
  }

  init(data: SceneInit): void {
    this.bridge = data.bridge
    this.playerAddress = data.playerAddress
  }

  create(): void {
    this.groundLayer = this.add.container(0, 0).setDepth(0)
    this.plotLayer = this.add.container(0, 0).setDepth(10)

    this.generateWorld()
    this.renderWorld()

    this.selectionMarker = this.add
      .rectangle(0, 0, TILE_SIZE, TILE_SIZE)
      .setStrokeStyle(2, 0x86c06a)
      .setDepth(20)
      .setVisible(false)

    this.createLocalPlayer()
    this.setupInput()
    this.setupCamera()

    // Phaser keeps running after the canvas is destroyed unless every listener
    // is removed; this is where that contract is made explicit.
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.shutdownScene())
    this.events.once(Phaser.Scenes.Events.DESTROY, () => this.shutdownScene())

    this.events.emit('scene-ready')
  }

  // ------------------------------------------------------------------ world

  private generateWorld(): void {
    const { width, height } = WORLD
    this.tileMap = Array.from({ length: height }, () => Array<number>(width).fill(TILE_GRASS))

    // A pond, for orientation and to give the map a landmark.
    for (let y = 4; y < 10; y++) {
      for (let x = 4; x < 12; x++) this.tileMap[y][x] = TILE_WATER
    }

    // Cross paths through the middle.
    const midY = Math.floor(height / 2)
    const midX = Math.floor(width / 2)
    for (let x = 0; x < width; x++) this.tileMap[midY][x] = TILE_PATH
    for (let y = 0; y < height; y++) this.tileMap[y][midX] = TILE_PATH
  }

  private renderWorld(): void {
    const { width, height } = WORLD

    // One texture-less Graphics object for the whole ground, rather than
    // 4096 Rectangle game objects - the difference is a visible frame-rate
    // cliff on a map this size.
    const ground = this.add.graphics()
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const tile = this.tileMap[y][x]
        ground.fillStyle(TILE_COLORS[tile], 1)
        ground.fillRect(x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE)

        // Subtle checker so the grid reads without drawing gridlines.
        if ((x + y) % 2 === 0) {
          ground.fillStyle(0x000000, 0.05)
          ground.fillRect(x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE)
        }
      }
    }
    this.groundLayer.add(ground)
  }

  private isBlocked(tileX: number, tileY: number): boolean {
    if (tileX < 0 || tileY < 0 || tileX >= WORLD.width || tileY >= WORLD.height) return true
    return this.tileMap[tileY][tileX] === TILE_WATER
  }

  // ----------------------------------------------------------------- player

  private createLocalPlayer(): void {
    const startX = Math.floor(WORLD.width / 2) * TILE_SIZE + TILE_SIZE / 2
    const startY = (Math.floor(WORLD.height / 2) + 2) * TILE_SIZE + TILE_SIZE / 2
    const label = this.playerAddress
      ? `${this.playerAddress.slice(0, 6)}…${this.playerAddress.slice(-4)}`
      : 'You'

    this.localPlayer = new Player(this, startX, startY, label, true)
  }

  private setupInput(): void {
    const keyboard = this.input.keyboard
    if (!keyboard) return

    this.cursors = keyboard.createCursorKeys()
    this.wasd = keyboard.addKeys('W,A,S,D') as Record<'W' | 'A' | 'S' | 'D', Phaser.Input.Keyboard.Key>

    // Stop WASD and arrows scrolling the page behind the canvas.
    keyboard.addCapture(['W', 'A', 'S', 'D', 'UP', 'DOWN', 'LEFT', 'RIGHT', 'SPACE'])

    const onPointerDown = (pointer: Phaser.Input.Pointer) => {
      const world = this.cameras.main.getWorldPoint(pointer.x, pointer.y)
      const tileX = Math.floor(world.x / TILE_SIZE)
      const tileY = Math.floor(world.y / TILE_SIZE)
      this.handleTileClick(tileX, tileY)
    }
    this.input.on('pointerdown', onPointerDown)
    this.teardown.push(() => this.input.off('pointerdown', onPointerDown))

    const onWheel = (
      _pointer: Phaser.Input.Pointer,
      _objects: unknown,
      _dx: number,
      dy: number
    ) => {
      const camera = this.cameras.main
      const next = Phaser.Math.Clamp(camera.zoom - dy * 0.001, 0.6, 2.2)
      camera.setZoom(next)
    }
    this.input.on('wheel', onWheel)
    this.teardown.push(() => this.input.off('wheel', onWheel))
  }

  private setupCamera(): void {
    const camera = this.cameras.main
    camera.setBounds(0, 0, WORLD.width * TILE_SIZE, WORLD.height * TILE_SIZE)
    camera.startFollow(this.localPlayer, true, 0.12, 0.12)
    camera.setZoom(1.4)
    camera.setBackgroundColor(0x17140f)
  }

  private handleTileClick(tileX: number, tileY: number): void {
    for (const visual of this.plotVisuals.values()) {
      if (visual.plot.x === tileX && visual.plot.y === tileY) {
        const isReady = visual.plot.crop !== null && this.bridge.now() >= visual.plot.crop.harvestAt
        if (isReady) {
          this.bridge.onHarvestRequested(visual.plot.tokenId)
        } else {
          const next = this.selectedPlotId === visual.plot.tokenId ? null : visual.plot.tokenId
          this.setSelectedPlot(next)
          this.bridge.onPlotSelected(next)
        }
        return
      }
    }
    // Clicking bare ground clears the selection.
    this.setSelectedPlot(null)
    this.bridge.onPlotSelected(null)
  }

  // ------------------------------------------------------------ public API

  /** Replaces the rendered plot set. Called by React whenever chain state changes. */
  syncPlots(plots: ScenePlot[]): void {
    const seen = new Set<string>()

    for (const plot of plots) {
      seen.add(plot.tokenId)
      const existing = this.plotVisuals.get(plot.tokenId)
      if (existing) {
        this.updatePlotVisual(existing, plot)
      } else {
        this.plotVisuals.set(plot.tokenId, this.createPlotVisual(plot))
      }
    }

    // Remove plots the player no longer owns (sold, or transferred away).
    for (const [tokenId, visual] of this.plotVisuals) {
      if (!seen.has(tokenId)) {
        visual.container.destroy(true)
        this.plotVisuals.delete(tokenId)
        if (this.selectedPlotId === tokenId) this.setSelectedPlot(null)
      }
    }
  }

  /** Replaces the rendered remote players. */
  syncRemotePlayers(players: SceneRemotePlayer[]): void {
    const seen = new Set<string>()

    for (const remote of players) {
      seen.add(remote.id)
      const worldX = remote.x * TILE_SIZE + TILE_SIZE / 2
      const worldY = remote.y * TILE_SIZE + TILE_SIZE / 2

      let sprite = this.remotePlayers.get(remote.id)
      if (!sprite) {
        sprite = new Player(this, worldX, worldY, remote.username, false)
        this.remotePlayers.set(remote.id, sprite)
      }
      sprite.setRemoteTarget(worldX, worldY, remote.facing, remote.moving)
    }

    for (const [id, sprite] of this.remotePlayers) {
      if (!seen.has(id)) {
        sprite.destroy(true)
        this.remotePlayers.delete(id)
      }
    }
  }

  setSelectedPlot(tokenId: string | null): void {
    this.selectedPlotId = tokenId
    if (!tokenId) {
      this.selectionMarker.setVisible(false)
      return
    }
    const visual = this.plotVisuals.get(tokenId)
    if (!visual) {
      this.selectionMarker.setVisible(false)
      return
    }
    this.selectionMarker
      .setPosition(visual.plot.x * TILE_SIZE + TILE_SIZE / 2, visual.plot.y * TILE_SIZE + TILE_SIZE / 2)
      .setVisible(true)
  }

  /** Floating "+120 FGOLD" feedback at a plot. */
  showRewardBurst(tokenId: string, text: string): void {
    const visual = this.plotVisuals.get(tokenId)
    if (!visual) return

    const label = this.add.text(
      visual.plot.x * TILE_SIZE + TILE_SIZE / 2,
      visual.plot.y * TILE_SIZE,
      text,
      {
        fontSize: '13px',
        fontFamily: 'system-ui, sans-serif',
        color: '#e8bd68',
        stroke: '#100e0b',
        strokeThickness: 4,
      }
    )
    label.setOrigin(0.5, 1).setDepth(2000)

    this.tweens.add({
      targets: label,
      y: label.y - 34,
      alpha: 0,
      duration: 1200,
      ease: 'Cubic.easeOut',
      onComplete: () => label.destroy(),
    })
  }

  /** Brief plant animation on a plot. */
  showPlantEffect(tokenId: string): void {
    const visual = this.plotVisuals.get(tokenId)
    if (!visual) return
    this.tweens.add({
      targets: visual.cropText,
      scale: { from: 0.2, to: 1 },
      duration: 320,
      ease: 'Back.easeOut',
    })
  }

  // ------------------------------------------------------------- plot draw

  private createPlotVisual(plot: ScenePlot): PlotVisual {
    const centreX = plot.x * TILE_SIZE + TILE_SIZE / 2
    const centreY = plot.y * TILE_SIZE + TILE_SIZE / 2
    const container = this.add.container(centreX, centreY)

    const soil = this.add.rectangle(0, 0, TILE_SIZE - 2, TILE_SIZE - 2, 0x5c4632)
    soil.setStrokeStyle(1, 0x352c22)

    const readyRing = this.add.circle(0, 0, TILE_SIZE * 0.55)
    readyRing.setStrokeStyle(2, 0x86c06a, 0.9)
    readyRing.setVisible(false)

    const cropText = this.add.text(0, -2, '', {
      fontSize: '18px',
      fontFamily: 'system-ui, sans-serif',
    })
    cropText.setOrigin(0.5, 0.5)

    const progressBg = this.add.rectangle(0, TILE_SIZE / 2 - 5, TILE_SIZE - 8, 3, 0x100e0b, 0.7)
    const progressBar = this.add.rectangle(-(TILE_SIZE - 8) / 2, TILE_SIZE / 2 - 5, 0, 3, 0x86c06a)
    progressBar.setOrigin(0, 0.5)

    const levelPips = this.add.graphics()

    container.add([soil, readyRing, cropText, progressBg, progressBar, levelPips])
    this.plotLayer.add(container)

    const visual: PlotVisual = {
      container, soil, cropText, progressBg, progressBar, levelPips, readyRing, plot,
    }
    this.updatePlotVisual(visual, plot)
    return visual
  }

  private updatePlotVisual(visual: PlotVisual, plot: ScenePlot): void {
    visual.plot = plot

    const centreX = plot.x * TILE_SIZE + TILE_SIZE / 2
    const centreY = plot.y * TILE_SIZE + TILE_SIZE / 2
    visual.container.setPosition(centreX, centreY)

    // Richer soil for a more fertile plot, so value is legible on the map.
    const fertilityTint = Phaser.Display.Color.Interpolate.ColorWithColor(
      new Phaser.Display.Color(0x6b5540),
      new Phaser.Display.Color(0x3d2c1c),
      100,
      Math.min(100, Math.max(0, plot.fertility - 50))
    )
    visual.soil.setFillStyle(
      Phaser.Display.Color.GetColor(fertilityTint.r, fertilityTint.g, fertilityTint.b)
    )

    // Upgrade level as pips along the top edge.
    visual.levelPips.clear()
    if (plot.level > 0) {
      visual.levelPips.fillStyle(0xd9a441, 1)
      const pipCount = Math.min(plot.level, 10)
      const spacing = 2.6
      const startX = -((pipCount - 1) * spacing) / 2
      for (let i = 0; i < pipCount; i++) {
        visual.levelPips.fillCircle(startX + i * spacing, -TILE_SIZE / 2 + 4, 1)
      }
    }

    this.refreshCropState(visual)
  }

  /** Updates growth stage, progress bar and ready state from the clock. */
  private refreshCropState(visual: PlotVisual): void {
    const { plot } = visual
    const now = this.bridge.now()

    if (!plot.crop) {
      visual.cropText.setText('')
      visual.progressBar.width = 0
      visual.progressBg.setVisible(false)
      visual.readyRing.setVisible(false)
      return
    }

    const { plantedAt, harvestAt, emoji, cropEmoji } = plot.crop
    const span = Math.max(1, harvestAt - plantedAt)
    const progress = Phaser.Math.Clamp((now - plantedAt) / span, 0, 1)
    const isReady = now >= harvestAt

    // Four visible growth stages, so a glance tells you roughly how long is
    // left without reading the bar.
    let glyph: string
    let scale: number
    if (isReady) {
      glyph = cropEmoji
      scale = 1
    } else if (progress < 0.34) {
      glyph = '·'
      scale = 0.9
    } else if (progress < 0.67) {
      glyph = emoji
      scale = 0.75
    } else {
      glyph = cropEmoji
      scale = 0.85
    }

    if (visual.cropText.text !== glyph) visual.cropText.setText(glyph)
    visual.cropText.setScale(scale)
    visual.cropText.setAlpha(isReady ? 1 : 0.85)

    visual.progressBg.setVisible(!isReady)
    visual.progressBar.setVisible(!isReady)
    visual.progressBar.width = (TILE_SIZE - 8) * progress

    visual.readyRing.setVisible(isReady)
    if (isReady) {
      // Gentle pulse to draw the eye across the map.
      const pulse = 1 + Math.sin(now * 2) * 0.06
      visual.readyRing.setScale(pulse)
    }
  }

  // ------------------------------------------------------------------ loop

  update(_time: number, delta: number): void {
    this.updateLocalMovement(delta)

    this.localPlayer.update(delta)
    for (const sprite of this.remotePlayers.values()) sprite.update(delta)

    for (const visual of this.plotVisuals.values()) this.refreshCropState(visual)

    if (this.selectedPlotId) this.setSelectedPlot(this.selectedPlotId)
  }

  private updateLocalMovement(delta: number): void {
    if (!this.cursors || !this.wasd) return

    let dx = 0
    let dy = 0
    if (this.cursors.left.isDown || this.wasd.A.isDown) dx -= 1
    if (this.cursors.right.isDown || this.wasd.D.isDown) dx += 1
    if (this.cursors.up.isDown || this.wasd.W.isDown) dy -= 1
    if (this.cursors.down.isDown || this.wasd.S.isDown) dy += 1

    const moving = dx !== 0 || dy !== 0

    if (moving) {
      // Normalise so diagonal movement is not faster than orthogonal.
      const length = Math.hypot(dx, dy)
      dx /= length
      dy /= length

      if (Math.abs(dx) > Math.abs(dy)) this.facing = dx > 0 ? 'right' : 'left'
      else this.facing = dy > 0 ? 'down' : 'up'

      const step = (MOVE_SPEED * delta) / 1000
      const nextX = this.localPlayer.x + dx * step
      const nextY = this.localPlayer.y + dy * step

      // Axis-separated collision, so sliding along an obstacle still works.
      if (!this.isBlocked(Math.floor(nextX / TILE_SIZE), Math.floor(this.localPlayer.y / TILE_SIZE))) {
        this.localPlayer.x = Phaser.Math.Clamp(nextX, TILE_SIZE / 2, WORLD.width * TILE_SIZE - TILE_SIZE / 2)
      }
      if (!this.isBlocked(Math.floor(this.localPlayer.x / TILE_SIZE), Math.floor(nextY / TILE_SIZE))) {
        this.localPlayer.y = Phaser.Math.Clamp(nextY, TILE_SIZE / 2, WORLD.height * TILE_SIZE - TILE_SIZE / 2)
      }
    }

    this.localPlayer.setLocalPosition(this.localPlayer.x, this.localPlayer.y, this.facing, moving)

    // Throttle network updates, and only send when the tile actually changed
    // or the player just stopped - a per-frame stream would swamp the server.
    const now = this.time.now
    if (now - this.lastNetworkSend < NETWORK_TICK_MS) return

    const tileX = Math.floor(this.localPlayer.x / TILE_SIZE)
    const tileY = Math.floor(this.localPlayer.y / TILE_SIZE)
    const changed = tileX !== this.lastSentX || tileY !== this.lastSentY

    if (changed || (!moving && this.lastSentX !== -1)) {
      this.lastNetworkSend = now
      this.lastSentX = tileX
      this.lastSentY = tileY
      this.bridge.onMove(tileX, tileY, this.facing, moving)
    }
  }

  // -------------------------------------------------------------- teardown

  private shutdownScene(): void {
    for (const dispose of this.teardown) dispose()
    this.teardown = []

    for (const sprite of this.remotePlayers.values()) sprite.destroy(true)
    this.remotePlayers.clear()

    for (const visual of this.plotVisuals.values()) visual.container.destroy(true)
    this.plotVisuals.clear()

    this.tweens.killAll()
  }
}
