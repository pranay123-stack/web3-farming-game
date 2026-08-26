import { Player } from '../types';
import { v4 as uuidv4 } from 'uuid';

export class PlayerManager {
  private players: Map<string, Player> = new Map();
  private addressToPlayerId: Map<string, string> = new Map();

  /**
   * Create a new player
   */
  createPlayer(
    socketId: string,
    address: string | null,
    username?: string,
    avatar?: string,
    x: number = 0,
    y: number = 0,
    zone: string = 'spawn'
  ): Player {
    const isGuest = !address;
    const playerId = socketId;

    const player: Player = {
      id: playerId,
      address,
      x,
      y,
      zone,
      avatar: avatar || this.generateDefaultAvatar(),
      isGuest,
      username: username || (isGuest ? `Guest_${playerId.slice(0, 6)}` : `Player_${address?.slice(0, 6)}`),
      joinedAt: new Date(),
    };

    this.players.set(playerId, player);

    if (address) {
      this.addressToPlayerId.set(address, playerId);
    }

    return player;
  }

  /**
   * Get player by ID
   */
  getPlayer(playerId: string): Player | undefined {
    return this.players.get(playerId);
  }

  /**
   * Get player by wallet address
   */
  getPlayerByAddress(address: string): Player | undefined {
    const playerId = this.addressToPlayerId.get(address);
    if (playerId) {
      return this.players.get(playerId);
    }
    return undefined;
  }

  /**
   * Update player position
   */
  updatePlayerPosition(playerId: string, x: number, y: number, zone?: string): Player | undefined {
    const player = this.players.get(playerId);
    if (player) {
      player.x = x;
      player.y = y;
      if (zone) {
        player.zone = zone;
      }
      this.players.set(playerId, player);
      return player;
    }
    return undefined;
  }

  /**
   * Update player zone
   */
  updatePlayerZone(playerId: string, zone: string): Player | undefined {
    const player = this.players.get(playerId);
    if (player) {
      player.zone = zone;
      this.players.set(playerId, player);
      return player;
    }
    return undefined;
  }

  /**
   * Remove player
   */
  removePlayer(playerId: string): Player | undefined {
    const player = this.players.get(playerId);
    if (player) {
      this.players.delete(playerId);
      if (player.address) {
        this.addressToPlayerId.delete(player.address);
      }
      return player;
    }
    return undefined;
  }

  /**
   * Get all players
   */
  getAllPlayers(): Player[] {
    return Array.from(this.players.values());
  }

  /**
   * Get players in a specific zone
   */
  getPlayersInZone(zone: string): Player[] {
    return this.getAllPlayers().filter(player => player.zone === zone);
  }

  /**
   * Get players near a position
   */
  getNearbyPlayers(x: number, y: number, radius: number, excludePlayerId?: string): Player[] {
    return this.getAllPlayers().filter(player => {
      if (excludePlayerId && player.id === excludePlayerId) {
        return false;
      }
      const distance = Math.sqrt(Math.pow(player.x - x, 2) + Math.pow(player.y - y, 2));
      return distance <= radius;
    });
  }

  /**
   * Get player count
   */
  getPlayerCount(): number {
    return this.players.size;
  }

  /**
   * Get player count in zone
   */
  getPlayerCountInZone(zone: string): number {
    return this.getPlayersInZone(zone).length;
  }

  /**
   * Check if player exists
   */
  hasPlayer(playerId: string): boolean {
    return this.players.has(playerId);
  }

  /**
   * Check if address is already connected
   */
  isAddressConnected(address: string): boolean {
    return this.addressToPlayerId.has(address);
  }

  /**
   * Generate a default avatar identifier
   */
  private generateDefaultAvatar(): string {
    const avatars = ['farmer1', 'farmer2', 'farmer3', 'farmer4', 'farmer5'];
    return avatars[Math.floor(Math.random() * avatars.length)];
  }
}

// Singleton instance
export const playerManager = new PlayerManager();
