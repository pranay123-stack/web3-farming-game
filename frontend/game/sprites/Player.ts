import Phaser from 'phaser'
import type { Facing } from '@/shared/protocol'
import { TILE_SIZE } from '../types'

/**
 * A character on the map.
 *
 * Drawn procedurally rather than from a spritesheet so the game ships with no
 * binary art dependency - the previous build referenced textures that were
 * never in the repository.
 *
 * Remote players interpolate toward their last reported position instead of
 * snapping, so a 10Hz network update still looks like continuous movement.
 */
export class Player extends Phaser.GameObjects.Container {
  private body_: Phaser.GameObjects.Graphics
  private nameLabel: Phaser.GameObjects.Text
  private shadow: Phaser.GameObjects.Ellipse

  private facing: Facing = 'down'
  private moving = false
  private bobPhase = 0

  /** Interpolation target for remote players. */
  private targetX: number | null = null
  private targetY: number | null = null

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    private readonly label: string,
    private readonly isLocal: boolean
  ) {
    super(scene, x, y)

    this.shadow = scene.add.ellipse(0, 12, 20, 8, 0x000000, 0.28)
    this.body_ = scene.add.graphics()
    this.drawBody()

    this.nameLabel = scene.add.text(0, -26, label, {
      fontSize: '10px',
      fontFamily: 'system-ui, sans-serif',
      color: isLocal ? '#a8d68f' : '#b8ae9d',
      stroke: '#100e0b',
      strokeThickness: 3,
    })
    this.nameLabel.setOrigin(0.5, 0.5)

    this.add([this.shadow, this.body_, this.nameLabel])
    this.setSize(TILE_SIZE, TILE_SIZE)
    scene.add.existing(this)

    // Local player renders above remote ones so it is never hidden.
    this.setDepth(isLocal ? 1000 : 900)
  }

  private drawBody(): void {
    const g = this.body_
    g.clear()

    const bodyColor = this.isLocal ? 0x6aa84f : 0x4a9ede
    const skinColor = 0xe8c39e
    const hatColor = this.isLocal ? 0xd9a441 : 0x7d7365

    // Torso
    g.fillStyle(bodyColor, 1)
    g.fillRoundedRect(-7, -4, 14, 16, 3)

    // Head
    g.fillStyle(skinColor, 1)
    g.fillCircle(0, -10, 7)

    // Straw hat
    g.fillStyle(hatColor, 1)
    g.fillEllipse(0, -14, 20, 6)
    g.fillRoundedRect(-5, -19, 10, 6, 2)

    // Eyes, drawn on the facing side so direction reads at a glance.
    g.fillStyle(0x100e0b, 1)
    if (this.facing === 'down') {
      g.fillCircle(-2.5, -10, 1.2)
      g.fillCircle(2.5, -10, 1.2)
    } else if (this.facing === 'left') {
      g.fillCircle(-3.5, -10, 1.2)
    } else if (this.facing === 'right') {
      g.fillCircle(3.5, -10, 1.2)
    }
    // Facing up shows the back of the head - no eyes.
  }

  /** Sets the authoritative position for a locally controlled player. */
  setLocalPosition(x: number, y: number, facing: Facing, moving: boolean): void {
    this.setPosition(x, y)
    this.updateFacing(facing, moving)
  }

  /** Sets the interpolation target for a remote player. */
  setRemoteTarget(x: number, y: number, facing: Facing, moving: boolean): void {
    this.targetX = x
    this.targetY = y
    this.updateFacing(facing, moving)
  }

  private updateFacing(facing: Facing, moving: boolean): void {
    if (this.facing !== facing) {
      this.facing = facing
      this.drawBody()
    }
    this.moving = moving
  }

  update(delta: number): void {
    // Ease remote players toward their last known position.
    if (this.targetX !== null && this.targetY !== null) {
      const lerp = Math.min(1, delta / 120)
      this.x += (this.targetX - this.x) * lerp
      this.y += (this.targetY - this.y) * lerp

      if (Math.abs(this.targetX - this.x) < 0.5 && Math.abs(this.targetY - this.y) < 0.5) {
        this.x = this.targetX
        this.y = this.targetY
        this.targetX = null
        this.targetY = null
      }
    }

    // A small vertical bob while walking; the label stays still so it does not
    // jitter and become hard to read.
    if (this.moving) {
      this.bobPhase += delta * 0.012
      this.body_.y = Math.sin(this.bobPhase) * 1.5
    } else {
      this.bobPhase = 0
      this.body_.y = 0
    }
  }

  setLabel(text: string): void {
    this.nameLabel.setText(text)
  }

  destroy(fromScene?: boolean): void {
    this.body_.destroy()
    this.nameLabel.destroy()
    this.shadow.destroy()
    super.destroy(fromScene)
  }
}
