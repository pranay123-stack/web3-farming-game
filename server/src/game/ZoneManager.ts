import { Zone } from '../types';

export class ZoneManager {
  private zones: Map<string, Zone> = new Map();

  constructor() {
    this.initializeDefaultZones();
  }

  /**
   * Initialize default game zones
   */
  private initializeDefaultZones(): void {
    const defaultZones: Zone[] = [
      {
        id: 'spawn',
        name: 'Spawn Area',
        bounds: { minX: 0, maxX: 100, minY: 0, maxY: 100 },
        maxPlayers: 50,
      },
      {
        id: 'farm-north',
        name: 'Northern Farm',
        bounds: { minX: 0, maxX: 200, minY: 100, maxY: 300 },
        maxPlayers: 30,
      },
      {
        id: 'farm-south',
        name: 'Southern Farm',
        bounds: { minX: 0, maxX: 200, minY: -200, maxY: 0 },
        maxPlayers: 30,
      },
      {
        id: 'farm-east',
        name: 'Eastern Farm',
        bounds: { minX: 100, maxX: 300, minY: 0, maxY: 200 },
        maxPlayers: 30,
      },
      {
        id: 'farm-west',
        name: 'Western Farm',
        bounds: { minX: -200, maxX: 0, minY: 0, maxY: 200 },
        maxPlayers: 30,
      },
      {
        id: 'market',
        name: 'Market Square',
        bounds: { minX: -50, maxX: 50, minY: -50, maxY: 50 },
        maxPlayers: 100,
      },
      {
        id: 'forest',
        name: 'Mystic Forest',
        bounds: { minX: 200, maxX: 400, minY: 200, maxY: 400 },
        maxPlayers: 20,
      },
    ];

    defaultZones.forEach(zone => {
      this.zones.set(zone.id, zone);
    });
  }

  /**
   * Get zone by ID
   */
  getZone(zoneId: string): Zone | undefined {
    return this.zones.get(zoneId);
  }

  /**
   * Get all zones
   */
  getAllZones(): Zone[] {
    return Array.from(this.zones.values());
  }

  /**
   * Add a new zone
   */
  addZone(zone: Zone): void {
    this.zones.set(zone.id, zone);
  }

  /**
   * Remove a zone
   */
  removeZone(zoneId: string): boolean {
    return this.zones.delete(zoneId);
  }

  /**
   * Check if a position is within a zone
   */
  isPositionInZone(x: number, y: number, zoneId: string): boolean {
    const zone = this.zones.get(zoneId);
    if (!zone) return false;

    return (
      x >= zone.bounds.minX &&
      x <= zone.bounds.maxX &&
      y >= zone.bounds.minY &&
      y <= zone.bounds.maxY
    );
  }

  /**
   * Get the zone for a given position
   */
  getZoneForPosition(x: number, y: number): Zone | undefined {
    for (const zone of this.zones.values()) {
      if (
        x >= zone.bounds.minX &&
        x <= zone.bounds.maxX &&
        y >= zone.bounds.minY &&
        y <= zone.bounds.maxY
      ) {
        return zone;
      }
    }
    return undefined;
  }

  /**
   * Get the zone ID for a given position
   */
  getZoneIdForPosition(x: number, y: number): string {
    const zone = this.getZoneForPosition(x, y);
    return zone?.id || 'spawn';
  }

  /**
   * Check if zone exists
   */
  hasZone(zoneId: string): boolean {
    return this.zones.has(zoneId);
  }

  /**
   * Get zone count
   */
  getZoneCount(): number {
    return this.zones.size;
  }

  /**
   * Check if zone is at capacity
   */
  isZoneAtCapacity(zoneId: string, currentPlayerCount: number): boolean {
    const zone = this.zones.get(zoneId);
    if (!zone) return true;
    return currentPlayerCount >= zone.maxPlayers;
  }

  /**
   * Get adjacent zones
   */
  getAdjacentZones(zoneId: string): Zone[] {
    const zone = this.zones.get(zoneId);
    if (!zone) return [];

    const adjacent: Zone[] = [];

    for (const otherZone of this.zones.values()) {
      if (otherZone.id === zoneId) continue;

      // Check if zones share a border or overlap
      const horizontalOverlap =
        zone.bounds.minX <= otherZone.bounds.maxX &&
        zone.bounds.maxX >= otherZone.bounds.minX;

      const verticalOverlap =
        zone.bounds.minY <= otherZone.bounds.maxY &&
        zone.bounds.maxY >= otherZone.bounds.minY;

      // Zones are adjacent if they overlap on one axis and touch on another
      const horizontalTouch =
        zone.bounds.maxX === otherZone.bounds.minX ||
        zone.bounds.minX === otherZone.bounds.maxX;

      const verticalTouch =
        zone.bounds.maxY === otherZone.bounds.minY ||
        zone.bounds.minY === otherZone.bounds.maxY;

      if ((horizontalOverlap && verticalTouch) || (verticalOverlap && horizontalTouch)) {
        adjacent.push(otherZone);
      }
    }

    return adjacent;
  }
}

// Singleton instance
export const zoneManager = new ZoneManager();
