import Phaser from 'phaser'

export interface PlayerConfig {
  scene: Phaser.Scene
  x: number
  y: number
  texture: string
  frame?: number
  playerId: string
  isLocalPlayer: boolean
  username?: string
}

export class Player extends Phaser.GameObjects.Container {
  public playerId: string
  public isLocalPlayer: boolean
  public username: string
  public sprite: Phaser.GameObjects.Rectangle
  public nameText: Phaser.GameObjects.Text
  public directionIndicator: Phaser.GameObjects.Triangle

  private moveSpeed: number = 150
  private targetX: number
  private targetY: number
  private isMoving: boolean = false
  private facingDirection: 'up' | 'down' | 'left' | 'right' = 'down'

  // Animation properties
  private bobAmount: number = 2
  private bobSpeed: number = 8
  private bobTimer: number = 0

  constructor(config: PlayerConfig) {
    super(config.scene, config.x, config.y)

    this.playerId = config.playerId
    this.isLocalPlayer = config.isLocalPlayer
    this.username = config.username || this.formatAddress(config.playerId)
    this.targetX = config.x
    this.targetY = config.y

    // Create pixel art style player sprite (rectangle body)
    const bodyColor = this.isLocalPlayer ? 0x4ade80 : 0x60a5fa
    this.sprite = config.scene.add.rectangle(0, 0, 24, 28, bodyColor)
    this.sprite.setStrokeStyle(2, 0x1e293b)
    this.add(this.sprite)

    // Add head
    const headColor = 0xfcd34d
    const head = config.scene.add.rectangle(0, -12, 16, 14, headColor)
    head.setStrokeStyle(2, 0x1e293b)
    this.add(head)

    // Add eyes
    const eyeColor = 0x1e293b
    const leftEye = config.scene.add.rectangle(-4, -14, 4, 4, eyeColor)
    const rightEye = config.scene.add.rectangle(4, -14, 4, 4, eyeColor)
    this.add(leftEye)
    this.add(rightEye)

    // Add direction indicator (small triangle showing facing direction)
    this.directionIndicator = config.scene.add.triangle(0, 20, 0, -6, -5, 3, 5, 3, 0xfbbf24)
    this.directionIndicator.setAlpha(0.8)
    this.add(this.directionIndicator)

    // Add username label
    this.nameText = config.scene.add.text(0, -35, this.username, {
      fontSize: '10px',
      fontFamily: 'monospace',
      color: this.isLocalPlayer ? '#4ade80' : '#60a5fa',
      stroke: '#0f172a',
      strokeThickness: 3,
    })
    this.nameText.setOrigin(0.5, 0.5)
    this.add(this.nameText)

    // Add local player indicator
    if (this.isLocalPlayer) {
      const indicator = config.scene.add.circle(0, -45, 4, 0x4ade80)
      this.add(indicator)

      // Pulse animation for local player indicator
      config.scene.tweens.add({
        targets: indicator,
        alpha: 0.3,
        duration: 800,
        yoyo: true,
        repeat: -1,
      })
    }

    // Add to scene
    config.scene.add.existing(this)

    // Set depth for proper layering
    this.setDepth(10)
  }

  private formatAddress(address: string): string {
    if (!address || address.length < 10) return 'Player'
    return `${address.slice(0, 4)}...${address.slice(-4)}`
  }

  update(time: number, delta: number): void {
    // Bob animation while moving
    if (this.isMoving) {
      this.bobTimer += delta * 0.001 * this.bobSpeed
      const bobOffset = Math.sin(this.bobTimer * Math.PI) * this.bobAmount
      this.sprite.y = bobOffset
    } else {
      this.bobTimer = 0
      this.sprite.y = 0
    }

    // Smooth movement towards target
    if (this.isMoving) {
      const dx = this.targetX - this.x
      const dy = this.targetY - this.y
      const distance = Math.sqrt(dx * dx + dy * dy)

      if (distance < 2) {
        this.x = this.targetX
        this.y = this.targetY
        this.isMoving = false
      } else {
        const moveAmount = (this.moveSpeed * delta) / 1000
        const ratio = moveAmount / distance
        this.x += dx * ratio
        this.y += dy * ratio
      }
    }

    // Update direction indicator rotation
    this.updateDirectionIndicator()
  }

  private updateDirectionIndicator(): void {
    switch (this.facingDirection) {
      case 'up':
        this.directionIndicator.setRotation(Math.PI)
        this.directionIndicator.setPosition(0, -20)
        break
      case 'down':
        this.directionIndicator.setRotation(0)
        this.directionIndicator.setPosition(0, 20)
        break
      case 'left':
        this.directionIndicator.setRotation(Math.PI / 2)
        this.directionIndicator.setPosition(-18, 0)
        break
      case 'right':
        this.directionIndicator.setRotation(-Math.PI / 2)
        this.directionIndicator.setPosition(18, 0)
        break
    }
  }

  moveTo(x: number, y: number): void {
    // Determine facing direction based on movement
    const dx = x - this.x
    const dy = y - this.y

    if (Math.abs(dx) > Math.abs(dy)) {
      this.facingDirection = dx > 0 ? 'right' : 'left'
    } else {
      this.facingDirection = dy > 0 ? 'down' : 'up'
    }

    this.targetX = x
    this.targetY = y
    this.isMoving = true
  }

  moveByTile(dx: number, dy: number, tileSize: number): void {
    // Update facing direction
    if (dx !== 0) {
      this.facingDirection = dx > 0 ? 'right' : 'left'
    } else if (dy !== 0) {
      this.facingDirection = dy > 0 ? 'down' : 'up'
    }

    this.targetX = this.x + dx * tileSize
    this.targetY = this.y + dy * tileSize
    this.isMoving = true
  }

  setTilePosition(tileX: number, tileY: number, tileSize: number): void {
    const newX = tileX * tileSize + tileSize / 2
    const newY = tileY * tileSize + tileSize / 2
    this.x = newX
    this.y = newY
    this.targetX = newX
    this.targetY = newY
  }

  getTilePosition(tileSize: number): { x: number; y: number } {
    return {
      x: Math.floor(this.x / tileSize),
      y: Math.floor(this.y / tileSize),
    }
  }

  setDirection(direction: 'up' | 'down' | 'left' | 'right'): void {
    this.facingDirection = direction
    this.updateDirectionIndicator()
  }

  getDirection(): 'up' | 'down' | 'left' | 'right' {
    return this.facingDirection
  }

  isCurrentlyMoving(): boolean {
    return this.isMoving
  }

  setUsername(username: string): void {
    this.username = username
    this.nameText.setText(username)
  }

  highlight(enabled: boolean): void {
    if (enabled) {
      this.sprite.setStrokeStyle(3, 0xfbbf24)
    } else {
      this.sprite.setStrokeStyle(2, 0x1e293b)
    }
  }

  destroy(fromScene?: boolean): void {
    super.destroy(fromScene)
  }
}
