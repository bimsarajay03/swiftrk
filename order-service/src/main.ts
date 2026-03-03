import { NestFactory } from '@nestjs/core';
import { Transport, MicroserviceOptions } from '@nestjs/microservices';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const logger = new Logger('OrderService');

  const app = await NestFactory.createMicroservice<MicroserviceOptions>(
    AppModule,
    {
      transport: Transport.RMQ,
      options: {
        urls: [process.env.RABBITMQ_URL || 'amqp://localhost:6000'],
        queue: 'orders_queue',
        queueOptions: {
          durable: true,
        },
        noAck: false,
        prefetchCount: 10,
      },
    },
  );

  await app.listen();

  logger.log('Order Service is running');
  logger.log('Listening on queue: orders_queue');
  logger.log('Waiting for order_created events...');
}

bootstrap().catch((err) => {
  console.error('Failed to start Order Service:', err);
  process.exit(1);
});
