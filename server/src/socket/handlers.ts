import { Server, Socket } from 'socket.io';
import { v4 as uuidv4 } from 'uuid';
import {
  Player,
  ChatMessage,
  PlayerJoinPayload,
  PlayerMovePayload,
  ChatMessagePayload,
  GameActionPayload,
  ServerToClientEvents,
  ClientToServerEvents,
  InterServerEvents,
  SocketData,
} from '../types';
import { CLIENT_EVENTS, SERVER_EVENTS } from './events';
import { playerManager } from '../game/PlayerManager';
import { zoneManager } from '../game/ZoneManager';

// Nearby chat radius (in game units)
const NEARBY_CHAT_RADIUS = 50;

type GameSocket = Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;
type GameServer = Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;

/**
 * Register all socket event handlers
 */
export function registerSocketHandlers(io: GameServer): void {
  io.on('connection', (socket: GameSocket) => {
    console.log(`[Socket] New connection: ${socket.id}`);

    // Handle player join
    socket.on(CLIENT_EVENTS.PLAYER_JOIN, (payload: PlayerJoinPayload, callback) => {
      handlePlayerJoin(io, socket, payload, callback);
    });

    // Handle player move
    socket.on(CLIENT_EVENTS.PLAYER_MOVE, (payload: PlayerMovePayload) => {
      handlePlayerMove(io, socket, payload);
    });

    // Handle player leave
    socket.on(CLIENT_EVENTS.PLAYER_LEAVE, () => {
      handlePlayerLeave(io, socket);
    });

    // Handle chat message
    socket.on(CLIENT_EVENTS.CHAT_MESSAGE, (payload: ChatMessagePayload) => {
      handleChatMessage(io, socket, payload);
    });

    // Handle game action
    socket.on(CLIENT_EVENTS.GAME_ACTION, (payload: GameActionPayload) => {
      handleGameAction(io, socket, payload);
    });

    // Handle sync players request
    socket.on(CLIENT_EVENTS.SYNC_PLAYERS, (zone: string | undefined, callback) => {
      handleSyncPlayers(socket, zone, callback);
    });

    // Handle disconnect
    socket.on('disconnect', () => {
      handleDisconnect(io, socket);
    });
  });
}

/**
 * Handle player join event
 */
function handlePlayerJoin(
  io: GameServer,
  socket: GameSocket,
  payload: PlayerJoinPayload,
  callback: (response: { success: boolean; player?: Player; error?: string }) => void
): void {
  try {
    const { address, username, avatar, x = 50, y = 50, zone = 'spawn' } = payload;

    // Check if address is already connected (for non-guests)
    if (address && playerManager.isAddressConnected(address)) {
      callback({ success: false, error: 'Address already connected' });
      return;
    }

    // Create the player
    const player = playerManager.createPlayer(socket.id, address || null, username, avatar, x, y, zone);

    // Store player data in socket
    socket.data.playerId = player.id;
    socket.data.address = player.address;

    // Join the zone room
    socket.join(`zone:${player.zone}`);

    // Broadcast to other players in the zone
    socket.to(`zone:${player.zone}`).emit(SERVER_EVENTS.PLAYER_JOINED, player);

    // Send system message
    const joinMessage: ChatMessage = {
      id: uuidv4(),
      senderId: 'system',
      senderName: 'System',
      content: `${player.username} has joined the game!`,
      timestamp: new Date(),
      type: 'system',
      zone: player.zone,
    };
    io.to(`zone:${player.zone}`).emit(SERVER_EVENTS.CHAT_RECEIVE, joinMessage);

    console.log(`[Player] ${player.username} (${player.id}) joined zone ${player.zone}`);

    callback({ success: true, player });
  } catch (error) {
    console.error('[Error] Failed to handle player join:', error);
    callback({ success: false, error: 'Failed to join game' });
  }
}

/**
 * Handle player move event
 */
function handlePlayerMove(
  io: GameServer,
  socket: GameSocket,
  payload: PlayerMovePayload
): void {
  const playerId = socket.data.playerId;
  if (!playerId) return;

  const player = playerManager.getPlayer(playerId);
  if (!player) return;

  const { x, y } = payload;
  const oldZone = player.zone;

  // Determine new zone based on position
  const newZone = payload.zone || zoneManager.getZoneIdForPosition(x, y);

  // Update player position
  playerManager.updatePlayerPosition(playerId, x, y, newZone);

  // Check for zone change
  if (oldZone !== newZone) {
    // Leave old zone room
    socket.leave(`zone:${oldZone}`);
    // Join new zone room
    socket.join(`zone:${newZone}`);

    // Broadcast zone change
    io.to(`zone:${oldZone}`).to(`zone:${newZone}`).emit(SERVER_EVENTS.ZONE_CHANGED, {
      playerId,
      oldZone,
      newZone,
    });

    console.log(`[Player] ${player.username} moved from ${oldZone} to ${newZone}`);
  }

  // Broadcast movement to players in both zones (for smooth transitions)
  const moveData = { playerId, x, y, zone: newZone };
  socket.to(`zone:${oldZone}`).emit(SERVER_EVENTS.PLAYER_MOVED, moveData);
  if (oldZone !== newZone) {
    socket.to(`zone:${newZone}`).emit(SERVER_EVENTS.PLAYER_MOVED, moveData);
  }
}

/**
 * Handle player leave event
 */
function handlePlayerLeave(io: GameServer, socket: GameSocket): void {
  const playerId = socket.data.playerId;
  if (!playerId) return;

  const player = playerManager.getPlayer(playerId);
  if (!player) return;

  // Remove player
  playerManager.removePlayer(playerId);

  // Leave zone room
  socket.leave(`zone:${player.zone}`);

  // Broadcast to zone
  socket.to(`zone:${player.zone}`).emit(SERVER_EVENTS.PLAYER_LEFT, playerId);

  // Send system message
  const leaveMessage: ChatMessage = {
    id: uuidv4(),
    senderId: 'system',
    senderName: 'System',
    content: `${player.username} has left the game.`,
    timestamp: new Date(),
    type: 'system',
    zone: player.zone,
  };
  io.to(`zone:${player.zone}`).emit(SERVER_EVENTS.CHAT_RECEIVE, leaveMessage);

  console.log(`[Player] ${player.username} (${playerId}) left the game`);
}

/**
 * Handle chat message event
 */
function handleChatMessage(
  io: GameServer,
  socket: GameSocket,
  payload: ChatMessagePayload
): void {
  const playerId = socket.data.playerId;
  if (!playerId) return;

  const player = playerManager.getPlayer(playerId);
  if (!player) return;

  const { content, type } = payload;

  // Validate message content
  if (!content || content.trim().length === 0) return;
  if (content.length > 500) return; // Max message length

  const message: ChatMessage = {
    id: uuidv4(),
    senderId: playerId,
    senderName: player.username,
    content: content.trim(),
    timestamp: new Date(),
    type,
    zone: player.zone,
  };

  if (type === 'global') {
    // Broadcast to everyone
    io.emit(SERVER_EVENTS.CHAT_RECEIVE, message);
  } else if (type === 'nearby') {
    // Get nearby players and send to them
    const nearbyPlayers = playerManager.getNearbyPlayers(player.x, player.y, NEARBY_CHAT_RADIUS);

    // Include the sender
    nearbyPlayers.push(player);

    // Send to each nearby player
    nearbyPlayers.forEach(nearbyPlayer => {
      io.to(nearbyPlayer.id).emit(SERVER_EVENTS.CHAT_RECEIVE, message);
    });
  }

  console.log(`[Chat] ${player.username} (${type}): ${content}`);
}

/**
 * Handle game action event
 */
function handleGameAction(
  io: GameServer,
  socket: GameSocket,
  payload: GameActionPayload
): void {
  const playerId = socket.data.playerId;
  if (!playerId) return;

  const player = playerManager.getPlayer(playerId);
  if (!player) return;

  // Guests cannot perform game actions
  if (player.isGuest) {
    socket.emit(SERVER_EVENTS.ERROR, 'Guests cannot perform game actions. Please connect your wallet.');
    return;
  }

  const { type, targetX, targetY, data } = payload;

  // Validate action type
  const validActions = ['plant', 'harvest', 'water', 'fertilize'];
  if (!validActions.includes(type)) {
    socket.emit(SERVER_EVENTS.ERROR, 'Invalid action type');
    return;
  }

  // Create action event
  const action = {
    type,
    playerId,
    targetX,
    targetY,
    data,
    timestamp: new Date(),
  };

  // Broadcast action to players in the same zone
  io.to(`zone:${player.zone}`).emit(SERVER_EVENTS.GAME_ACTION, action);

  console.log(`[Action] ${player.username} performed ${type} at (${targetX}, ${targetY})`);
}

/**
 * Handle sync players request
 */
function handleSyncPlayers(
  socket: GameSocket,
  zone: string | undefined,
  callback: (players: Player[]) => void
): void {
  let players: Player[];

  if (zone) {
    players = playerManager.getPlayersInZone(zone);
  } else {
    // If no zone specified, get players from the requesting player's zone
    const playerId = socket.data.playerId;
    if (playerId) {
      const player = playerManager.getPlayer(playerId);
      if (player) {
        players = playerManager.getPlayersInZone(player.zone);
      } else {
        players = playerManager.getAllPlayers();
      }
    } else {
      players = playerManager.getAllPlayers();
    }
  }

  callback(players);
}

/**
 * Handle socket disconnect
 */
function handleDisconnect(io: GameServer, socket: GameSocket): void {
  const playerId = socket.data.playerId;

  if (playerId) {
    const player = playerManager.getPlayer(playerId);

    if (player) {
      // Remove player
      playerManager.removePlayer(playerId);

      // Broadcast to zone
      socket.to(`zone:${player.zone}`).emit(SERVER_EVENTS.PLAYER_LEFT, playerId);

      // Send system message
      const disconnectMessage: ChatMessage = {
        id: uuidv4(),
        senderId: 'system',
        senderName: 'System',
        content: `${player.username} has disconnected.`,
        timestamp: new Date(),
        type: 'system',
        zone: player.zone,
      };
      io.to(`zone:${player.zone}`).emit(SERVER_EVENTS.CHAT_RECEIVE, disconnectMessage);

      console.log(`[Socket] ${player.username} (${socket.id}) disconnected`);
    }
  } else {
    console.log(`[Socket] Anonymous connection ${socket.id} disconnected`);
  }
}
