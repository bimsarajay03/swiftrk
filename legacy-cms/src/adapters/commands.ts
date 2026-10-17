/**
 * =============================================================================
 * CANONICAL COMMANDS AND REPLIES
 * =============================================================================
 *
 * The JSON the Saga Orchestrator sends on cms_queue / wms_queue / ros_queue and
 * the replies it reads back. These shapes must not change: the orchestrator is
 * unaware of the native protocols behind the adapters.
 * See order-service/src/saga/saga-orchestrator.service.ts and shared/interfaces.ts.
 * =============================================================================
 */

export interface OrderItemCommand {
  productId: string;
  productName?: string;
  quantity: number;
  unitPrice?: number;
}

export interface DeliveryAddressCommand {
  street?: string;
  city?: string;
  postalCode?: string;
  country?: string;
  latitude?: number;
  longitude?: number;
}

/** Every reply carries these; `error` is a canonical code when success is false. */
export interface BaseReply {
  success: boolean;
  error?: string;
  message: string;
}

// --- CMS ---------------------------------------------------------------------

export interface CmsCreateOrderCommand {
  orderId: string;
  customerId: string;
  customerName: string;
  customerEmail: string;
  items: OrderItemCommand[];
  totalPrice: number;
}

export interface CmsCancelOrderCommand {
  orderId: string;
  cmsOrderId?: string;
}

export interface CmsCreateOrderReply extends BaseReply {
  cmsOrderId?: string;
}

// --- WMS ---------------------------------------------------------------------

export interface WmsCheckStockCommand {
  orderId: string;
  items: Array<{ productId: string; quantity: number }>;
}

export interface WmsReserveStockCommand {
  orderId: string;
}

export interface WmsReleaseStockCommand {
  orderId: string;
  wmsPackageId?: string;
}

export interface WmsCheckStockReply extends BaseReply {
  inStock: boolean;
  wmsPackageId?: string;
}

// --- ROS ---------------------------------------------------------------------

export interface RosOptimizeRouteCommand {
  orderId: string;
  deliveryAddress?: DeliveryAddressCommand;
  items?: OrderItemCommand[];
}

export interface RosCancelRouteCommand {
  orderId: string;
  rosRouteId?: string;
}

export interface Waypoint {
  lat: number;
  lng: number;
  address: string;
}

export interface RosOptimizeRouteReply extends BaseReply {
  rosRouteId?: string;
  estimatedDeliveryTime?: string;
  optimizedRoute?: {
    waypoints: Waypoint[];
    totalDistance: number;
    totalDuration: number;
  };
}
