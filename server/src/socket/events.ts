// Socket.io event names for the GameFi Farming game

// Client to Server Events
export const CLIENT_EVENTS = {
  // Player events
  PLAYER_JOIN: 'player:join',
  PLAYER_MOVE: 'player:move',
  PLAYER_LEAVE: 'player:leave',

  // Chat events
  CHAT_MESSAGE: 'chat:message',

  // Game events
  GAME_ACTION: 'game:action',

  // Sync events
  SYNC_PLAYERS: 'sync:players',
} as const;

// Server to Client Events
export const SERVER_EVENTS = {
  // Player events
  PLAYER_JOINED: 'player:joined',
  PLAYER_LEFT: 'player:left',
  PLAYER_MOVED: 'player:moved',

  // Chat events
  CHAT_RECEIVE: 'chat:receive',

  // Game events
  GAME_ACTION: 'game:action',

  // Sync events
  SYNC_PLAYERS: 'sync:players',

  // Zone events
  ZONE_CHANGED: 'zone:changed',

  // Error events
  ERROR: 'error',
} as const;

// Type exports for the event names
export type ClientEventName = (typeof CLIENT_EVENTS)[keyof typeof CLIENT_EVENTS];
export type ServerEventName = (typeof SERVER_EVENTS)[keyof typeof SERVER_EVENTS];
