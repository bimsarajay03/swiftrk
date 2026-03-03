/**
 * =============================================================================
 * SAGA ORCHESTRATOR SERVICE - The Heart of the Saga Pattern
 * =============================================================================
 *
 * PURPOSE:
 * This is the core implementation of the Saga Pattern for SwiftTrack.
 * It orchestrates the distributed transaction across CMS, WMS, and ROS.
 *
 * WHAT IS THE SAGA PATTERN?
 * =========================
 * A saga is a sequence of local transactions where each step has a
 * compensating action (rollback) that can undo its effect if a later
 * step fails.
 *
 * SWIFTTRACK SAGA FLOW:
 *
 *   1. ORDER CREATED
 *          |
 *          v
 *   2. CMS_CREATE_ORDER -----> [CMS Mock] (SOAP/XML)
 *          |                       |
 *          |<-------- OK ----------+
 *          v
 *   3. WMS_CHECK_STOCK ------> [WMS Mock] (TCP)
 *          |                       |
 *          |<------ OK/FAIL ------+
 *          |
 *          +-- if FAIL --> COMPENSATE: CMS_CANCEL_ORDER
 *          |
 *          v (if OK)
 *   4. ROS_OPTIMIZE_ROUTE ---> [ROS Mock] (REST/JSON)
 *          |                       |
 *          |<-------- OK ----------+
 *          v
 *   5. SAGA COMPLETE
 *
 * COMPENSATION (ROLLBACK) FLOW:
 * If WMS returns OUT_OF_STOCK:
 *   1. Mark WMS step as FAILED
 *   2. Send CMS_CANCEL_ORDER (compensating transaction)
 *   3. Mark saga as FAILED
 *   4. Notify API Gateway
 *
 * WHY ORCHESTRATION (not Choreography)?
 * - Centralized control makes debugging easier
 * - Clear visibility of saga state
 * - Easier to implement compensating transactions
 * - Better suited for complex business logic
 * =============================================================================
 */

import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ClientProxy } from '@nestjs/microservices';
import { Inject } from '@nestjs/common';
import { firstValueFrom, timeout, catchError, of } from 'rxjs';
import { OrderSaga, OrderSagaDocument } from './schemas/order-saga.schema';

/**
 * Order data structure received from API Gateway
 */
interface OrderData {
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
}

@Injectable()
export class SagaOrchestratorService {
  private readonly logger = new Logger(SagaOrchestratorService.name);

  constructor(
    @InjectModel(OrderSaga.name) private sagaModel: Model<OrderSagaDocument>,
    @Inject('CMS_SERVICE') private cmsClient: ClientProxy,
    @Inject('WMS_SERVICE') private wmsClient: ClientProxy,
    @Inject('ROS_SERVICE') private rosClient: ClientProxy,
    @Inject('API_GATEWAY') private apiGatewayClient: ClientProxy,
  ) {}

  /**
   * START SAGA
   * ==========
   *
   * Initiates the saga when a new order is created.
   * This is called when 'order_created' event is received from API Gateway.
   *
   * STEPS:
   * 1. Create saga record in MongoDB
   * 2. Execute Step 1: Create order in CMS
   * 3. Execute Step 2: Check stock in WMS
   * 4. Execute Step 3: Optimize route in ROS
   * 5. Mark saga as complete (or failed with compensation)
   *
   * @param orderData - Order data from API Gateway
   */
  async startSaga(orderData: OrderData): Promise<void> {
    this.logger.log(`Starting saga for order: ${orderData.orderId}`);

    // Create saga record
    const saga = new this.sagaModel({
      orderId: orderData.orderId,
      sagaState: 'STARTED',
      orderData,
      steps: [],
      completedSteps: [],
    });
    await saga.save();

    try {
      // ========== STEP 1: CMS - Create Order ==========
      this.logger.log(`[${orderData.orderId}] Step 1: Creating order in CMS`);
      await this.updateSagaState(orderData.orderId, 'CMS_PENDING');

      const cmsResult = await this.executeCmsCreateOrder(orderData);

      if (!cmsResult.success) {
        throw new Error(`CMS failed: ${cmsResult.error}`);
      }

      await this.recordStepSuccess(
        orderData.orderId,
        'CMS_CREATE_ORDER',
        cmsResult,
      );
      await this.updateSagaState(orderData.orderId, 'CMS_COMPLETED', {
        cmsOrderId: cmsResult.cmsOrderId,
      });

      // Notify API Gateway of progress
      this.notifyStatusUpdate(orderData.orderId, 'CMS_CONFIRMED', {
        cmsOrderId: cmsResult.cmsOrderId,
        sagaStep: {
          service: 'CMS',
          action: 'CREATE_ORDER',
          status: 'SUCCESS',
        },
      });

      // ========== STEP 2: WMS - Check Stock ==========
      this.logger.log(`[${orderData.orderId}] Step 2: Checking stock in WMS`);
      await this.updateSagaState(orderData.orderId, 'WMS_PENDING');

      const wmsResult = await this.executeWmsCheckStock(orderData);

      if (!wmsResult.success || !wmsResult.inStock) {
        // COMPENSATION NEEDED: WMS failed or out of stock
        this.logger.warn(
          `[${orderData.orderId}] WMS failed: ${wmsResult.error || 'OUT_OF_STOCK'}`,
        );
        await this.recordStepFailure(
          orderData.orderId,
          'WMS_CHECK_STOCK',
          wmsResult.error || 'OUT_OF_STOCK',
        );
        await this.compensate(orderData.orderId, 'WMS_OUT_OF_STOCK');
        return;
      }

      await this.recordStepSuccess(
        orderData.orderId,
        'WMS_CHECK_STOCK',
        wmsResult,
      );
      await this.updateSagaState(orderData.orderId, 'WMS_COMPLETED', {
        wmsPackageId: wmsResult.wmsPackageId,
      });

      // Notify API Gateway of progress
      this.notifyStatusUpdate(orderData.orderId, 'WMS_CONFIRMED', {
        wmsPackageId: wmsResult.wmsPackageId,
        sagaStep: {
          service: 'WMS',
          action: 'CHECK_STOCK',
          status: 'SUCCESS',
        },
      });

      // ========== STEP 3: ROS - Optimize Route ==========
      this.logger.log(`[${orderData.orderId}] Step 3: Optimizing route in ROS`);
      await this.updateSagaState(orderData.orderId, 'ROS_PENDING');

      const rosResult = await this.executeRosOptimizeRoute(orderData);

      if (!rosResult.success) {
        // COMPENSATION NEEDED: ROS failed
        this.logger.warn(
          `[${orderData.orderId}] ROS failed: ${rosResult.error}`,
        );
        await this.recordStepFailure(
          orderData.orderId,
          'ROS_OPTIMIZE_ROUTE',
          rosResult.error || 'Unknown error',
        );
        await this.compensate(orderData.orderId, 'ROS_FAILED');
        return;
      }

      await this.recordStepSuccess(
        orderData.orderId,
        'ROS_OPTIMIZE_ROUTE',
        rosResult,
      );
      await this.updateSagaState(orderData.orderId, 'ROS_COMPLETED', {
        rosRouteId: rosResult.rosRouteId,
      });

      // ========== SAGA COMPLETE ==========
      this.logger.log(`[${orderData.orderId}] Saga completed successfully!`);
      await this.updateSagaState(orderData.orderId, 'COMPLETED');

      // Final notification to API Gateway
      this.notifyStatusUpdate(orderData.orderId, 'ROS_CONFIRMED', {
        rosRouteId: rosResult.rosRouteId,
        estimatedDeliveryTime: rosResult.estimatedDeliveryTime,
        driverId: 'DRV-001',
        sagaStep: {
          service: 'ROS',
          action: 'OPTIMIZE_ROUTE',
          status: 'SUCCESS',
        },
      });
    } catch (error) {
      this.logger.error(
        `[${orderData.orderId}] Saga failed with error: ${error.message}`,
      );
      await this.compensate(orderData.orderId, error.message);
    }
  }

  /**
   * EXECUTE CMS CREATE ORDER
   * ========================
   *
   * Sends order to CMS Mock via RabbitMQ.
   * CMS expects SOAP/XML but we send JSON - Member 2's adapter will convert it.
   *
   * Uses send() for request-response pattern (we need the cmsOrderId back).
   */
  private async executeCmsCreateOrder(orderData: OrderData): Promise<{
    success: boolean;
    cmsOrderId?: string;
    error?: string;
  }> {
    try {
      const response = await firstValueFrom(
        this.cmsClient
          .send('cms_create_order', {
            orderId: orderData.orderId,
            customerId: orderData.customerId,
            customerName: orderData.customerName,
            customerEmail: orderData.customerEmail,
            items: orderData.items,
            totalPrice: orderData.totalPrice,
          })
          .pipe(
            timeout(30000), // 30 second timeout
            catchError((err) => of({ success: false, error: err.message })),
          ),
      );

      // Track this step for potential compensation
      if (response.success) {
        await this.addCompletedStep(orderData.orderId, 'CMS_CREATE_ORDER');
      }

      return response;
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * EXECUTE WMS CHECK STOCK
   * =======================
   *
   * Sends stock check request to WMS Mock via RabbitMQ.
   * WMS uses proprietary TCP protocol - Member 2's adapter handles that.
   *
   * CRITICAL: If this returns inStock: false, we must compensate!
   */
  private async executeWmsCheckStock(orderData: OrderData): Promise<{
    success: boolean;
    inStock: boolean;
    wmsPackageId?: string;
    error?: string;
  }> {
    try {
      const response = await firstValueFrom(
        this.wmsClient
          .send('wms_check_stock', {
            orderId: orderData.orderId,
            items: orderData.items.map((item) => ({
              productId: item.productId,
              quantity: item.quantity,
            })),
          })
          .pipe(
            timeout(30000),
            catchError((err) =>
              of({ success: false, inStock: false, error: err.message }),
            ),
          ),
      );

      // Track this step for potential compensation
      if (response.success && response.inStock) {
        await this.addCompletedStep(orderData.orderId, 'WMS_RESERVE_STOCK');
      }

      return response;
    } catch (error) {
      return { success: false, inStock: false, error: error.message };
    }
  }

  /**
   * EXECUTE ROS OPTIMIZE ROUTE
   * ==========================
   *
   * Sends route optimization request to ROS Mock via RabbitMQ.
   * ROS is a REST API - Member 2's adapter calls it.
   */
  private async executeRosOptimizeRoute(orderData: OrderData): Promise<{
    success: boolean;
    rosRouteId?: string;
    estimatedDeliveryTime?: string;
    error?: string;
  }> {
    try {
      const response = await firstValueFrom(
        this.rosClient
          .send('ros_optimize_route', {
            orderId: orderData.orderId,
            deliveryAddress: orderData.deliveryAddress,
            items: orderData.items,
          })
          .pipe(
            timeout(30000),
            catchError((err) => of({ success: false, error: err.message })),
          ),
      );

      // Track this step for potential compensation
      if (response.success) {
        await this.addCompletedStep(orderData.orderId, 'ROS_OPTIMIZE_ROUTE');
      }

      return response;
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * COMPENSATE - ROLLBACK SAGA
   * ==========================
   *
   * This is the heart of the Saga Pattern's failure handling.
   * When a step fails, we must undo all previously completed steps.
   *
   * COMPENSATION ORDER (reverse of execution):
   * 1. If ROS was completed -> Cancel route
   * 2. If WMS was completed -> Release stock
   * 3. If CMS was completed -> Cancel order
   *
   * @param orderId - The order ID
   * @param reason - Why compensation was triggered
   */
  private async compensate(orderId: string, reason: string): Promise<void> {
    this.logger.warn(`[${orderId}] Starting compensation. Reason: ${reason}`);

    await this.updateSagaState(orderId, 'COMPENSATING', {
      failureReason: reason,
    });

    const saga = await this.sagaModel.findOne({ orderId }).exec();
    const completedSteps = saga?.completedSteps || [];
    const compensatedSteps: string[] = [];

    // Compensate in reverse order
    if (completedSteps.includes('ROS_OPTIMIZE_ROUTE')) {
      this.logger.log(`[${orderId}] Compensating: Cancelling route in ROS`);
      await this.executeRosCancelRoute(orderId, saga?.rosRouteId);
      compensatedSteps.push('ROS_CANCELLED');
    }

    if (completedSteps.includes('WMS_RESERVE_STOCK')) {
      this.logger.log(`[${orderId}] Compensating: Releasing stock in WMS`);
      await this.executeWmsReleaseStock(orderId, saga?.wmsPackageId);
      compensatedSteps.push('WMS_STOCK_RELEASED');
    }

    if (completedSteps.includes('CMS_CREATE_ORDER')) {
      this.logger.log(`[${orderId}] Compensating: Cancelling order in CMS`);
      await this.executeCmsCancelOrder(orderId, saga?.cmsOrderId);
      compensatedSteps.push('CMS_CANCELLED');
    }

    // Mark saga as compensated (failed)
    await this.updateSagaState(orderId, 'FAILED');

    // Notify API Gateway about the failure
    this.apiGatewayClient.emit('saga_compensation_triggered', {
      orderId,
      reason,
      compensatedSteps,
    });

    // Also update order status
    this.notifyStatusUpdate(orderId, 'FAILED');

    this.logger.log(
      `[${orderId}] Compensation completed. Steps rolled back: ${compensatedSteps.join(', ')}`,
    );
  }

  /**
   * COMPENSATING TRANSACTION: Cancel CMS Order
   */
  private async executeCmsCancelOrder(
    orderId: string,
    cmsOrderId?: string,
  ): Promise<void> {
    try {
      await firstValueFrom(
        this.cmsClient.send('cms_cancel_order', { orderId, cmsOrderId }).pipe(
          timeout(30000),
          catchError((err) => {
            this.logger.error(`Failed to cancel CMS order: ${err.message}`);
            return of({ success: false });
          }),
        ),
      );
      await this.recordStepSuccess(orderId, 'CMS_CANCEL_ORDER', {
        compensated: true,
      });
    } catch (error) {
      this.logger.error(`CMS compensation failed: ${error.message}`);
    }
  }

  /**
   * COMPENSATING TRANSACTION: Release WMS Stock
   */
  private async executeWmsReleaseStock(
    orderId: string,
    wmsPackageId?: string,
  ): Promise<void> {
    try {
      await firstValueFrom(
        this.wmsClient
          .send('wms_release_stock', { orderId, wmsPackageId })
          .pipe(
            timeout(30000),
            catchError((err) => {
              this.logger.error(`Failed to release WMS stock: ${err.message}`);
              return of({ success: false });
            }),
          ),
      );
      await this.recordStepSuccess(orderId, 'WMS_RELEASE_STOCK', {
        compensated: true,
      });
    } catch (error) {
      this.logger.error(`WMS compensation failed: ${error.message}`);
    }
  }

  /**
   * COMPENSATING TRANSACTION: Cancel ROS Route
   */
  private async executeRosCancelRoute(
    orderId: string,
    rosRouteId?: string,
  ): Promise<void> {
    try {
      await firstValueFrom(
        this.rosClient.send('ros_cancel_route', { orderId, rosRouteId }).pipe(
          timeout(30000),
          catchError((err) => {
            this.logger.error(`Failed to cancel ROS route: ${err.message}`);
            return of({ success: false });
          }),
        ),
      );
      await this.recordStepSuccess(orderId, 'ROS_CANCEL_ROUTE', {
        compensated: true,
      });
    } catch (error) {
      this.logger.error(`ROS compensation failed: ${error.message}`);
    }
  }

  // =========================================================================
  // HELPER METHODS
  // =========================================================================

  /**
   * Update saga state in database
   */
  private async updateSagaState(
    orderId: string,
    state: string,
    additionalData?: Partial<OrderSaga>,
  ): Promise<void> {
    await this.sagaModel
      .updateOne({ orderId }, { sagaState: state, ...additionalData })
      .exec();
  }

  /**
   * Add a step to the completed steps list (for compensation tracking)
   */
  private async addCompletedStep(
    orderId: string,
    stepName: string,
  ): Promise<void> {
    await this.sagaModel
      .updateOne({ orderId }, { $push: { completedSteps: stepName } })
      .exec();
  }

  /**
   * Record successful step execution
   */
  private async recordStepSuccess(
    orderId: string,
    stepName: string,
    response: any,
  ): Promise<void> {
    const step = {
      stepName,
      status: 'SUCCESS',
      startedAt: new Date(),
      completedAt: new Date(),
      response,
    };

    await this.sagaModel
      .updateOne({ orderId }, { $push: { steps: step } })
      .exec();
  }

  /**
   * Record failed step execution
   */
  private async recordStepFailure(
    orderId: string,
    stepName: string,
    error: string,
  ): Promise<void> {
    const step = {
      stepName,
      status: 'FAILED',
      startedAt: new Date(),
      completedAt: new Date(),
      error,
    };

    await this.sagaModel
      .updateOne({ orderId }, { $push: { steps: step } })
      .exec();
  }

  /**
   * Notify API Gateway of status update
   * Uses emit() - fire and forget
   */
  private notifyStatusUpdate(
    orderId: string,
    status: string,
    data?: any,
  ): void {
    this.apiGatewayClient.emit('order_status_updated', {
      orderId,
      status,
      ...data,
    });
  }
}
