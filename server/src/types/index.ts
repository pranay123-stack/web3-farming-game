// Player interface representing a connected player
export interface Player {
  id: string;
  address: string | null; // null for guests
  x: number;
  y: number;
  zone: string;
  avatar: string;
  isGuest: boolean;
  username: string;
  joinedAt: Date;
}

// Zone interface for map division
export interface Zone {
  id: string;
  name: string;
  bounds: {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
  };
  maxPlayers: number;
}

// Chat message interface
export interface ChatMessage {
  id: string;
  senderId: string;
  senderName: string;
  content: string;
  timestamp: Date;
  type: 'global' | 'nearby' | 'system';
  zone?: string;
}

// Game action types
export type GameActionType = 'plant' | 'harvest' | 'water' | 'fertilize';

// Game action interface
export interface GameAction {
  type: GameActionType;
  playerId: string;
  targetX: number;
  targetY: number;
  data?: Record<string, unknown>;
}

// Socket event payloads
export interface PlayerJoinPayload {
  address?: string;
  username?: string;
  avatar?: string;
  x?: number;
  y?: number;
  zone?: string;
}

export interface PlayerMovePayload {
  x: number;
  y: number;
  zone?: string;
}

export interface ChatMessagePayload {
  content: string;
  type: 'global' | 'nearby';
}

export interface GameActionPayload {
  type: GameActionType;
  targetX: number;
  targetY: number;
  data?: Record<string, unknown>;
}

// Server to client events
export interface ServerToClientEvents {
  'player:joined': (player: Player) => void;
  'player:left': (playerId: string) => void;
  'player:moved': (data: { playerId: string; x: number; y: number; zone: string }) => void;
  'chat:receive': (message: ChatMessage) => void;
  'sync:players': (players: Player[]) => void;
  'game:action': (action: GameAction & { timestamp: Date }) => void;
  'zone:changed': (data: { playerId: string; oldZone: string; newZone: string }) => void;
  'error': (message: string) => void;
}

// Client to server events
export interface ClientToServerEvents {
  'player:join': (payload: PlayerJoinPayload, callback: (response: { success: boolean; player?: Player; error?: string }) => void) => void;
  'player:move': (payload: PlayerMovePayload) => void;
  'player:leave': () => void;
  'chat:message': (payload: ChatMessagePayload) => void;
  'game:action': (payload: GameActionPayload) => void;
  'sync:players': (zone: string | undefined, callback: (players: Player[]) => void) => void;
}

// Inter-server events (for scaling)
export interface InterServerEvents {
  ping: () => void;
}

// Socket data
export interface SocketData {
  playerId: string;
  address: string | null;
}
