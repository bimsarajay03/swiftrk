/**
 * =============================================================================
 * SWIFTTRACK - SHARED INTERFACES
 * =============================================================================
 *
 * This file contains all shared interfaces used across the microservices architecture.
 * These interfaces ensure type consistency between:
 *   - API Gateway (receives HTTP requests, emits to RabbitMQ)
 *   - Order Service (orchestrates the Saga pattern)
 *   - Legacy System Mocks (CMS, ROS, WMS)
 *   - Frontend (Next.js client & driver apps)
 *
 * IMPORTANT: Any changes here affect ALL services. Coordinate with your team.
 * =============================================================================
 */

// =============================================================================
// ORDER STATUS ENUM
// =============================================================================
/**
 * Represents all possible states an order can be in throughout its lifecycle.
 * Used by the Saga Pattern to track order progression and trigger compensations.
 */
export type OrderStatus =
  | "PENDING" // Initial state when order is created
  | "CMS_PROCESSING" // Order sent to Client Management System
  | "CMS_CONFIRMED" // CMS has confirmed the order
  | "WMS_PROCESSING" // Order sent to Warehouse Management System
  | "WMS_CONFIRMED" // WMS has confirmed stock availability
  | "WMS_OUT_OF_STOCK" // WMS reports item not available (triggers compensation)
  | "ROS_PROCESSING" // Order sent to Route Optimization System
  | "ROS_CONFIRMED" // ROS has generated delivery route
  | "ASSIGNED" // Order assigned to a driver
  | "IN_TRANSIT" // Package is being delivered
  | "DELIVERED" // Successfully delivered
  | "FAILED" // Order failed (after compensation)
  | "CANCELLED"; // Order cancelled by user or system

// =============================================================================
// SAGA STEP STATUS
// =============================================================================
/**
 * Tracks the status of each step in the Saga.
 * Used for implementing compensating transactions.
 */
export type SagaStepStatus = "PENDING" | "SUCCESS" | "FAILED" | "COMPENSATED";

// =============================================================================
// ORDER ITEM INTERFACE
// =============================================================================
/**
 * Represents a single item in an order.
 */
export interface OrderItem {
  productId: string;
  productName: string;
  quantity: number;
  unitPrice: number;
}

// =============================================================================
// DELIVERY ADDRESS INTERFACE
// =============================================================================
/**
 * Delivery address for an order.
 */
export interface DeliveryAddress {
  street: string;
  city: string;
  postalCode: string;
  country: string;
  latitude?: number;
  longitude?: number;
}

// =============================================================================
// SAGA STEP TRACKING
// =============================================================================
/**
 * Tracks each step in the Saga for potential rollback.
 * Essential for implementing compensating transactions.
 */
export interface SagaStep {
  service: "CMS" | "WMS" | "ROS";
  action: string;
  status: SagaStepStatus;
  timestamp: Date;
  response?: any;
  error?: string;
}

// =============================================================================
// MAIN ORDER INTERFACE
// =============================================================================
/**
 * Complete Order interface used throughout the system.
 * Contains all information needed for order processing and Saga tracking.
 */
export interface Order {
  id: string;

  // Customer Information
  customerId: string;
  customerName: string;
  customerEmail: string;

  // Order Details
  items: OrderItem[];
  totalPrice: number;
  deliveryAddress: DeliveryAddress;

  // Status Tracking
  status: OrderStatus;
  createdAt: Date;
  updatedAt: Date;

  // Saga Tracking (for compensating transactions)
  sagaSteps: SagaStep[];

  // External System References (populated after each service confirms)
  cmsOrderId?: string; // ID from Client Management System
  wmsPackageId?: string; // ID from Warehouse Management System
  rosRouteId?: string; // ID from Route Optimization System

  // Driver Assignment
  driverId?: string;
  estimatedDeliveryTime?: Date;

  // Delivery Proof
  deliveryProof?: {
    signature?: string; // Base64 encoded signature
    photoUrl?: string; // URL to delivery photo
    deliveredAt?: Date;
    recipientName?: string;
  };
}

// =============================================================================
// CREATE ORDER DTO (Data Transfer Object)
// =============================================================================
/**
 * DTO for creating a new order via the API Gateway.
 * This is what the frontend sends to POST /orders
 */
export interface CreateOrderDto {
  customerId: string;
  customerName: string;
  customerEmail: string;
  items: OrderItem[];
  deliveryAddress: DeliveryAddress;
}

// =============================================================================
// RABBITMQ MESSAGE PATTERNS
// =============================================================================
/**
 * All RabbitMQ message patterns used in the system.
 * Using constants prevents typos and makes refactoring easier.
 *
 * NAMING CONVENTION:
 * - Events (emit/fire-and-forget): past tense (order_created, delivery_completed)
 * - Commands (send/request-response): present tense (process_order, check_stock)
 */
export const MESSAGE_PATTERNS = {
  // API Gateway -> Order Service
  ORDER_CREATED: "order_created",
  ORDER_STATUS_REQUEST: "order_status_request",

  // Order Service -> CMS Mock (SOAP)
  CMS_CREATE_ORDER: "cms_create_order",
  CMS_CANCEL_ORDER: "cms_cancel_order", // Compensating transaction
  CMS_ORDER_CONFIRMED: "cms_order_confirmed",
  CMS_ORDER_CANCELLED: "cms_order_cancelled",

  // Order Service -> WMS Mock (TCP)
  WMS_CHECK_STOCK: "wms_check_stock",
  WMS_RESERVE_STOCK: "wms_reserve_stock",
  WMS_RELEASE_STOCK: "wms_release_stock", // Compensating transaction
  WMS_STOCK_CONFIRMED: "wms_stock_confirmed",
  WMS_OUT_OF_STOCK: "wms_out_of_stock",

  // Order Service -> ROS Mock (REST)
  ROS_OPTIMIZE_ROUTE: "ros_optimize_route",
  ROS_CANCEL_ROUTE: "ros_cancel_route", // Compensating transaction
  ROS_ROUTE_OPTIMIZED: "ros_route_optimized",

  // Real-time Updates (Order Service -> API Gateway -> Frontend)
  ORDER_STATUS_UPDATED: "order_status_updated",
  DELIVERY_COMPLETED: "delivery_completed",
  DRIVER_LOCATION_UPDATED: "driver_location_updated",
} as const;

// =============================================================================
// RABBITMQ QUEUE NAMES
// =============================================================================
/**
 * Queue names for different services.
 * Each service listens on its own queue.
 */
export const QUEUE_NAMES = {
  ORDERS: "orders_queue", // Order Service main queue
  CMS: "cms_queue", // CMS Mock queue
  WMS: "wms_queue", // WMS Mock queue
  ROS: "ros_queue", // ROS Mock queue
  NOTIFICATIONS: "notifications_queue", // Real-time notification queue
} as const;

// =============================================================================
// SERVICE RESPONSE INTERFACES
// =============================================================================
/**
 * Response from CMS Mock after order creation.
 */
export interface CmsResponse {
  success: boolean;
  cmsOrderId?: string;
  error?: string;
}

/**
 * Response from WMS Mock after stock check.
 */
export interface WmsResponse {
  success: boolean;
  wmsPackageId?: string;
  inStock: boolean;
  error?: string;
}

/**
 * Response from ROS Mock after route optimization.
 */
export interface RosResponse {
  success: boolean;
  rosRouteId?: string;
  estimatedDeliveryTime?: Date;
  optimizedRoute?: {
    waypoints: Array<{ lat: number; lng: number; address: string }>;
    totalDistance: number; // in kilometers
    totalDuration: number; // in minutes
  };
  error?: string;
}

// =============================================================================
// SOCKET.IO EVENT NAMES
// =============================================================================
/**
 * Socket.io events for real-time frontend updates.
 * Member 3 (Frontend) will use these to update the UI.
 */
export const SOCKET_EVENTS = {
  // Client subscribes to these
  ORDER_UPDATE: "order:update",
  DELIVERY_UPDATE: "delivery:update",
  DRIVER_LOCATION: "driver:location",

  // Client emits these
  SUBSCRIBE_ORDER: "order:subscribe",
  UNSUBSCRIBE_ORDER: "order:unsubscribe",
} as const;

// =============================================================================
// DRIVER INTERFACES (for Mobile App)
// =============================================================================
/**
 * Driver manifest for the day.
 */
export interface DriverManifest {
  driverId: string;
  date: Date;
  deliveries: Array<{
    orderId: string;
    sequence: number;
    deliveryAddress: DeliveryAddress;
    customerName: string;
    estimatedTime: Date;
    status: "PENDING" | "IN_PROGRESS" | "COMPLETED" | "FAILED";
  }>;
  optimizedRoute: {
    totalDistance: number;
    totalDuration: number;
  };
}

/**
 * Update delivery status (from driver app).
 */
export interface DeliveryStatusUpdate {
  orderId: string;
  driverId: string;
  status: "PICKED_UP" | "IN_TRANSIT" | "DELIVERED" | "FAILED";
  failureReason?: string;
  signature?: string;
  photoUrl?: string;
  timestamp: Date;
  location?: { lat: number; lng: number };
}
