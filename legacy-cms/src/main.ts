/**
 * =============================================================================
 * LEGACY SYSTEM MOCKS - CMS, WMS, ROS
 * =============================================================================
 *
 * Runs 3 NestJS microservice consumers on separate queues to mock the
 * legacy systems. Each listens on its own queue and responds to the
 * Saga Orchestrator's requests using NestJS's request-response pattern.
 *
 * CMS (SOAP/XML) -> cms_queue
 * WMS (TCP)      -> wms_queue
 * ROS (REST)     -> ros_queue
 * =============================================================================
 */

import { NestFactory } from '@nestjs/core';
import { Transport, MicroserviceOptions } from '@nestjs/microservices';
import { Logger } from '@nestjs/common';
import { LegacyMockModule } from './legacy-mock.module';

async function bootstrap() {
  const logger = new Logger('LegacyMocks');
  const rabbitmqUrl = process.env.RABBITMQ_URL || 'amqp://localhost:6000';

  // --- CMS Mock (SOAP/XML legacy system) ---
  const cmsApp = await NestFactory.createMicroservice<MicroserviceOptions>(
    LegacyMockModule,
    {
      transport: Transport.RMQ,
      options: {
        urls: [rabbitmqUrl],
        queue: 'cms_queue',
        queueOptions: { durable: true },
        noAck: false,
      },
    },
  );
  await cmsApp.listen();
  logger.log('CMS Mock listening on cms_queue (SOAP/XML legacy)');

  // --- WMS Mock (TCP proprietary protocol) ---
  const wmsApp = await NestFactory.createMicroservice<MicroserviceOptions>(
    LegacyMockModule,
    {
      transport: Transport.RMQ,
      options: {
        urls: [rabbitmqUrl],
        queue: 'wms_queue',
        queueOptions: { durable: true },
        noAck: false,
      },
    },
  );
  await wmsApp.listen();
  logger.log('WMS Mock listening on wms_queue (TCP proprietary)');

  // --- ROS Mock (REST API cloud system) ---
  const rosApp = await NestFactory.createMicroservice<MicroserviceOptions>(
    LegacyMockModule,
    {
      transport: Transport.RMQ,
      options: {
        urls: [rabbitmqUrl],
        queue: 'ros_queue',
        queueOptions: { durable: true },
        noAck: false,
      },
    },
  );
  await rosApp.listen();
  logger.log('ROS Mock listening on ros_queue (REST API)');

  logger.log('All legacy mock services are running');
}

bootstrap().catch((err) => {
  console.error('Failed to start Legacy Mocks:', err);
  process.exit(1);
});
