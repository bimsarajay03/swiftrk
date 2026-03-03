/**
 * =============================================================================
 * API CLIENT - REST Communication with API Gateway
 * =============================================================================
 *
 * Handles all HTTP requests to the NestJS API Gateway.
 * Base URL defaults to http://localhost:3000 (the API Gateway port).
 * =============================================================================
 */

import { Order, CreateOrderDto, ApiResponse } from "./types";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";

class ApiClient {
  private baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  private async request<T>(
    endpoint: string,
    options?: RequestInit
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;

    const res = await fetch(url, {
      headers: {
        "Content-Type": "application/json",
        ...options?.headers,
      },
      ...options,
    });

    if (!res.ok) {
      const error = await res.json().catch(() => ({ message: res.statusText }));
      throw new Error(error.message || `HTTP ${res.status}`);
    }

    return res.json();
  }

  // =========================================================================
  // ORDER ENDPOINTS
  // =========================================================================

  /** Create a new order */
  async createOrder(
    dto: CreateOrderDto
  ): Promise<ApiResponse<Order>> {
    return this.request<ApiResponse<Order>>("/orders", {
      method: "POST",
      body: JSON.stringify(dto),
    });
  }

  /** Get a single order by ID */
  async getOrder(orderId: string): Promise<ApiResponse<Order>> {
    return this.request<ApiResponse<Order>>(`/orders/${orderId}`);
  }

  /** List all orders with optional filters */
  async listOrders(params?: {
    status?: string;
    limit?: number;
    skip?: number;
  }): Promise<ApiResponse<Order>> {
    const query = new URLSearchParams();
    if (params?.status) query.set("status", params.status);
    if (params?.limit) query.set("limit", String(params.limit));
    if (params?.skip) query.set("skip", String(params.skip));

    const qs = query.toString();
    return this.request<ApiResponse<Order>>(
      `/orders${qs ? `?${qs}` : ""}`
    );
  }

  /** Get all orders for a customer */
  async getCustomerOrders(
    customerId: string
  ): Promise<ApiResponse<Order>> {
    return this.request<ApiResponse<Order>>(
      `/orders/customer/${customerId}`
    );
  }

  /** Get all orders assigned to a driver */
  async getDriverOrders(
    driverId: string,
    status?: string
  ): Promise<ApiResponse<Order>> {
    const query = status ? `?status=${status}` : "";
    return this.request<ApiResponse<Order>>(
      `/orders/driver/${driverId}${query}`
    );
  }

  /** Update delivery status (driver marks package) */
  async updateDeliveryStatus(
    orderId: string,
    update: {
      driverId: string;
      status: string;
      failureReason?: string;
      signature?: string;
      photoUrl?: string;
    }
  ): Promise<ApiResponse<Order>> {
    return this.request<ApiResponse<Order>>(
      `/orders/${orderId}/delivery`,
      {
        method: "PATCH",
        body: JSON.stringify(update),
      }
    );
  }
}

export const api = new ApiClient(API_BASE_URL);
