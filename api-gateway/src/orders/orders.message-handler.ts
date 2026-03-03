import { Controller, Logger } from '@nestjs/common';
import { EventPattern, Payload, Ctx, RmqContext } from '@nestjs/microservices';
import { OrdersService } from './orders.service';
import { OrdersGateway } from './orders.gateway';

@Controller()
export class OrdersMessageHandler {
  private readonly logger = new Logger(OrdersMessageHandler.name);

  constructor(
    private readonly ordersService: OrdersService,
    private readonly ordersGateway: OrdersGateway,
  ) {}

  @EventPattern('order_status_updated')
  async handleOrderStatusUpdate(
    @Payload()
    data: {
      orderId: string;
      status: string;
      cmsOrderId?: string;
      wmsPackageId?: string;
      rosRouteId?: string;
      driverId?: string;
      estimatedDeliveryTime?: string;
      sagaStep?: {
        service: 'CMS' | 'WMS' | 'ROS';
        action: string;
        status: 'PENDING' | 'SUCCESS' | 'FAILED' | 'COMPENSATED';
        response?: any;
        error?: string;
      };
    },
    @Ctx() context: RmqContext,
  ) {
    this.logger.log(
      `Received order_status_updated for ${data.orderId}: ${data.status}`,
    );

    try {
      // Build additional data object with only defined values
      const additionalData: any = {};

      if (data.cmsOrderId) additionalData.cmsOrderId = data.cmsOrderId;
      if (data.wmsPackageId) additionalData.wmsPackageId = data.wmsPackageId;
      if (data.rosRouteId) additionalData.rosRouteId = data.rosRouteId;
      if (data.driverId) additionalData.driverId = data.driverId;
      if (data.estimatedDeliveryTime) {
        additionalData.estimatedDeliveryTime = new Date(
          data.estimatedDeliveryTime,
        );
      }

      // Update order status in MongoDB
      const order = await this.ordersService.updateStatus(
        data.orderId,
        data.status,
        additionalData,
      );

      // Add saga step if provided
      if (data.sagaStep) {
        await this.ordersService.addSagaStep(data.orderId, data.sagaStep);
      }

      this.logger.log(`Order ${data.orderId} updated successfully`);
    } catch (error) {
      this.logger.error(
        `Failed to update order ${data.orderId}: ${error.message}`,
      );
    }
  }

  @EventPattern('delivery_completed')
  async handleDeliveryCompleted(
    @Payload()
    data: {
      orderId: string;
      driverId: string;
      deliveryProof?: {
        signature?: string;
        photoUrl?: string;
        recipientName?: string;
      };
    },
  ) {
    this.logger.log(`Received delivery_completed for ${data.orderId}`);

    try {
      const order = await this.ordersService.updateStatus(
        data.orderId,
        'DELIVERED',
        {
          deliveryProof: {
            ...data.deliveryProof,
            deliveredAt: new Date(),
          },
        } as any,
      );

      // Add saga step for delivery
      await this.ordersService.addSagaStep(data.orderId, {
        service: 'ROS', // Delivery is part of ROS workflow
        action: 'DELIVERY_COMPLETED',
        status: 'SUCCESS',
        response: { driverId: data.driverId },
      });

      this.logger.log(`Delivery for order ${data.orderId} marked as complete`);
    } catch (error) {
      this.logger.error(`Failed to mark delivery complete: ${error.message}`);
    }
  }

  @EventPattern('saga_compensation_triggered')
  async handleSagaCompensation(
    @Payload()
    data: {
      orderId: string;
      reason: string;
      compensatedSteps: string[];
    },
  ) {
    this.logger.log(`Received saga_compensation_triggered for ${data.orderId}`);

    try {
      // Update status to FAILED
      await this.ordersService.updateStatus(data.orderId, 'FAILED', {});

      // Record compensation in saga steps
      for (const step of data.compensatedSteps) {
        // Parse step name to extract service (e.g., "CMS_CANCELLED" -> "CMS")
        const service = step.split('_')[0] as 'CMS' | 'WMS' | 'ROS';

        await this.ordersService.addSagaStep(data.orderId, {
          service,
          action: step,
          status: 'COMPENSATED',
          error: data.reason,
        });
      }

      this.logger.log(
        `Order ${data.orderId} marked as FAILED with compensations`,
      );
    } catch (error) {
      this.logger.error(`Failed to handle saga compensation: ${error.message}`);
    }
  }

  @EventPattern('driver_assigned')
  async handleDriverAssigned(
    @Payload()
    data: {
      orderId: string;
      driverId: string;
      driverName: string;
      estimatedDeliveryTime: string;
    },
  ) {
    this.logger.log(`Received driver_assigned for ${data.orderId}`);

    try {
      const order = await this.ordersService.updateStatus(
        data.orderId,
        'ASSIGNED',
        {
          driverId: data.driverId,
          estimatedDeliveryTime: new Date(data.estimatedDeliveryTime),
        },
      );

      // Notify driver about new assignment
      this.ordersGateway.emitDriverUpdate(data.driverId, {
        type: 'NEW_ASSIGNMENT',
        order: {
          orderId: data.orderId,
          deliveryAddress: order.deliveryAddress,
          customerName: order.customerName,
          estimatedDeliveryTime: data.estimatedDeliveryTime,
        },
      });

      this.logger.log(
        `Driver ${data.driverId} assigned to order ${data.orderId}`,
      );
    } catch (error) {
      this.logger.error(`Failed to assign driver: ${error.message}`);
    }
  }
}
