"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SagaModule = void 0;
const common_1 = require("@nestjs/common");
const mongoose_1 = require("@nestjs/mongoose");
const microservices_1 = require("@nestjs/microservices");
const saga_orchestrator_service_1 = require("./saga-orchestrator.service");
const order_message_handler_1 = require("./order-message.handler");
const order_saga_schema_1 = require("./schemas/order-saga.schema");
let SagaModule = class SagaModule {
};
exports.SagaModule = SagaModule;
exports.SagaModule = SagaModule = __decorate([
    (0, common_1.Module)({
        imports: [
            mongoose_1.MongooseModule.forFeature([
                { name: order_saga_schema_1.OrderSaga.name, schema: order_saga_schema_1.OrderSagaSchema },
            ]),
            microservices_1.ClientsModule.register([
                {
                    name: 'CMS_SERVICE',
                    transport: microservices_1.Transport.RMQ,
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
                    transport: microservices_1.Transport.RMQ,
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
                    transport: microservices_1.Transport.RMQ,
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
                    transport: microservices_1.Transport.RMQ,
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
        controllers: [order_message_handler_1.OrderMessageHandler],
        providers: [saga_orchestrator_service_1.SagaOrchestratorService],
        exports: [saga_orchestrator_service_1.SagaOrchestratorService],
    })
], SagaModule);
//# sourceMappingURL=saga.module.js.map