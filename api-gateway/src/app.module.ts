/**
 * =============================================================================
 * APP MODULE - Root Module for API Gateway
 * =============================================================================
 *
 * PURPOSE:
 * This is the root module that bootstraps the entire API Gateway application.
 * It imports all feature modules and configures global dependencies.
 *
 * ARCHITECTURE OVERVIEW:
 *
 *   [Client Portal]  [Driver App]
 *          |              |
 *          v              v
 *   +----------------------------------+
 *   |         API GATEWAY              |
 *   |  +-----------+  +-------------+  |
 *   |  |  Orders   |  |  WebSocket  |  |
 *   |  | Controller|  |   Gateway   |  |
 *   |  +-----------+  +-------------+  |
 *   |         |              |         |
 *   |         v              v         |
 *   |     +--------------------+       |
 *   |     |   Orders Service   |       |
 *   |     +--------------------+       |
 *   |         |              |         |
 *   +---------|--------------|--------+
 *             |              |
 *             v              v
 *        [MongoDB]     [RabbitMQ]
 *                          |
 *                          v
 *                   [Order Service]
 *                          |
 *             +------------+------------+
 *             |            |            |
 *             v            v            v
 *          [CMS]        [WMS]        [ROS]
 *
 * MODULES:
 * - MongooseModule: Database connection
 * - OrdersModule: Order management feature
 * =============================================================================
 */

import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { OrdersModule } from './orders/orders.module';

@Module({
  imports: [
    /**
     * MONGODB CONNECTION
     * ==================
     * Connects to MongoDB using Mongoose ODM.
     *
     * CONNECTION STRING:
     * - Uses environment variable MONGODB_URI if available
     * - Falls back to localhost for development
     *
     * DATABASE: swifttrack
     * - This database will be created automatically if it doesn't exist
     */
    MongooseModule.forRoot(
      process.env.MONGODB_URI || 'mongodb://localhost:27017/swifttrack',
    ),

    /**
     * ORDERS MODULE
     * =============
     * Handles all order-related functionality:
     * - REST API endpoints
     * - WebSocket real-time updates
     * - RabbitMQ communication with Order Service
     */
    OrdersModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
