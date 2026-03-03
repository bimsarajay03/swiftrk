/**
 * =============================================================================
 * SOCKET.IO CLIENT - Real-Time Communication
 * =============================================================================
 *
 * Manages the Socket.io connection to the API Gateway's WebSocket Gateway.
 * Provides a singleton instance that can be shared across the app.
 *
 * CONNECTS TO: API Gateway WebSocket at http://localhost:3000
 *
 * EVENTS:
 *   Emit:   order:subscribe, order:unsubscribe, driver:subscribe
 *   Listen: order:update, driver:update, driver:location
 * =============================================================================
 */

import { io, Socket } from "socket.io-client";

const SOCKET_URL =
  process.env.NEXT_PUBLIC_SOCKET_URL || "http://localhost:3000";

let socket: Socket | null = null;

/**
 * Get or create the Socket.io client instance (singleton).
 * Auto-connects on first call.
 */
export function getSocket(): Socket {
  if (!socket) {
    socket = io(SOCKET_URL, {
      transports: ["websocket", "polling"],
      autoConnect: true,
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
    });

    socket.on("connect", () => {
      console.log("[Socket.io] Connected:", socket?.id);
    });

    socket.on("disconnect", (reason) => {
      console.log("[Socket.io] Disconnected:", reason);
    });

    socket.on("connect_error", (err) => {
      console.warn("[Socket.io] Connection error:", err.message);
    });
  }

  return socket;
}

/**
 * Disconnect and clear the socket instance.
 */
export function disconnectSocket(): void {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}
