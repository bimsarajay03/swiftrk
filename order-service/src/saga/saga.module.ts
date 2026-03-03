import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { SagaOrchestratorService } from './saga-orchestrator.service';
import { OrderMessageHandler } from './order-message.handler';
import { OrderSaga, OrderSagaSchema } from './schemas/order-saga.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: OrderSaga.name, schema: OrderSagaSchema },
    ]),

    ClientsModule.register([
      {
        name: 'CMS_SERVICE',
        transport: Transport.RMQ,
        options: {
          urls: [process.env.RABBITMQ_URL || 'amqp://localhost:6000'],
          queue: 'cms_queue',
          queueOptions: {
            durable: true,
          },
        },
      },
      {
        name: 'WMS_SERVICE',
        transport: Transport.RMQ,
        options: {
          urls: [process.env.RABBITMQ_URL || 'amqp://localhost:6000'],
          queue: 'wms_queue',
          queueOptions: {
            durable: true,
          },
        },
      },
      {
        name: 'ROS_SERVICE',
        transport: Transport.RMQ,
        options: {
          urls: [process.env.RABBITMQ_URL || 'amqp://localhost:6000'],
          queue: 'ros_queue',
          queueOptions: {
            durable: true,
          },
        },
      },
      {
        name: 'API_GATEWAY',
        transport: Transport.RMQ,
        options: {
          urls: [process.env.RABBITMQ_URL || 'amqp://localhost:6000'],
          queue: 'notifications_queue',
          queueOptions: {
            durable: true,
          },
        },
      },
    ]),
  ],
  controllers: [OrderMessageHandler],
  providers: [SagaOrchestratorService],
  exports: [SagaOrchestratorService],
})
export class SagaModule {}
