import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';

/**
 * WebSocket Gateway Configuration
 *
 * @cors - Enable CORS for frontend connections
 * @namespace - Optional namespace for order-related events
 */
@WebSocketGateway({
  cors: {
    origin: '*', // In production, specify your frontend URL
    methods: ['GET', 'POST'],
  },
})
export class OrdersGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(OrdersGateway.name);

  /**
   * The Socket.io Server instance.
   * Used to emit events to connected clients.
   */
  @WebSocketServer()
  server: Server;

  /**
   * Called after the gateway is initialized.
   */
  afterInit(server: Server) {
    this.logger.log('WebSocket Gateway initialized');
  }

  /**
   * Called when a client connects.
   * At this point, client hasn't subscribed to any room yet.
   */
  handleConnection(client: Socket) {
    this.logger.log(`Client connected: ${client.id}`);
  }

  /**
   * Called when a client disconnects.
   * Socket.io automatically removes them from all rooms.
   */
  handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`);
  }

  /**
   * SUBSCRIBE TO ORDER UPDATES
   * ==========================
   *
   * Client sends this to start receiving updates for their orders.
   *
   * MESSAGE FORMAT:
   * {
   *   customerId: "CUST-001"
   * }
   *
   * WHAT HAPPENS:
   * 1. Client joins a "room" named `customer:{customerId}`
   * 2. All future updates for that customer are sent to this room
   * 3. Client receives confirmation
   *
   * FRONTEND EXAMPLE:
   * socket.emit('order:subscribe', { customerId: 'CUST-001' });
   */
  @SubscribeMessage('order:subscribe')
  handleSubscribe(
    @MessageBody() data: { customerId: string },
    @ConnectedSocket() client: Socket,
  ): { success: boolean; message: string } {
    const room = `customer:${data.customerId}`;

    // Join the room for this customer
    client.join(room);

    this.logger.log(`Client ${client.id} subscribed to ${room}`);

    return {
      success: true,
      message: `Subscribed to updates for customer ${data.customerId}`,
    };
  }

  /**
   * UNSUBSCRIBE FROM ORDER UPDATES
   * ==============================
   *
   * Client sends this to stop receiving updates.
   *
   * FRONTEND EXAMPLE:
   * socket.emit('order:unsubscribe', { customerId: 'CUST-001' });
   */
  @SubscribeMessage('order:unsubscribe')
  handleUnsubscribe(
    @MessageBody() data: { customerId: string },
    @ConnectedSocket() client: Socket,
  ): { success: boolean; message: string } {
    const room = `customer:${data.customerId}`;

    // Leave the room
    client.leave(room);

    this.logger.log(`Client ${client.id} unsubscribed from ${room}`);

    return {
      success: true,
      message: `Unsubscribed from updates for customer ${data.customerId}`,
    };
  }

  /**
   * SUBSCRIBE DRIVER TO DELIVERY UPDATES
   * ====================================
   *
   * Driver app sends this to receive route changes and new assignments.
   *
   * FRONTEND EXAMPLE (Driver App):
   * socket.emit('driver:subscribe', { driverId: 'DRV-001' });
   */
  @SubscribeMessage('driver:subscribe')
  handleDriverSubscribe(
    @MessageBody() data: { driverId: string },
    @ConnectedSocket() client: Socket,
  ): { success: boolean; message: string } {
    const room = `driver:${data.driverId}`;

    client.join(room);

    this.logger.log(`Driver ${client.id} subscribed to ${room}`);

    return {
      success: true,
      message: `Subscribed to updates for driver ${data.driverId}`,
    };
  }

  // =========================================================================
  // SERVER-TO-CLIENT EMISSION METHODS
  // These are called by OrdersService when order status changes
  // =========================================================================

  /**
   * EMIT ORDER UPDATE TO CUSTOMER
   * =============================
   *
   * Called by OrdersService when an order status changes.
   * Sends update to all connected clients for that customer.
   *
   * @param customerId - The customer to notify
   * @param data - The update payload
   *
   * EXAMPLE PAYLOAD:
   * {
   *   type: 'STATUS_CHANGED',
   *   order: {
   *     id: 'ORD-2026-abc123',
   *     status: 'WMS_CONFIRMED',
   *     ...
   *   }
   * }
   */
  emitOrderUpdate(customerId: string, data: any): void {
    const room = `customer:${customerId}`;

    this.server.to(room).emit('order:update', data);

    this.logger.log(`Emitted order update to ${room}: ${data.type}`);
  }

  /**
   * EMIT DELIVERY UPDATE TO DRIVER
   * ==============================
   *
   * Notifies driver of route changes or urgent updates.
   *
   * @param driverId - The driver to notify
   * @param data - The update payload
   *
   * EXAMPLE EVENTS:
   * - New high-priority delivery added
   * - Route optimization changed
   * - Customer not available, skip delivery
   */
  emitDriverUpdate(driverId: string, data: any): void {
    const room = `driver:${driverId}`;

    this.server.to(room).emit('driver:update', data);

    this.logger.log(`Emitted driver update to ${room}: ${data.type}`);
  }

  /**
   * BROADCAST TO ALL CLIENTS
   * ========================
   *
   * Sends a message to ALL connected clients.
   * Used for system-wide announcements.
   *
   * @param event - Event name
   * @param data - Payload
   */
  broadcast(event: string, data: any): void {
    this.server.emit(event, data);
    this.logger.log(`Broadcast ${event} to all clients`);
  }
}
