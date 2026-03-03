import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { Transport, MicroserviceOptions } from '@nestjs/microservices';
import { AppModule } from './app.module';

async function bootstrap() {
  const logger = new Logger('Bootstrap');

  // Create the NestJS application (HTTP server)
  const app = await NestFactory.create(AppModule);

  /**
   * HYBRID APP: Connect RabbitMQ microservice consumer
   * ===================================================
   * The API Gateway needs to ALSO listen on the notifications_queue
   * to receive status updates from the Order Service (Saga Orchestrator).
   * Without this, @EventPattern handlers in OrdersMessageHandler won't fire.
   */
  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.RMQ,
    options: {
      urls: [process.env.RABBITMQ_URL || 'amqp://localhost:6000'],
      queue: 'notifications_queue',
      queueOptions: {
        durable: true,
      },
      noAck: true,
    },
  });

  app.enableCors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  const port = process.env.PORT ?? 3000;

  // Start all microservice consumers first, then HTTP server
  await app.startAllMicroservices();
  await app.listen(port);

  logger.log(`API Gateway running on http://localhost:${port}`);
  logger.log(`RabbitMQ consumer listening on notifications_queue`);
  logger.log(`WebSocket server ready for connections`);
}

bootstrap().catch((err) => {
  console.error('Failed to start API Gateway:', err);
  process.exit(1);
});
