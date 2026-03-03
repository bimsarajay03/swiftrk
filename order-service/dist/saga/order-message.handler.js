"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
var OrderMessageHandler_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.OrderMessageHandler = void 0;
const common_1 = require("@nestjs/common");
const microservices_1 = require("@nestjs/microservices");
const saga_orchestrator_service_1 = require("./saga-orchestrator.service");
let OrderMessageHandler = OrderMessageHandler_1 = class OrderMessageHandler {
    sagaOrchestrator;
    logger = new common_1.Logger(OrderMessageHandler_1.name);
    constructor(sagaOrchestrator) {
        this.sagaOrchestrator = sagaOrchestrator;
    }
    async handleOrderCreated(data) {
        this.logger.log(`Received order_created event for order: ${data.orderId}`);
        this.logger.debug(`Order data: ${JSON.stringify(data)}`);
        try {
            await this.sagaOrchestrator.startSaga(data);
        }
        catch (error) {
            this.logger.error(`Failed to process order ${data.orderId}: ${error.message}`);
        }
    }
    async handleRetryOrder(data) {
        this.logger.log(`Received retry request for order: ${data.orderId}`);
        try {
            return {
                success: true,
                message: `Retry initiated for order ${data.orderId}`,
            };
        }
        catch (error) {
            return {
                success: false,
                message: `Failed to retry: ${error.message}`,
            };
        }
    }
};
exports.OrderMessageHandler = OrderMessageHandler;
__decorate([
    (0, microservices_1.EventPattern)('order_created'),
    __param(0, (0, microservices_1.Payload)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], OrderMessageHandler.prototype, "handleOrderCreated", null);
__decorate([
    (0, microservices_1.MessagePattern)('retry_order_saga'),
    __param(0, (0, microservices_1.Payload)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], OrderMessageHandler.prototype, "handleRetryOrder", null);
exports.OrderMessageHandler = OrderMessageHandler = OrderMessageHandler_1 = __decorate([
    (0, common_1.Controller)(),
    __metadata("design:paramtypes", [saga_orchestrator_service_1.SagaOrchestratorService])
], OrderMessageHandler);
//# sourceMappingURL=order-message.handler.js.map