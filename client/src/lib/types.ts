/**
 * =============================================================================
 * SWIFTTRACK FRONTEND - SHARED TYPES
 * =============================================================================
 *
 * Mirrors the shared/interfaces.ts from the backend.
 * Keeps the frontend decoupled from the backend package while maintaining
 * type consistency across the system.
 * =============================================================================
 */

// =============================================================================
// ORDER STATUS
// =============================================================================
export type OrderStatus =
  | "PENDING"
  | "CMS_PROCESSING"
  | "CMS_CONFIRMED"
  | "WMS_PROCESSING"
  | "WMS_CONFIRMED"
  | "WMS_OUT_OF_STOCK"
  | "ROS_PROCESSING"
  | "ROS_CONFIRMED"
  | "ASSIGNED"
  | "IN_TRANSIT"
  | "DELIVERED"
  | "FAILED"
  | "CANCELLED";

export type SagaStepStatus = "PENDING" | "SUCCESS" | "FAILED" | "COMPENSATED";

// =============================================================================
// ORDER INTERFACES
// =============================================================================
export interface OrderItem {
  productId: string;
  productName: string;
  quantity: number;
  unitPrice: number;
}

export interface DeliveryAddress {
  street: string;
  city: string;
  postalCode: string;
  country: string;
  latitude?: number;
  longitude?: number;
}

export interface SagaStep {
  service: "CMS" | "WMS" | "ROS";
  action: string;
  status: SagaStepStatus;
  timestamp: string;
  response?: unknown;
  error?: string;
}

export interface Order {
  id: string;
  customerId: string;
  customerName: string;
  customerEmail: string;
  items: OrderItem[];
  totalPrice: number;
  deliveryAddress: DeliveryAddress;
  status: OrderStatus;
  createdAt: string;
  updatedAt: string;
  sagaSteps: SagaStep[];
  cmsOrderId?: string;
  wmsPackageId?: string;
  rosRouteId?: string;
  driverId?: string;
  estimatedDeliveryTime?: string;
  deliveryProof?: {
    signature?: string;
    photoUrl?: string;
    deliveredAt?: string;
    recipientName?: string;
  };
}

// =============================================================================
// DTOs
// =============================================================================
export interface CreateOrderDto {
  customerId: string;
  customerName: string;
  customerEmail: string;
  items: OrderItem[];
  deliveryAddress: DeliveryAddress;
}

// =============================================================================
// SOCKET.IO EVENT NAMES
// =============================================================================
export const SOCKET_EVENTS = {
  ORDER_UPDATE: "order:update",
  DELIVERY_UPDATE: "delivery:update",
  DRIVER_LOCATION: "driver:location",
  SUBSCRIBE_ORDER: "order:subscribe",
  UNSUBSCRIBE_ORDER: "order:unsubscribe",
  DRIVER_SUBSCRIBE: "driver:subscribe",
  DRIVER_UPDATE: "driver:update",
} as const;

// =============================================================================
// API RESPONSE TYPES
// =============================================================================
export interface ApiResponse<T> {
  success: boolean;
  message?: string;
  order?: T;
  orders?: T[];
  total?: number;
  count?: number;
}

// =============================================================================
// DRIVER INTERFACES
// =============================================================================
export interface DriverDelivery {
  orderId: string;
  sequence: number;
  deliveryAddress: DeliveryAddress;
  customerName: string;
  estimatedTime: string;
  status: "PENDING" | "IN_PROGRESS" | "COMPLETED" | "FAILED";
}

export interface DriverManifest {
  driverId: string;
  date: string;
  deliveries: DriverDelivery[];
  optimizedRoute: {
    totalDistance: number;
    totalDuration: number;
  };
}

export interface DeliveryStatusUpdate {
  orderId: string;
  driverId: string;
  status: "PICKED_UP" | "IN_TRANSIT" | "DELIVERED" | "FAILED";
  failureReason?: string;
  signature?: string;
  photoUrl?: string;
  timestamp: string;
  location?: { lat: number; lng: number };
}

// =============================================================================
// UI HELPERS
// =============================================================================
export const STATUS_LABELS: Record<OrderStatus, string> = {
  PENDING: "Pending",
  CMS_PROCESSING: "Processing (CMS)",
  CMS_CONFIRMED: "Confirmed by CMS",
  WMS_PROCESSING: "Checking Warehouse",
  WMS_CONFIRMED: "Stock Confirmed",
  WMS_OUT_OF_STOCK: "Out of Stock",
  ROS_PROCESSING: "Optimizing Route",
  ROS_CONFIRMED: "Route Planned",
  ASSIGNED: "Assigned to Driver",
  IN_TRANSIT: "In Transit",
  DELIVERED: "Delivered",
  FAILED: "Failed",
  CANCELLED: "Cancelled",
};

export const STATUS_COLORS: Record<OrderStatus, string> = {
  PENDING: "bg-yellow-100 text-yellow-800",
  CMS_PROCESSING: "bg-blue-100 text-blue-800",
  CMS_CONFIRMED: "bg-blue-100 text-blue-800",
  WMS_PROCESSING: "bg-indigo-100 text-indigo-800",
  WMS_CONFIRMED: "bg-indigo-100 text-indigo-800",
  WMS_OUT_OF_STOCK: "bg-red-100 text-red-800",
  ROS_PROCESSING: "bg-purple-100 text-purple-800",
  ROS_CONFIRMED: "bg-purple-100 text-purple-800",
  ASSIGNED: "bg-cyan-100 text-cyan-800",
  IN_TRANSIT: "bg-orange-100 text-orange-800",
  DELIVERED: "bg-green-100 text-green-800",
  FAILED: "bg-red-100 text-red-800",
  CANCELLED: "bg-gray-100 text-gray-800",
};
