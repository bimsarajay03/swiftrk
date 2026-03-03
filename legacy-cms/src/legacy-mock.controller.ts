/**
 * =============================================================================
 * LEGACY MOCK CONTROLLER
 * =============================================================================
 *
 * Handles all RabbitMQ message patterns from the Saga Orchestrator.
 * Each handler mocks a legacy system and returns the expected response format.
 *
 * NestJS's @MessagePattern decorator handles the request-response pattern
 * automatically — the return value is sent back as the reply.
 * =============================================================================
 */

import { Controller, Logger } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';

@Controller()
export class LegacyMockController {
  private readonly logger = new Logger(LegacyMockController.name);

  // =========================================================================
  // CMS - Client Management System (SOAP/XML mock)
  // =========================================================================

  @MessagePattern('cms_create_order')
  handleCmsCreateOrder(@Payload() data: any) {
    this.logger.log(`[CMS] Creating order: ${data.orderId}`);

    // Simulate SOAP/XML processing delay
    const cmsOrderId = `CMS-${Date.now()}-${Math.floor(Math.random() * 10000)}`;

    this.logger.log(`[CMS] Order created successfully: ${cmsOrderId}`);

    return {
      success: true,
      cmsOrderId,
      message: 'Order created in CMS (SOAP/XML)',
    };
  }

  @MessagePattern('cms_cancel_order')
  handleCmsCancelOrder(@Payload() data: any) {
    this.logger.log(`[CMS] Cancelling order: ${data.orderId} (CMS ID: ${data.cmsOrderId})`);

    return {
      success: true,
      message: 'Order cancelled in CMS (compensating transaction)',
    };
  }

  // =========================================================================
  // WMS - Warehouse Management System (TCP proprietary mock)
  // =========================================================================

  @MessagePattern('wms_check_stock')
  handleWmsCheckStock(@Payload() data: any) {
    this.logger.log(`[WMS] Checking stock for order: ${data.orderId}`);

    // Simulate stock check - 90% chance of in-stock for demo
    const inStock = Math.random() > 0.1;
    const wmsPackageId = inStock
      ? `WMS-PKG-${Math.floor(Math.random() * 10000)}`
      : undefined;

    if (inStock) {
      this.logger.log(`[WMS] Stock confirmed, package: ${wmsPackageId}`);
    } else {
      this.logger.warn(`[WMS] Out of stock for order: ${data.orderId}`);
    }

    return {
      success: inStock,
      inStock,
      wmsPackageId,
      message: inStock ? 'Stock available' : 'Out of stock',
      error: inStock ? undefined : 'OUT_OF_STOCK',
    };
  }

  @MessagePattern('wms_reserve_stock')
  handleWmsReserveStock(@Payload() data: any) {
    this.logger.log(`[WMS] Reserving stock for order: ${data.orderId}`);

    return {
      success: true,
      message: 'Stock reserved in WMS',
    };
  }

  @MessagePattern('wms_release_stock')
  handleWmsReleaseStock(@Payload() data: any) {
    this.logger.log(`[WMS] Releasing stock for order: ${data.orderId} (Package: ${data.wmsPackageId})`);

    return {
      success: true,
      message: 'Stock released in WMS (compensating transaction)',
    };
  }

  // =========================================================================
  // ROS - Route Optimization System (REST API mock)
  // =========================================================================

  @MessagePattern('ros_optimize_route')
  handleRosOptimizeRoute(@Payload() data: any) {
    this.logger.log(`[ROS] Optimizing route for order: ${data.orderId}`);

    const rosRouteId = `ROUTE-${Math.floor(Math.random() * 1000)}`;
    const estimatedDeliveryTime = new Date(
      Date.now() + 45 * 60000,
    ).toISOString();

    this.logger.log(`[ROS] Route optimized: ${rosRouteId}, ETA: ${estimatedDeliveryTime}`);

    return {
      success: true,
      rosRouteId,
      estimatedDeliveryTime,
      optimizedRoute: {
        waypoints: [
          {
            lat: 6.9271,
            lng: 79.8612,
            address: data.deliveryAddress?.street || 'Warehouse',
          },
          {
            lat: data.deliveryAddress?.latitude || 6.93,
            lng: data.deliveryAddress?.longitude || 79.87,
            address: `${data.deliveryAddress?.street || ''}, ${data.deliveryAddress?.city || 'Colombo'}`,
          },
        ],
        totalDistance: Math.floor(Math.random() * 30) + 5,
        totalDuration: Math.floor(Math.random() * 60) + 20,
      },
      message: 'Route optimized via REST API',
    };
  }

  @MessagePattern('ros_cancel_route')
  handleRosCancelRoute(@Payload() data: any) {
    this.logger.log(`[ROS] Cancelling route: ${data.rosRouteId} for order: ${data.orderId}`);

    return {
      success: true,
      message: 'Route cancelled in ROS (compensating transaction)',
    };
  }
}
