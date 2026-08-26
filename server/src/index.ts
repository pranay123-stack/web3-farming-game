import express, { Request, Response } from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';
import {
  ServerToClientEvents,
  ClientToServerEvents,
  InterServerEvents,
  SocketData,
} from './types';
import { registerSocketHandlers } from './socket/handlers';
import { playerManager } from './game/PlayerManager';
import { zoneManager } from './game/ZoneManager';

// Load environment variables
dotenv.config();

// Configuration
const PORT = process.env.PORT || 3001;
const ALLOWED_ORIGINS = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  /\.vercel\.app$/,
  /\.vercel\.com$/,
];

// Initialize Express app
const app = express();

// CORS configuration
app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (like mobile apps or curl requests)
      if (!origin) {
        callback(null, true);
        return;
      }

      // Check against allowed origins
      const isAllowed = ALLOWED_ORIGINS.some(allowed => {
        if (typeof allowed === 'string') {
          return origin === allowed;
        }
        return allowed.test(origin);
      });

      if (isAllowed) {
        callback(null, true);
      } else {
        console.warn(`[CORS] Blocked origin: ${origin}`);
        callback(new Error('Not allowed by CORS'));
      }
    },
    credentials: true,
  })
);

// Parse JSON bodies
app.use(express.json());

// Create HTTP server
const httpServer = createServer(app);

// Initialize Socket.IO with CORS
const io = new Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>(
  httpServer,
  {
    cors: {
      origin: (origin, callback) => {
        if (!origin) {
          callback(null, true);
          return;
        }

        const isAllowed = ALLOWED_ORIGINS.some(allowed => {
          if (typeof allowed === 'string') {
            return origin === allowed;
          }
          return allowed.test(origin);
        });

        callback(null, isAllowed);
      },
      credentials: true,
    },
    pingTimeout: 60000,
    pingInterval: 25000,
  }
);

// Register socket handlers
registerSocketHandlers(io);

// Health check endpoint
app.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    players: playerManager.getPlayerCount(),
    zones: zoneManager.getZoneCount(),
  });
});

// Get server stats
app.get('/stats', (_req: Request, res: Response) => {
  const zones = zoneManager.getAllZones();
  const zoneStats = zones.map(zone => ({
    id: zone.id,
    name: zone.name,
    playerCount: playerManager.getPlayerCountInZone(zone.id),
    maxPlayers: zone.maxPlayers,
  }));

  res.json({
    totalPlayers: playerManager.getPlayerCount(),
    zones: zoneStats,
    uptime: process.uptime(),
  });
});

// Get players endpoint (for debugging/admin)
app.get('/players', (_req: Request, res: Response) => {
  const players = playerManager.getAllPlayers();
  res.json({
    count: players.length,
    players: players.map(p => ({
      id: p.id,
      username: p.username,
      zone: p.zone,
      isGuest: p.isGuest,
      position: { x: p.x, y: p.y },
    })),
  });
});

// Get zones endpoint
app.get('/zones', (_req: Request, res: Response) => {
  const zones = zoneManager.getAllZones();
  res.json({
    count: zones.length,
    zones,
  });
});

// 404 handler
app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: 'Not found' });
});

// Error handler
app.use((err: Error, _req: Request, res: Response) => {
  console.error('[Error]', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
httpServer.listen(PORT, () => {
  console.log('='.repeat(50));
  console.log(`GameFi Farming Server`);
  console.log('='.repeat(50));
  console.log(`Server running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
  console.log(`Stats: http://localhost:${PORT}/stats`);
  console.log(`Players: http://localhost:${PORT}/players`);
  console.log(`Zones: http://localhost:${PORT}/zones`);
  console.log('='.repeat(50));
  console.log('Allowed origins:');
  ALLOWED_ORIGINS.forEach(origin => {
    console.log(`  - ${origin}`);
  });
  console.log('='.repeat(50));
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('[Server] SIGTERM received, shutting down gracefully');
  httpServer.close(() => {
    console.log('[Server] Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('[Server] SIGINT received, shutting down gracefully');
  httpServer.close(() => {
    console.log('[Server] Server closed');
    process.exit(0);
  });
});

export { app, httpServer, io };
