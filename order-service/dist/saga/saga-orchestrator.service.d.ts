import { Model } from 'mongoose';
import { ClientProxy } from '@nestjs/microservices';
import { OrderSagaDocument } from './schemas/order-saga.schema';
interface OrderData {
    orderId: string;
    customerId: string;
    customerName: string;
    customerEmail: string;
    items: Array<{
        productId: string;
        productName: string;
        quantity: number;
        unitPrice: number;
    }>;
    totalPrice: number;
    deliveryAddress: {
        street: string;
        city: string;
        postalCode: string;
        country: string;
        latitude?: number;
        longitude?: number;
    };
}
export declare class SagaOrchestratorService {
    private sagaModel;
    private cmsClient;
    private wmsClient;
    private rosClient;
    private apiGatewayClient;
    private readonly logger;
    constructor(sagaModel: Model<OrderSagaDocument>, cmsClient: ClientProxy, wmsClient: ClientProxy, rosClient: ClientProxy, apiGatewayClient: ClientProxy);
    startSaga(orderData: OrderData): Promise<void>;
    private executeCmsCreateOrder;
    private executeWmsCheckStock;
    private executeRosOptimizeRoute;
    private compensate;
    private executeCmsCancelOrder;
    private executeWmsReleaseStock;
    private executeRosCancelRoute;
    private updateSagaState;
    private addCompletedStep;
    private recordStepSuccess;
    private recordStepFailure;
    private notifyStatusUpdate;
}
export {};
