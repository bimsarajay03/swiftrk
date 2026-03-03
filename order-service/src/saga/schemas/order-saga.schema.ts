/**
 * =============================================================================
 * ORDER SCHEMA - MongoDB Schema for Order Service
 * =============================================================================
 *
 * PURPOSE:
 * This is the Order Service's own copy of the Order schema.
 * While API Gateway stores the "master" order, Order Service may
 * need to track additional saga-specific data.
 *
 * NOTE: In a real microservices architecture, each service owns its data.
 * For this assignment, both services share the same MongoDB database
 * for simplicity. In production, they would have separate databases.
 * =============================================================================
 */

import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

/**
 * Saga State - Tracks the current state of the distributed transaction
 */
export type SagaState =
  | 'STARTED' // Saga has begun
  | 'CMS_PENDING' // Waiting for CMS response
  | 'CMS_COMPLETED' // CMS confirmed
  | 'WMS_PENDING' // Waiting for WMS response
  | 'WMS_COMPLETED' // WMS confirmed
  | 'ROS_PENDING' // Waiting for ROS response
  | 'ROS_COMPLETED' // ROS confirmed
  | 'COMPLETED' // All steps successful
  | 'COMPENSATING' // Rolling back
  | 'COMPENSATED' // Rollback complete
  | 'FAILED'; // Saga failed

/**
 * Saga Step Record - Detailed log of each action
 */
@Schema({ _id: false })
export class SagaStepRecord {
  @Prop({ required: true })
  stepName: string;

  @Prop({
    required: true,
    enum: ['PENDING', 'SUCCESS', 'FAILED', 'COMPENSATED'],
  })
  status: string;

  @Prop({ required: true })
  startedAt: Date;

  @Prop()
  completedAt?: Date;

  @Prop({ type: Object })
  request?: Record<string, any>;

  @Prop({ type: Object })
  response?: Record<string, any>;

  @Prop()
  error?: string;
}

/**
 * Order Saga Schema - Tracks the saga for each order
 */
@Schema({ timestamps: true, collection: 'order_sagas' })
export class OrderSaga {
  @Prop({ required: true, unique: true, index: true })
  orderId: string;

  @Prop({ required: true })
  sagaState: string;

  // Order data snapshot (in case we need to retry)
  @Prop({ type: Object, required: true })
  orderData: Record<string, any>;

  // External system IDs (populated as saga progresses)
  @Prop()
  cmsOrderId?: string;

  @Prop()
  wmsPackageId?: string;

  @Prop()
  rosRouteId?: string;

  // Saga execution history
  @Prop({ type: [SagaStepRecord], default: [] })
  steps: SagaStepRecord[];

  // Compensation tracking
  @Prop({ type: [String], default: [] })
  completedSteps: string[]; // Steps that need compensation on failure

  // Error tracking
  @Prop()
  failureReason?: string;
}

export type OrderSagaDocument = OrderSaga & Document;
export const OrderSagaSchema = SchemaFactory.createForClass(OrderSaga);
