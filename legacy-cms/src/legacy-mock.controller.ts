/**
 * =============================================================================
 * LEGACY ADAPTER CONTROLLER
 * =============================================================================
 *
 * Handles all RabbitMQ message patterns from the Saga Orchestrator and hands
 * each one to the adapter for its legacy system:
 *
 *   cms_*  -> CmsSoapAdapter  (SOAP/XML over HTTP)
 *   wms_*  -> WmsTcpAdapter   (proprietary framed TCP)
 *   ros_*  -> RosRestAdapter  (REST/JSON over HTTP)
 *
 * The adapters translate the canonical JSON into each native protocol and the
 * native reply back, so the saga never sees SOAP, frames or HTTP statuses.
 * Adapters never throw: failures come back as { success: false, error }.
 *
 * NestJS's @MessagePattern decorator handles the request-response pattern
 * automatically — the return value is sent back as the reply.
 * =============================================================================
 */

import { Controller, Logger } from '@nestjs/common';
import {
  MessagePattern,
  Payload,
  Ctx,
  RmqContext,
} from '@nestjs/microservices';
import { CmsSoapAdapter } from './adapters/cms-soap.adapter';
import { WmsTcpAdapter } from './adapters/wms-tcp.adapter';
import { RosRestAdapter } from './adapters/ros-rest.adapter';
import type {
  BaseReply,
  CmsCancelOrderCommand,
  CmsCreateOrderCommand,
  RosCancelRouteCommand,
  RosOptimizeRouteCommand,
  WmsCheckStockCommand,
  WmsReleaseStockCommand,
  WmsReserveStockCommand,
} from './adapters/commands';

@Controller()
export class LegacyMockController {
  private readonly logger = new Logger(LegacyMockController.name);

  constructor(
    private readonly cms: CmsSoapAdapter,
    private readonly wms: WmsTcpAdapter,
    private readonly ros: RosRestAdapter,
  ) {}

  /**
   * MANUAL ACKNOWLEDGEMENT
   * ======================
   *
   * These consumers connect with `noAck: false` (see main.ts) so a message is
   * only dropped from the queue once it has been handled. Each handler acks
   * after its adapter call has finished (success or translated failure), so a
   * crash mid-call leaves the message on the queue for redelivery. That is safe
   * because the legacy systems treat a repeated orderId idempotently.
   */
  private ack(context: RmqContext): void {
    if (!context) return;

    try {
      const channel = context.getChannelRef();
      const message = context.getMessage();

      if (channel && message) {
        channel.ack(message);
      }
    } catch (error) {
      this.logger.error(`Failed to ack message: ${error.message}`);
    }
  }

  /** Runs an adapter call, logs the outcome and acks whatever happens. */
  private async handle<T extends BaseReply>(
    label: string,
    context: RmqContext,
    call: () => Promise<T>,
  ): Promise<T> {
    try {
      const reply = await call();
      if (reply.success) {
        this.logger.log(`${label}: ${reply.message}`);
      } else {
        this.logger.warn(`${label}: ${reply.error} ${reply.message}`);
      }
      return reply;
    } finally {
      this.ack(context);
    }
  }

  // =========================================================================
  // CMS - Client Management System (SOAP/XML)
  // =========================================================================

  @MessagePattern('cms_create_order')
  handleCmsCreateOrder(
    @Payload() data: CmsCreateOrderCommand,
    @Ctx() context: RmqContext,
  ) {
    return this.handle(`[CMS] CreateOrder ${data.orderId}`, context, () =>
      this.cms.createOrder(data),
    );
  }

  @MessagePattern('cms_cancel_order')
  handleCmsCancelOrder(
    @Payload() data: CmsCancelOrderCommand,
    @Ctx() context: RmqContext,
  ) {
    return this.handle(
      `[CMS] CancelOrder ${data.orderId} (${data.cmsOrderId})`,
      context,
      () => this.cms.cancelOrder(data),
    );
  }

  // =========================================================================
  // WMS - Warehouse Management System (proprietary TCP)
  // =========================================================================

  @MessagePattern('wms_check_stock')
  handleWmsCheckStock(
    @Payload() data: WmsCheckStockCommand,
    @Ctx() context: RmqContext,
  ) {
    return this.handle(`[WMS] CHK ${data.orderId}`, context, () =>
      this.wms.checkStock(data),
    );
  }

  @MessagePattern('wms_reserve_stock')
  handleWmsReserveStock(
    @Payload() data: WmsReserveStockCommand,
    @Ctx() context: RmqContext,
  ) {
    return this.handle(`[WMS] RSV ${data.orderId}`, context, () =>
      this.wms.reserveStock(data),
    );
  }

  @MessagePattern('wms_release_stock')
  handleWmsReleaseStock(
    @Payload() data: WmsReleaseStockCommand,
    @Ctx() context: RmqContext,
  ) {
    return this.handle(
      `[WMS] REL ${data.orderId} (${data.wmsPackageId})`,
      context,
      () => this.wms.releaseStock(data),
    );
  }

  // =========================================================================
  // ROS - Route Optimization System (REST/JSON)
  // =========================================================================

  @MessagePattern('ros_optimize_route')
  handleRosOptimizeRoute(
    @Payload() data: RosOptimizeRouteCommand,
    @Ctx() context: RmqContext,
  ) {
    return this.handle(`[ROS] POST /routes ${data.orderId}`, context, () =>
      this.ros.optimizeRoute(data),
    );
  }

  @MessagePattern('ros_cancel_route')
  handleRosCancelRoute(
    @Payload() data: RosCancelRouteCommand,
    @Ctx() context: RmqContext,
  ) {
    return this.handle(
      `[ROS] DELETE /routes/${data.rosRouteId} (${data.orderId})`,
      context,
      () => this.ros.cancelRoute(data),
    );
  }
}
