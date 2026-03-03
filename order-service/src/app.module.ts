/**
 * =============================================================================
 * APP MODULE - Root Module for Order Service
 * =============================================================================
 *
 * PURPOSE:
 * This is the root module for the Order Service microservice.
 * It imports the SagaModule which handles all order processing logic.
 *
 * ARCHITECTURE OVERVIEW:
 *
 *   [API Gateway]
 *        |
 *        | emit('order_created')
 *        v
 *   +----------------------------------+
 *   |       ORDER SERVICE              |
 *   |  +---------------------------+   |
 *   |  |     Saga Orchestrator     |   |
 *   |  |  - Executes saga steps    |   |
 *   |  |  - Handles compensation   |   |
 *   |  +---------------------------+   |
 *   |         |       |       |        |
 *   +---------|-------|-------|--------+
 *             |       |       |
 *             v       v       v
 *          [CMS]   [WMS]   [ROS]
 *           Mock    Mock    Mock
 *         (SOAP)   (TCP)  (REST)
 *
 * This service is a "headless" microservice:
 * - No HTTP endpoints (only RabbitMQ listeners)
 * - Runs as a worker consuming from orders_queue
 * =============================================================================
 */

import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { SagaModule } from './saga/saga.module';

@Module({
  imports: [
    /**
     * MONGODB CONNECTION
     * ==================
     * Connects to the same MongoDB as API Gateway.
     * Stores saga execution state for recovery and auditing.
     *
     * In a true microservices architecture, each service would have
     * its own database. For this assignment, we share the database
     * for simplicity.
     */
    MongooseModule.forRoot(
      process.env.MONGODB_URI || 'mongodb://localhost:27017/swifttrack',
    ),

    /**
     * SAGA MODULE
     * ===========
     * Contains all saga orchestration logic:
     * - SagaOrchestratorService: Executes saga steps
     * - OrderMessageHandler: Listens for order events
     */
    SagaModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
