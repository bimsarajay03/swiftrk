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
var SagaOrchestratorService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.SagaOrchestratorService = void 0;
const common_1 = require("@nestjs/common");
const mongoose_1 = require("@nestjs/mongoose");
const mongoose_2 = require("mongoose");
const microservices_1 = require("@nestjs/microservices");
const common_2 = require("@nestjs/common");
const rxjs_1 = require("rxjs");
const order_saga_schema_1 = require("./schemas/order-saga.schema");
let SagaOrchestratorService = SagaOrchestratorService_1 = class SagaOrchestratorService {
    sagaModel;
    cmsClient;
    wmsClient;
    rosClient;
    apiGatewayClient;
    logger = new common_1.Logger(SagaOrchestratorService_1.name);
    constructor(sagaModel, cmsClient, wmsClient, rosClient, apiGatewayClient) {
        this.sagaModel = sagaModel;
        this.cmsClient = cmsClient;
        this.wmsClient = wmsClient;
        this.rosClient = rosClient;
        this.apiGatewayClient = apiGatewayClient;
    }
    async startSaga(orderData) {
        this.logger.log(`Starting saga for order: ${orderData.orderId}`);
        const saga = new this.sagaModel({
            orderId: orderData.orderId,
            sagaState: 'STARTED',
            orderData,
            steps: [],
            completedSteps: [],
        });
        await saga.save();
        try {
            this.logger.log(`[${orderData.orderId}] Step 1: Creating order in CMS`);
            await this.updateSagaState(orderData.orderId, 'CMS_PENDING');
            const cmsResult = await this.executeCmsCreateOrder(orderData);
            if (!cmsResult.success) {
                throw new Error(`CMS failed: ${cmsResult.error}`);
            }
            await this.recordStepSuccess(orderData.orderId, 'CMS_CREATE_ORDER', cmsResult);
            await this.updateSagaState(orderData.orderId, 'CMS_COMPLETED', {
                cmsOrderId: cmsResult.cmsOrderId,
            });
            this.notifyStatusUpdate(orderData.orderId, 'CMS_CONFIRMED', {
                cmsOrderId: cmsResult.cmsOrderId,
                sagaStep: {
                    service: 'CMS',
                    action: 'CREATE_ORDER',
                    status: 'SUCCESS',
                },
            });
            this.logger.log(`[${orderData.orderId}] Step 2: Checking stock in WMS`);
            await this.updateSagaState(orderData.orderId, 'WMS_PENDING');
            const wmsResult = await this.executeWmsCheckStock(orderData);
            if (!wmsResult.success || !wmsResult.inStock) {
                this.logger.warn(`[${orderData.orderId}] WMS failed: ${wmsResult.error || 'OUT_OF_STOCK'}`);
                await this.recordStepFailure(orderData.orderId, 'WMS_CHECK_STOCK', wmsResult.error || 'OUT_OF_STOCK');
                await this.compensate(orderData.orderId, 'WMS_OUT_OF_STOCK');
                return;
            }
            await this.recordStepSuccess(orderData.orderId, 'WMS_CHECK_STOCK', wmsResult);
            await this.updateSagaState(orderData.orderId, 'WMS_COMPLETED', {
                wmsPackageId: wmsResult.wmsPackageId,
            });
            this.notifyStatusUpdate(orderData.orderId, 'WMS_CONFIRMED', {
                wmsPackageId: wmsResult.wmsPackageId,
                sagaStep: {
                    service: 'WMS',
                    action: 'CHECK_STOCK',
                    status: 'SUCCESS',
                },
            });
            this.logger.log(`[${orderData.orderId}] Step 3: Optimizing route in ROS`);
            await this.updateSagaState(orderData.orderId, 'ROS_PENDING');
            const rosResult = await this.executeRosOptimizeRoute(orderData);
            if (!rosResult.success) {
                this.logger.warn(`[${orderData.orderId}] ROS failed: ${rosResult.error}`);
                await this.recordStepFailure(orderData.orderId, 'ROS_OPTIMIZE_ROUTE', rosResult.error || 'Unknown error');
                await this.compensate(orderData.orderId, 'ROS_FAILED');
                return;
            }
            await this.recordStepSuccess(orderData.orderId, 'ROS_OPTIMIZE_ROUTE', rosResult);
            await this.updateSagaState(orderData.orderId, 'ROS_COMPLETED', {
                rosRouteId: rosResult.rosRouteId,
            });
            this.logger.log(`[${orderData.orderId}] Saga completed successfully!`);
            await this.updateSagaState(orderData.orderId, 'COMPLETED');
            this.notifyStatusUpdate(orderData.orderId, 'ROS_CONFIRMED', {
                rosRouteId: rosResult.rosRouteId,
                estimatedDeliveryTime: rosResult.estimatedDeliveryTime,
                driverId: 'DRV-001',
                sagaStep: {
                    service: 'ROS',
                    action: 'OPTIMIZE_ROUTE',
                    status: 'SUCCESS',
                },
            });
        }
        catch (error) {
            this.logger.error(`[${orderData.orderId}] Saga failed with error: ${error.message}`);
            await this.compensate(orderData.orderId, error.message);
        }
    }
    async executeCmsCreateOrder(orderData) {
        try {
            const response = await (0, rxjs_1.firstValueFrom)(this.cmsClient
                .send('cms_create_order', {
                orderId: orderData.orderId,
                customerId: orderData.customerId,
                customerName: orderData.customerName,
                customerEmail: orderData.customerEmail,
                items: orderData.items,
                totalPrice: orderData.totalPrice,
            })
                .pipe((0, rxjs_1.timeout)(30000), (0, rxjs_1.catchError)((err) => (0, rxjs_1.of)({ success: false, error: err.message }))));
            if (response.success) {
                await this.addCompletedStep(orderData.orderId, 'CMS_CREATE_ORDER');
            }
            return response;
        }
        catch (error) {
            return { success: false, error: error.message };
        }
    }
    async executeWmsCheckStock(orderData) {
        try {
            const response = await (0, rxjs_1.firstValueFrom)(this.wmsClient
                .send('wms_check_stock', {
                orderId: orderData.orderId,
                items: orderData.items.map((item) => ({
                    productId: item.productId,
                    quantity: item.quantity,
                })),
            })
                .pipe((0, rxjs_1.timeout)(30000), (0, rxjs_1.catchError)((err) => (0, rxjs_1.of)({ success: false, inStock: false, error: err.message }))));
            if (response.success && response.inStock) {
                await this.addCompletedStep(orderData.orderId, 'WMS_RESERVE_STOCK');
            }
            return response;
        }
        catch (error) {
            return { success: false, inStock: false, error: error.message };
        }
    }
    async executeRosOptimizeRoute(orderData) {
        try {
            const response = await (0, rxjs_1.firstValueFrom)(this.rosClient
                .send('ros_optimize_route', {
                orderId: orderData.orderId,
                deliveryAddress: orderData.deliveryAddress,
                items: orderData.items,
            })
                .pipe((0, rxjs_1.timeout)(30000), (0, rxjs_1.catchError)((err) => (0, rxjs_1.of)({ success: false, error: err.message }))));
            if (response.success) {
                await this.addCompletedStep(orderData.orderId, 'ROS_OPTIMIZE_ROUTE');
            }
            return response;
        }
        catch (error) {
            return { success: false, error: error.message };
        }
    }
    async compensate(orderId, reason) {
        this.logger.warn(`[${orderId}] Starting compensation. Reason: ${reason}`);
        await this.updateSagaState(orderId, 'COMPENSATING', {
            failureReason: reason,
        });
        const saga = await this.sagaModel.findOne({ orderId }).exec();
        const completedSteps = saga?.completedSteps || [];
        const compensatedSteps = [];
        if (completedSteps.includes('ROS_OPTIMIZE_ROUTE')) {
            this.logger.log(`[${orderId}] Compensating: Cancelling route in ROS`);
            await this.executeRosCancelRoute(orderId, saga?.rosRouteId);
            compensatedSteps.push('ROS_CANCELLED');
        }
        if (completedSteps.includes('WMS_RESERVE_STOCK')) {
            this.logger.log(`[${orderId}] Compensating: Releasing stock in WMS`);
            await this.executeWmsReleaseStock(orderId, saga?.wmsPackageId);
            compensatedSteps.push('WMS_STOCK_RELEASED');
        }
        if (completedSteps.includes('CMS_CREATE_ORDER')) {
            this.logger.log(`[${orderId}] Compensating: Cancelling order in CMS`);
            await this.executeCmsCancelOrder(orderId, saga?.cmsOrderId);
            compensatedSteps.push('CMS_CANCELLED');
        }
        await this.updateSagaState(orderId, 'FAILED');
        this.apiGatewayClient.emit('saga_compensation_triggered', {
            orderId,
            reason,
            compensatedSteps,
        });
        this.notifyStatusUpdate(orderId, 'FAILED');
        this.logger.log(`[${orderId}] Compensation completed. Steps rolled back: ${compensatedSteps.join(', ')}`);
    }
    async executeCmsCancelOrder(orderId, cmsOrderId) {
        try {
            await (0, rxjs_1.firstValueFrom)(this.cmsClient.send('cms_cancel_order', { orderId, cmsOrderId }).pipe((0, rxjs_1.timeout)(30000), (0, rxjs_1.catchError)((err) => {
                this.logger.error(`Failed to cancel CMS order: ${err.message}`);
                return (0, rxjs_1.of)({ success: false });
            })));
            await this.recordStepSuccess(orderId, 'CMS_CANCEL_ORDER', {
                compensated: true,
            });
        }
        catch (error) {
            this.logger.error(`CMS compensation failed: ${error.message}`);
        }
    }
    async executeWmsReleaseStock(orderId, wmsPackageId) {
        try {
            await (0, rxjs_1.firstValueFrom)(this.wmsClient
                .send('wms_release_stock', { orderId, wmsPackageId })
                .pipe((0, rxjs_1.timeout)(30000), (0, rxjs_1.catchError)((err) => {
                this.logger.error(`Failed to release WMS stock: ${err.message}`);
                return (0, rxjs_1.of)({ success: false });
            })));
            await this.recordStepSuccess(orderId, 'WMS_RELEASE_STOCK', {
                compensated: true,
            });
        }
        catch (error) {
            this.logger.error(`WMS compensation failed: ${error.message}`);
        }
    }
    async executeRosCancelRoute(orderId, rosRouteId) {
        try {
            await (0, rxjs_1.firstValueFrom)(this.rosClient.send('ros_cancel_route', { orderId, rosRouteId }).pipe((0, rxjs_1.timeout)(30000), (0, rxjs_1.catchError)((err) => {
                this.logger.error(`Failed to cancel ROS route: ${err.message}`);
                return (0, rxjs_1.of)({ success: false });
            })));
            await this.recordStepSuccess(orderId, 'ROS_CANCEL_ROUTE', {
                compensated: true,
            });
        }
        catch (error) {
            this.logger.error(`ROS compensation failed: ${error.message}`);
        }
    }
    async updateSagaState(orderId, state, additionalData) {
        await this.sagaModel
            .updateOne({ orderId }, { sagaState: state, ...additionalData })
            .exec();
    }
    async addCompletedStep(orderId, stepName) {
        await this.sagaModel
            .updateOne({ orderId }, { $push: { completedSteps: stepName } })
            .exec();
    }
    async recordStepSuccess(orderId, stepName, response) {
        const step = {
            stepName,
            status: 'SUCCESS',
            startedAt: new Date(),
            completedAt: new Date(),
            response,
        };
        await this.sagaModel
            .updateOne({ orderId }, { $push: { steps: step } })
            .exec();
    }
    async recordStepFailure(orderId, stepName, error) {
        const step = {
            stepName,
            status: 'FAILED',
            startedAt: new Date(),
            completedAt: new Date(),
            error,
        };
        await this.sagaModel
            .updateOne({ orderId }, { $push: { steps: step } })
            .exec();
    }
    notifyStatusUpdate(orderId, status, data) {
        this.apiGatewayClient.emit('order_status_updated', {
            orderId,
            status,
            ...data,
        });
    }
};
exports.SagaOrchestratorService = SagaOrchestratorService;
exports.SagaOrchestratorService = SagaOrchestratorService = SagaOrchestratorService_1 = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, mongoose_1.InjectModel)(order_saga_schema_1.OrderSaga.name)),
    __param(1, (0, common_2.Inject)('CMS_SERVICE')),
    __param(2, (0, common_2.Inject)('WMS_SERVICE')),
    __param(3, (0, common_2.Inject)('ROS_SERVICE')),
    __param(4, (0, common_2.Inject)('API_GATEWAY')),
    __metadata("design:paramtypes", [mongoose_2.Model,
        microservices_1.ClientProxy,
        microservices_1.ClientProxy,
        microservices_1.ClientProxy,
        microservices_1.ClientProxy])
], SagaOrchestratorService);
//# sourceMappingURL=saga-orchestrator.service.js.map