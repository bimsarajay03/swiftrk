/**
 * =============================================================================
 * ORDER MESSAGE HANDLER - RabbitMQ Event Listener for Order Service
 * =============================================================================
 *
 * PURPOSE:
 * Listens for messages from RabbitMQ and triggers the appropriate saga actions.
 * This is the entry point for order processing in the Order Service.
 *
 * EVENTS HANDLED:
 * - order_created: Starts the saga when API Gateway creates an order
 *
 * EVENT vs MESSAGE PATTERN:
 * - @EventPattern('event_name'): Fire-and-forget (emit from sender)
 * - @MessagePattern('message_name'): Request-response (send from sender)
 *
 * The API Gateway uses emit() to send orders, so we use @EventPattern here.
 * =============================================================================
 */

import { Controller, Logger } from '@nestjs/common';
import { EventPattern, MessagePattern, Payload } from '@nestjs/microservices';
import { SagaOrchestratorService } from './saga-orchestrator.service';

@Controller()
export class OrderMessageHandler {
  private readonly logger = new Logger(OrderMessageHandler.name);

  constructor(private readonly sagaOrchestrator: SagaOrchestratorService) {}

  /**
   * ORDER CREATED EVENT HANDLER
   * ===========================
   *
   * This is triggered when API Gateway emits 'order_created' to RabbitMQ.
   * It's the starting point of the Saga Pattern.
   *
   * PAYLOAD STRUCTURE (from API Gateway):
   * {
   *   orderId: "ORD-2026-abc123",
   *   customerId: "CUST-001",
   *   customerName: "John Doe",
   *   customerEmail: "john@example.com",
   *   items: [...],
   *   totalPrice: 999.99,
   *   deliveryAddress: {...}
   * }
   *
   * WHAT HAPPENS NEXT:
   * 1. SagaOrchestratorService.startSaga() is called
   * 2. Saga executes CMS -> WMS -> ROS sequence
   * 3. If any step fails, compensation is triggered
   * 4. API Gateway is notified of status changes
   */
  @EventPattern('order_created')
  async handleOrderCreated(
    @Payload()
    data: {
      orderId: string;
      customerId: string;
      customerName: string;
      customerEmail: string;
      items: Array<{
        productId: string;
        productName: string;
        quantity: number;
        unitPrice: number;
      }>;
      totalPrice: number;
      deliveryAddress: {
        street: string;
        city: string;
        postalCode: string;
        country: string;
        latitude?: number;
        longitude?: number;
      };
    },
  ): Promise<void> {
    this.logger.log(`Received order_created event for order: ${data.orderId}`);
    this.logger.debug(`Order data: ${JSON.stringify(data)}`);

    try {
      // Start the saga - this handles everything from here
      await this.sagaOrchestrator.startSaga(data);
    } catch (error) {
      this.logger.error(
        `Failed to process order ${data.orderId}: ${error.message}`,
      );
      // The saga orchestrator handles its own error recovery
      // This catch is just for unexpected errors
    }
  }

  /**
   * MANUAL RETRY HANDLER
   * ====================
   *
   * Allows manual retry of a failed saga.
   * This is a MessagePattern (request-response) because we want confirmation.
   *
   * USAGE:
   * Admin or automated process can send 'retry_order_saga' with orderId
   * to retry processing a failed order.
   */
  @MessagePattern('retry_order_saga')
  async handleRetryOrder(
    @Payload() data: { orderId: string },
  ): Promise<{ success: boolean; message: string }> {
    this.logger.log(`Received retry request for order: ${data.orderId}`);

    try {
      // TODO: Implement retry logic
      // 1. Load saga state from database
      // 2. Determine which step failed
      // 3. Resume from failed step or restart saga

      return {
        success: true,
        message: `Retry initiated for order ${data.orderId}`,
      };
    } catch (error) {
      return {
        success: false,
        message: `Failed to retry: ${error.message}`,
      };
    }
  }
}
