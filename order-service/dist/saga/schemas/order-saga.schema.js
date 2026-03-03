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
Object.defineProperty(exports, "__esModule", { value: true });
exports.OrderSagaSchema = exports.OrderSaga = exports.SagaStepRecord = void 0;
const mongoose_1 = require("@nestjs/mongoose");
let SagaStepRecord = class SagaStepRecord {
    stepName;
    status;
    startedAt;
    completedAt;
    request;
    response;
    error;
};
exports.SagaStepRecord = SagaStepRecord;
__decorate([
    (0, mongoose_1.Prop)({ required: true }),
    __metadata("design:type", String)
], SagaStepRecord.prototype, "stepName", void 0);
__decorate([
    (0, mongoose_1.Prop)({
        required: true,
        enum: ['PENDING', 'SUCCESS', 'FAILED', 'COMPENSATED'],
    }),
    __metadata("design:type", String)
], SagaStepRecord.prototype, "status", void 0);
__decorate([
    (0, mongoose_1.Prop)({ required: true }),
    __metadata("design:type", Date)
], SagaStepRecord.prototype, "startedAt", void 0);
__decorate([
    (0, mongoose_1.Prop)(),
    __metadata("design:type", Date)
], SagaStepRecord.prototype, "completedAt", void 0);
__decorate([
    (0, mongoose_1.Prop)({ type: Object }),
    __metadata("design:type", Object)
], SagaStepRecord.prototype, "request", void 0);
__decorate([
    (0, mongoose_1.Prop)({ type: Object }),
    __metadata("design:type", Object)
], SagaStepRecord.prototype, "response", void 0);
__decorate([
    (0, mongoose_1.Prop)(),
    __metadata("design:type", String)
], SagaStepRecord.prototype, "error", void 0);
exports.SagaStepRecord = SagaStepRecord = __decorate([
    (0, mongoose_1.Schema)({ _id: false })
], SagaStepRecord);
let OrderSaga = class OrderSaga {
    orderId;
    sagaState;
    orderData;
    cmsOrderId;
    wmsPackageId;
    rosRouteId;
    steps;
    completedSteps;
    failureReason;
};
exports.OrderSaga = OrderSaga;
__decorate([
    (0, mongoose_1.Prop)({ required: true, unique: true, index: true }),
    __metadata("design:type", String)
], OrderSaga.prototype, "orderId", void 0);
__decorate([
    (0, mongoose_1.Prop)({ required: true }),
    __metadata("design:type", String)
], OrderSaga.prototype, "sagaState", void 0);
__decorate([
    (0, mongoose_1.Prop)({ type: Object, required: true }),
    __metadata("design:type", Object)
], OrderSaga.prototype, "orderData", void 0);
__decorate([
    (0, mongoose_1.Prop)(),
    __metadata("design:type", String)
], OrderSaga.prototype, "cmsOrderId", void 0);
__decorate([
    (0, mongoose_1.Prop)(),
    __metadata("design:type", String)
], OrderSaga.prototype, "wmsPackageId", void 0);
__decorate([
    (0, mongoose_1.Prop)(),
    __metadata("design:type", String)
], OrderSaga.prototype, "rosRouteId", void 0);
__decorate([
    (0, mongoose_1.Prop)({ type: [SagaStepRecord], default: [] }),
    __metadata("design:type", Array)
], OrderSaga.prototype, "steps", void 0);
__decorate([
    (0, mongoose_1.Prop)({ type: [String], default: [] }),
    __metadata("design:type", Array)
], OrderSaga.prototype, "completedSteps", void 0);
__decorate([
    (0, mongoose_1.Prop)(),
    __metadata("design:type", String)
], OrderSaga.prototype, "failureReason", void 0);
exports.OrderSaga = OrderSaga = __decorate([
    (0, mongoose_1.Schema)({ timestamps: true, collection: 'order_sagas' })
], OrderSaga);
exports.OrderSagaSchema = mongoose_1.SchemaFactory.createForClass(OrderSaga);
//# sourceMappingURL=order-saga.schema.js.map