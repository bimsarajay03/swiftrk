import {
  Controller,
  Post,
  Get,
  Patch,
  Param,
  Body,
  Query,
  HttpStatus,
  HttpCode,
  Logger,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { OrdersService } from './orders.service';
import { CreateOrderDto } from './dto/create-order.dto';

@Controller('orders')
export class OrdersController {
  private readonly logger = new Logger(OrdersController.name);

  constructor(private readonly ordersService: OrdersService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  async createOrder(@Body() createOrderDto: CreateOrderDto) {
    this.logger.log(
      `POST /orders - Creating order for customer: ${createOrderDto.customerId}`,
    );

    const order = await this.ordersService.create(createOrderDto);

    return {
      success: true,
      message: 'Order created successfully. Processing has begun.',
      order: {
        id: order.id,
        status: order.status,
        totalPrice: order.totalPrice,
        createdAt: (order as any).createdAt || new Date(),
      },
    };
  }

  @Get()
  async listOrders(
    @Query('status') status?: string,
    @Query('limit') limit?: string,
    @Query('skip') skip?: string,
  ) {
    this.logger.log(
      `GET /orders - status=${status}, limit=${limit}, skip=${skip}`,
    );

    const result = await this.ordersService.findAll({
      status,
      limit: limit ? parseInt(limit, 10) : 50,
      skip: skip ? parseInt(skip, 10) : 0,
    });

    return {
      success: true,
      total: result.total,
      orders: result.orders,
    };
  }

  // Static routes MUST come before parametric routes (:id)
  @Get('customer/:customerId')
  async getOrdersByCustomer(@Param('customerId') customerId: string) {
    this.logger.log(`GET /orders/customer/${customerId}`);

    const orders = await this.ordersService.findByCustomerId(customerId);

    return {
      success: true,
      customerId,
      count: orders.length,
      orders,
    };
  }

  @Get('driver/:driverId')
  async getOrdersByDriver(
    @Param('driverId') driverId: string,
    @Query('status') status?: string,
  ) {
    this.logger.log(`GET /orders/driver/${driverId} - status=${status}`);

    const orders = await this.ordersService.findByDriverId(driverId, status);

    return {
      success: true,
      driverId,
      count: orders.length,
      orders,
    };
  }

  // Parametric route AFTER static routes
  @Get(':id')
  async getOrderById(@Param('id') id: string) {
    this.logger.log(`GET /orders/${id}`);

    const order = await this.ordersService.findById(id);

    return {
      success: true,
      order,
    };
  }

  /**
   * PATCH /orders/:id/delivery
   * Called by the Driver App to mark a delivery as DELIVERED or FAILED.
   */
  @Patch(':id/delivery')
  async updateDeliveryStatus(
    @Param('id') id: string,
    @Body()
    body: {
      driverId: string;
      status: string;
      failureReason?: string;
      signature?: string;
      photoUrl?: string;
    },
  ) {
    this.logger.log(
      `PATCH /orders/${id}/delivery - status=${body.status}`,
    );

    const additionalData: any = {};

    if (body.status === 'DELIVERED') {
      additionalData.deliveryProof = {
        signature: body.signature,
        photoUrl: body.photoUrl,
        deliveredAt: new Date(),
      };
    }

    if (body.failureReason) {
      additionalData.failureReason = body.failureReason;
    }

    const order = await this.ordersService.updateStatus(
      id,
      body.status,
      additionalData,
    );

    // Add saga step for driver action
    await this.ordersService.addSagaStep(id, {
      service: 'ROS',
      action: body.status === 'DELIVERED' ? 'DELIVERY_COMPLETED' : 'DELIVERY_FAILED',
      status: body.status === 'DELIVERED' ? 'SUCCESS' : 'FAILED',
      response: { driverId: body.driverId },
      error: body.failureReason,
    });

    return {
      success: true,
      message: `Order ${id} marked as ${body.status}`,
      order,
    };
  }
}
