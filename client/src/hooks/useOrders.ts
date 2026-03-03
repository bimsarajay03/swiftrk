/**
 * =============================================================================
 * useOrders Hook - Order Data Fetching & Real-Time Updates
 * =============================================================================
 *
 * Fetches orders from the API and subscribes to real-time updates
 * via Socket.io. When the backend emits 'order:update', the local
 * state is automatically patched so the UI re-renders instantly.
 * =============================================================================
 */

"use client";

import { useEffect, useState, useCallback } from "react";
import { api } from "@/lib/api";
import { Order, SOCKET_EVENTS } from "@/lib/types";
import { useSocket } from "./useSocket";

interface UseOrdersOptions {
  customerId?: string;
  driverId?: string;
  status?: string;
}

export function useOrders(options: UseOrdersOptions = {}) {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { socket, isConnected } = useSocket();

  // Fetch orders from REST API
  const fetchOrders = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      let response;

      if (options.customerId) {
        response = await api.getCustomerOrders(options.customerId);
      } else if (options.driverId) {
        response = await api.getDriverOrders(options.driverId, options.status);
      } else {
        response = await api.listOrders({ status: options.status });
      }

      setOrders(response.orders || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch orders");
      console.error("Failed to fetch orders:", err);
    } finally {
      setLoading(false);
    }
  }, [options.customerId, options.driverId, options.status]);

  // Fetch on mount
  useEffect(() => {
    fetchOrders();
  }, [fetchOrders]);

  // Subscribe to real-time updates via Socket.io
  useEffect(() => {
    if (!socket || !isConnected) return;

    // Subscribe to the appropriate room
    if (options.customerId) {
      socket.emit(SOCKET_EVENTS.SUBSCRIBE_ORDER, {
        customerId: options.customerId,
      });
    }

    if (options.driverId) {
      socket.emit(SOCKET_EVENTS.DRIVER_SUBSCRIBE, {
        driverId: options.driverId,
      });
    }

    // Listen for real-time order updates
    const handleOrderUpdate = (data: { type: string; order: Order }) => {
      setOrders((prev) => {
        const idx = prev.findIndex((o) => o.id === data.order.id);
        if (idx >= 0) {
          // Update existing order
          const updated = [...prev];
          updated[idx] = data.order;
          return updated;
        } else {
          // New order — add to top
          return [data.order, ...prev];
        }
      });
    };

    socket.on(SOCKET_EVENTS.ORDER_UPDATE, handleOrderUpdate);
    socket.on(SOCKET_EVENTS.DRIVER_UPDATE, handleOrderUpdate);

    return () => {
      socket.off(SOCKET_EVENTS.ORDER_UPDATE, handleOrderUpdate);
      socket.off(SOCKET_EVENTS.DRIVER_UPDATE, handleOrderUpdate);

      if (options.customerId) {
        socket.emit(SOCKET_EVENTS.UNSUBSCRIBE_ORDER, {
          customerId: options.customerId,
        });
      }
    };
  }, [socket, isConnected, options.customerId, options.driverId]);

  return { orders, loading, error, refetch: fetchOrders };
}
