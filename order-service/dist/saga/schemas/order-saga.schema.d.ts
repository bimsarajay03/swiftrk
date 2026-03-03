import { Document } from 'mongoose';
export type SagaState = 'STARTED' | 'CMS_PENDING' | 'CMS_COMPLETED' | 'WMS_PENDING' | 'WMS_COMPLETED' | 'ROS_PENDING' | 'ROS_COMPLETED' | 'COMPLETED' | 'COMPENSATING' | 'COMPENSATED' | 'FAILED';
export declare class SagaStepRecord {
    stepName: string;
    status: string;
    startedAt: Date;
    completedAt?: Date;
    request?: Record<string, any>;
    response?: Record<string, any>;
    error?: string;
}
export declare class OrderSaga {
    orderId: string;
    sagaState: string;
    orderData: Record<string, any>;
    cmsOrderId?: string;
    wmsPackageId?: string;
    rosRouteId?: string;
    steps: SagaStepRecord[];
    completedSteps: string[];
    failureReason?: string;
}
export type OrderSagaDocument = OrderSaga & Document;
export declare const OrderSagaSchema: import("mongoose").Schema<OrderSaga, import("mongoose").Model<OrderSaga, any, any, any, (Document<unknown, any, OrderSaga, any, import("mongoose").DefaultSchemaOptions> & OrderSaga & {
    _id: import("mongoose").Types.ObjectId;
} & {
    __v: number;
} & {
    id: string;
}) | (Document<unknown, any, OrderSaga, any, import("mongoose").DefaultSchemaOptions> & OrderSaga & {
    _id: import("mongoose").Types.ObjectId;
} & {
    __v: number;
}), any, OrderSaga>, {}, {}, {}, {}, import("mongoose").DefaultSchemaOptions, OrderSaga, Document<unknown, {}, OrderSaga, {
    id: string;
}, import("mongoose").ResolveSchemaOptions<import("mongoose").DefaultSchemaOptions>> & Omit<OrderSaga & {
    _id: import("mongoose").Types.ObjectId;
} & {
    __v: number;
}, "id"> & {
    id: string;
}, {
    orderId?: import("mongoose").SchemaDefinitionProperty<string, OrderSaga, Document<unknown, {}, OrderSaga, {
        id: string;
    }, import("mongoose").ResolveSchemaOptions<import("mongoose").DefaultSchemaOptions>> & Omit<OrderSaga & {
        _id: import("mongoose").Types.ObjectId;
    } & {
        __v: number;
    }, "id"> & {
        id: string;
    }> | undefined;
    sagaState?: import("mongoose").SchemaDefinitionProperty<string, OrderSaga, Document<unknown, {}, OrderSaga, {
        id: string;
    }, import("mongoose").ResolveSchemaOptions<import("mongoose").DefaultSchemaOptions>> & Omit<OrderSaga & {
        _id: import("mongoose").Types.ObjectId;
    } & {
        __v: number;
    }, "id"> & {
        id: string;
    }> | undefined;
    orderData?: import("mongoose").SchemaDefinitionProperty<Record<string, any>, OrderSaga, Document<unknown, {}, OrderSaga, {
        id: string;
    }, import("mongoose").ResolveSchemaOptions<import("mongoose").DefaultSchemaOptions>> & Omit<OrderSaga & {
        _id: import("mongoose").Types.ObjectId;
    } & {
        __v: number;
    }, "id"> & {
        id: string;
    }> | undefined;
    cmsOrderId?: import("mongoose").SchemaDefinitionProperty<string | undefined, OrderSaga, Document<unknown, {}, OrderSaga, {
        id: string;
    }, import("mongoose").ResolveSchemaOptions<import("mongoose").DefaultSchemaOptions>> & Omit<OrderSaga & {
        _id: import("mongoose").Types.ObjectId;
    } & {
        __v: number;
    }, "id"> & {
        id: string;
    }> | undefined;
    wmsPackageId?: import("mongoose").SchemaDefinitionProperty<string | undefined, OrderSaga, Document<unknown, {}, OrderSaga, {
        id: string;
    }, import("mongoose").ResolveSchemaOptions<import("mongoose").DefaultSchemaOptions>> & Omit<OrderSaga & {
        _id: import("mongoose").Types.ObjectId;
    } & {
        __v: number;
    }, "id"> & {
        id: string;
    }> | undefined;
    rosRouteId?: import("mongoose").SchemaDefinitionProperty<string | undefined, OrderSaga, Document<unknown, {}, OrderSaga, {
        id: string;
    }, import("mongoose").ResolveSchemaOptions<import("mongoose").DefaultSchemaOptions>> & Omit<OrderSaga & {
        _id: import("mongoose").Types.ObjectId;
    } & {
        __v: number;
    }, "id"> & {
        id: string;
    }> | undefined;
    steps?: import("mongoose").SchemaDefinitionProperty<SagaStepRecord[], OrderSaga, Document<unknown, {}, OrderSaga, {
        id: string;
    }, import("mongoose").ResolveSchemaOptions<import("mongoose").DefaultSchemaOptions>> & Omit<OrderSaga & {
        _id: import("mongoose").Types.ObjectId;
    } & {
        __v: number;
    }, "id"> & {
        id: string;
    }> | undefined;
    completedSteps?: import("mongoose").SchemaDefinitionProperty<string[], OrderSaga, Document<unknown, {}, OrderSaga, {
        id: string;
    }, import("mongoose").ResolveSchemaOptions<import("mongoose").DefaultSchemaOptions>> & Omit<OrderSaga & {
        _id: import("mongoose").Types.ObjectId;
    } & {
        __v: number;
    }, "id"> & {
        id: string;
    }> | undefined;
    failureReason?: import("mongoose").SchemaDefinitionProperty<string | undefined, OrderSaga, Document<unknown, {}, OrderSaga, {
        id: string;
    }, import("mongoose").ResolveSchemaOptions<import("mongoose").DefaultSchemaOptions>> & Omit<OrderSaga & {
        _id: import("mongoose").Types.ObjectId;
    } & {
        __v: number;
    }, "id"> & {
        id: string;
    }> | undefined;
}, OrderSaga>;
