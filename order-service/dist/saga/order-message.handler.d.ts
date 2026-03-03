import { SagaOrchestratorService } from './saga-orchestrator.service';
export declare class OrderMessageHandler {
    private readonly sagaOrchestrator;
    private readonly logger;
    constructor(sagaOrchestrator: SagaOrchestratorService);
    handleOrderCreated(data: {
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
    }): Promise<void>;
    handleRetryOrder(data: {
        orderId: string;
    }): Promise<{
        success: boolean;
        message: string;
    }>;
}
