"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const core_1 = require("@nestjs/core");
const microservices_1 = require("@nestjs/microservices");
const common_1 = require("@nestjs/common");
const app_module_1 = require("./app.module");
async function bootstrap() {
    const logger = new common_1.Logger('OrderService');
    const app = await core_1.NestFactory.createMicroservice(app_module_1.AppModule, {
        transport: microservices_1.Transport.RMQ,
        options: {
            urls: [process.env.RABBITMQ_URL || 'amqp://localhost:6000'],
            queue: 'orders_queue',
            queueOptions: {
                durable: true,
            },
            noAck: false,
            prefetchCount: 10,
        },
    });
    await app.listen();
    logger.log('Order Service is running');
    logger.log('Listening on queue: orders_queue');
    logger.log('Waiting for order_created events...');
}
bootstrap().catch((err) => {
    console.error('Failed to start Order Service:', err);
    process.exit(1);
});
//# sourceMappingURL=main.js.map