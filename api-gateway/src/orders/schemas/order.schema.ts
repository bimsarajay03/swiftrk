/**
 * =============================================================================
 * ORDER SCHEMA - MongoDB Schema Definition
 * =============================================================================
 *
 * PURPOSE:
 * Defines how orders are stored in MongoDB. Uses Mongoose Schema decorators.
 *
 * WHY MONGODB?
 * - Flexible schema allows adding new fields without migrations
 * - Good for storing complex nested objects (items, addresses, saga steps)
 * - Native support for arrays and embedded documents
 * - Easy horizontal scaling for high-volume scenarios (Black Friday)
 *
 * COLLECTION: orders
 * =============================================================================
 */

import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

/**
 * Order Item embedded document.
 * Stored directly within the order document, not as a reference.
 */
@Schema({ _id: false })
export class OrderItem {
  @Prop({ required: true })
  productId: string;

  @Prop({ required: true })
  productName: string;

  @Prop({ required: true })
  quantity: number;

  @Prop({ required: true })
  unitPrice: number;
}

/**
 * Delivery Address embedded document.
 */
@Schema({ _id: false })
export class DeliveryAddress {
  @Prop({ required: true })
  street: string;

  @Prop({ required: true })
  city: string;

  @Prop({ required: true })
  postalCode: string;

  @Prop({ required: true })
  country: string;

  @Prop()
  latitude?: number;

  @Prop()
  longitude?: number;
}

/**
 * Saga Step tracking document.
 * Critical for implementing compensating transactions.
 *
 * EXAMPLE:
 * {
 *   service: 'CMS',
 *   action: 'CREATE_ORDER',
 *   status: 'SUCCESS',
 *   timestamp: '2026-02-07T10:00:00Z',
 *   response: { cmsOrderId: 'CMS-12345' }
 * }
 */
@Schema({ _id: false })
export class SagaStep {
  @Prop({ required: true, enum: ['CMS', 'WMS', 'ROS'] })
  service: string;

  @Prop({ required: true })
  action: string;

  @Prop({
    required: true,
    enum: ['PENDING', 'SUCCESS', 'FAILED', 'COMPENSATED'],
  })
  status: string;

  @Prop({ required: true, default: () => new Date() })
  timestamp: Date;

  @Prop({ type: Object })
  response?: Record<string, any>;

  @Prop()
  error?: string;
}

/**
 * Delivery Proof embedded document.
 * Captures proof of delivery from driver app.
 */
@Schema({ _id: false })
export class DeliveryProof {
  @Prop()
  signature?: string;

  @Prop()
  photoUrl?: string;

  @Prop()
  deliveredAt?: Date;

  @Prop()
  recipientName?: string;
}

/**
 * Main Order Schema.
 * This is the complete order document stored in MongoDB.
 */
@Schema({
  timestamps: true, // Automatically adds createdAt and updatedAt
  collection: 'orders',
})
export class Order {
  /**
   * Custom order ID (e.g., "ORD-2026-0001")
   * We use our own ID instead of MongoDB's _id for readability.
   */
  @Prop({ required: true, unique: true, index: true })
  id: string;

  // =========== Customer Information ===========
  @Prop({ required: true, index: true })
  customerId: string;

  @Prop({ required: true })
  customerName: string;

  @Prop({ required: true })
  customerEmail: string;

  // =========== Order Details ===========
  @Prop({ type: [OrderItem], required: true })
  items: OrderItem[];

  @Prop({ required: true })
  totalPrice: number;

  @Prop({ type: DeliveryAddress, required: true })
  deliveryAddress: DeliveryAddress;

  // =========== Status Tracking ===========
  @Prop({
    required: true,
    enum: [
      'PENDING',
      'CMS_PROCESSING',
      'CMS_CONFIRMED',
      'WMS_PROCESSING',
      'WMS_CONFIRMED',
      'WMS_OUT_OF_STOCK',
      'ROS_PROCESSING',
      'ROS_CONFIRMED',
      'ASSIGNED',
      'IN_TRANSIT',
      'DELIVERED',
      'FAILED',
      'CANCELLED',
    ],
    default: 'PENDING',
    index: true,
  })
  status: string;

  // =========== Saga Tracking ===========
  @Prop({ type: [SagaStep], default: [] })
  sagaSteps: SagaStep[];

  // =========== External System References ===========
  @Prop()
  cmsOrderId?: string;

  @Prop()
  wmsPackageId?: string;

  @Prop()
  rosRouteId?: string;

  // =========== Driver Assignment ===========
  @Prop({ index: true })
  driverId?: string;

  @Prop()
  estimatedDeliveryTime?: Date;

  // =========== Delivery Proof ===========
  @Prop({ type: DeliveryProof })
  deliveryProof?: DeliveryProof;
}

// Create the Mongoose document type
export type OrderDocument = Order & Document;

// Create and export the schema
export const OrderSchema = SchemaFactory.createForClass(Order);

/**
 * Add indexes for common queries.
 * This improves performance when:
 * - Clients view their orders (customerId)
 * - Drivers view their deliveries (driverId)
 * - Dashboard filters by status (status)
 */
OrderSchema.index({ customerId: 1, createdAt: -1 });
OrderSchema.index({ driverId: 1, status: 1 });
OrderSchema.index({ status: 1, createdAt: -1 });
