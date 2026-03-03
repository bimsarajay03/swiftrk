/**
 * =============================================================================
 * ORDERS SERVICE - Business Logic & RabbitMQ Communication
 * =============================================================================
 *
 * PURPOSE:
 * This service handles all order-related business logic in the API Gateway.
 * It's the bridge between:
 *   - HTTP Controllers (receiving client requests)
 *   - MongoDB (persisting orders)
 *   - RabbitMQ (communicating with Order Service)
 *   - WebSocket Gateway (real-time updates)
 *
 * KEY RESPONSIBILITIES:
 * 1. Create orders and save to MongoDB
 * 2. Push orders to RabbitMQ for Saga processing
 * 3. Retrieve order status for clients
 * 4. Emit real-time updates via WebSocket
 *
 * RABBITMQ PATTERNS:
 * - emit() = Fire-and-forget (for events like "order_created")
 * - send() = Request-response (for queries like "get_order_status")
 * =============================================================================
 */

import { Injectable, Inject, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ClientProxy } from '@nestjs/microservices';
import { v4 as uuidv4 } from 'uuid';
import { Order, OrderDocument } from './schemas/order.schema';
import { CreateOrderDto } from './dto/create-order.dto';
import { OrdersGateway } from './orders.gateway';

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    @InjectModel(Order.name) private orderModel: Model<OrderDocument>,
    @Inject('ORDER_SERVICE') private orderServiceClient: ClientProxy,
    private ordersGateway: OrdersGateway,
  ) {}

  /**
   * CREATE ORDER
   * ============
   *
   * FLOW:
   * 1. Generate unique order ID
   * 2. Calculate total price from items
   * 3. Save order to MongoDB with PENDING status
   * 4. Emit 'order_created' event to RabbitMQ (fire-and-forget)
   * 5. Order Service picks up the event and starts the Saga
   *
   * WHY EMIT (not SEND)?
   * - We don't need to wait for Saga to complete
   * - Client gets immediate response that order was received
   * - Real-time updates will notify when status changes
   *
   * @param createOrderDto - Validated order data from client
   * @returns Created order object
   */
  async create(createOrderDto: CreateOrderDto): Promise<Order> {
    this.logger.log(
      `Creating new order for customer: ${createOrderDto.customerId}`,
    );

    // Generate a readable order ID (e.g., ORD-2026-550e8400)
    const orderId = `ORD-${new Date().getFullYear()}-${uuidv4().split('-')[0]}`;

    // Calculate total price from items
    const totalPrice = createOrderDto.items.reduce(
      (sum, item) => sum + item.quantity * item.unitPrice,
      0,
    );

    // Create the order document
    const order = new this.orderModel({
      id: orderId,
      customerId: createOrderDto.customerId,
      customerName: createOrderDto.customerName,
      customerEmail: createOrderDto.customerEmail,
      items: createOrderDto.items,
      totalPrice,
      deliveryAddress: createOrderDto.deliveryAddress,
      status: 'PENDING',
      sagaSteps: [],
    });

    // Save to MongoDB
    const savedOrder = await order.save();
    this.logger.log(`Order ${orderId} saved to database`);

    // Emit to RabbitMQ - Order Service will pick this up
    // This is FIRE-AND-FORGET: we don't wait for the Saga to complete
    this.orderServiceClient.emit('order_created', {
      orderId: savedOrder.id,
      customerId: savedOrder.customerId,
      customerName: savedOrder.customerName,
      customerEmail: savedOrder.customerEmail,
      items: savedOrder.items,
      totalPrice: savedOrder.totalPrice,
      deliveryAddress: savedOrder.deliveryAddress,
    });
    this.logger.log(`Order ${orderId} emitted to RabbitMQ queue`);

    // Notify connected WebSocket clients
    this.ordersGateway.emitOrderUpdate(savedOrder.customerId, {
      type: 'ORDER_CREATED',
      order: this.toOrderResponse(savedOrder),
    });

    return savedOrder;
  }

  /**
   * FIND ORDER BY ID
   * ================
   *
   * Retrieves a single order by its custom ID (not MongoDB _id).
   * Used by clients to check order status.
   *
   * @param orderId - The order ID (e.g., "ORD-2026-550e8400")
   * @returns Order object or throws NotFoundException
   */
  async findById(orderId: string): Promise<Order> {
    const order = await this.orderModel.findOne({ id: orderId }).exec();

    if (!order) {
      throw new NotFoundException(`Order ${orderId} not found`);
    }

    return order;
  }

  /**
   * FIND ORDERS BY CUSTOMER ID
   * ==========================
   *
   * Retrieves all orders for a specific customer.
   * Used by the client portal to show order history.
   *
   * PERFORMANCE NOTE:
   * The index on { customerId: 1, createdAt: -1 } ensures fast queries.
   * Orders are sorted newest-first.
   *
   * @param customerId - The customer ID
   * @returns Array of orders
   */
  async findByCustomerId(customerId: string): Promise<Order[]> {
    return this.orderModel.find({ customerId }).sort({ createdAt: -1 }).exec();
  }

  /**
   * FIND ORDERS BY DRIVER ID
   * ========================
   *
   * Retrieves all orders assigned to a specific driver.
   * Used by the driver mobile app to show delivery manifest.
   *
   * @param driverId - The driver ID
   * @param status - Optional status filter (e.g., only 'ASSIGNED' orders)
   * @returns Array of orders
   */
  async findByDriverId(driverId: string, status?: string): Promise<Order[]> {
    const query: any = { driverId };

    if (status) {
      query.status = status;
    }

    return this.orderModel
      .find(query)
      .sort({ estimatedDeliveryTime: 1 })
      .exec();
  }

  /**
   * UPDATE ORDER STATUS
   * ===================
   *
   * Called by Order Service (via RabbitMQ) when Saga steps complete.
   * Updates the order status and emits real-time notification.
   *
   * IMPORTANT: This method is called from the RabbitMQ listener,
   * not directly from HTTP endpoints.
   *
   * @param orderId - The order ID
   * @param status - New status
   * @param additionalData - Extra fields to update (cmsOrderId, wmsPackageId, etc.)
   * @returns Updated order
   */
  async updateStatus(
    orderId: string,
    status: string,
    additionalData?: Partial<Order>,
  ): Promise<Order> {
    this.logger.log(`Updating order ${orderId} status to ${status}`);

    const order = await this.orderModel
      .findOneAndUpdate(
        { id: orderId },
        {
          status,
          ...additionalData,
          updatedAt: new Date(),
        },
        { new: true }, // Return the updated document
      )
      .exec();

    if (!order) {
      throw new NotFoundException(`Order ${orderId} not found`);
    }

    // Emit real-time update to connected clients
    this.ordersGateway.emitOrderUpdate(order.customerId, {
      type: 'STATUS_CHANGED',
      order: this.toOrderResponse(order),
    });

    // Also notify driver if one is assigned
    if (order.driverId) {
      this.ordersGateway.emitDriverUpdate(order.driverId, {
        type: 'STATUS_CHANGED',
        order: this.toOrderResponse(order),
      });
    }

    this.logger.log(`Order ${orderId} status updated and notification sent`);
    return order;
  }

  /**
   * ADD SAGA STEP
   * =============
   *
   * Records a step in the Saga for audit and rollback purposes.
   * Each time CMS/WMS/ROS responds, a step is recorded.
   *
   * EXAMPLE:
   * {
   *   service: 'WMS',
   *   action: 'CHECK_STOCK',
   *   status: 'FAILED',
   *   error: 'OUT_OF_STOCK'
   * }
   *
   * @param orderId - The order ID
   * @param step - The saga step to add
   */
  async addSagaStep(
    orderId: string,
    step: {
      service: 'CMS' | 'WMS' | 'ROS';
      action: string;
      status: 'PENDING' | 'SUCCESS' | 'FAILED' | 'COMPENSATED';
      response?: any;
      error?: string;
    },
  ): Promise<Order> {
    const order = await this.orderModel
      .findOneAndUpdate(
        { id: orderId },
        {
          $push: {
            sagaSteps: {
              ...step,
              timestamp: new Date(),
            },
          },
        },
        { new: true },
      )
      .exec();

    if (!order) {
      throw new NotFoundException(`Order ${orderId} not found`);
    }

    return order;
  }

  /**
   * FIND ALL ORDERS (for admin dashboard)
   * =====================================
   *
   * Retrieves all orders with optional filtering and pagination.
   * Used by admin dashboard to monitor all orders.
   *
   * @param options - Filter and pagination options
   * @returns Array of orders
   */
  async findAll(options?: {
    status?: string;
    limit?: number;
    skip?: number;
  }): Promise<{ orders: Order[]; total: number }> {
    const query: any = {};

    if (options?.status) {
      query.status = options.status;
    }

    const [orders, total] = await Promise.all([
      this.orderModel
        .find(query)
        .sort({ createdAt: -1 })
        .skip(options?.skip || 0)
        .limit(options?.limit || 50)
        .exec(),
      this.orderModel.countDocuments(query).exec(),
    ]);

    return { orders, total };
  }

  /**
   * Helper method to format order response.
   * Removes internal MongoDB fields.
   */
  private toOrderResponse(order: OrderDocument): any {
    return {
      id: order.id,
      customerId: order.customerId,
      customerName: order.customerName,
      customerEmail: order.customerEmail,
      items: order.items,
      totalPrice: order.totalPrice,
      deliveryAddress: order.deliveryAddress,
      status: order.status,
      sagaSteps: order.sagaSteps || [],
      cmsOrderId: order.cmsOrderId,
      wmsPackageId: order.wmsPackageId,
      rosRouteId: order.rosRouteId,
      driverId: order.driverId,
      estimatedDeliveryTime: order.estimatedDeliveryTime,
      deliveryProof: order.deliveryProof,
      createdAt: order.get('createdAt'),
      updatedAt: order.get('updatedAt'),
    };
  }
}
