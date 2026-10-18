/**
 * =============================================================================
 * useNotifications Hook - Browser Push Notifications
 * =============================================================================
 *
 * Subscribes to Socket.io events and triggers:
 * 1. Browser Notification API (push notification)
 * 2. Toast notification in the UI (via react-hot-toast)
 *
 * "When the Order Service sees a 'Package Delivered' event in the RabbitMQ
 *  queue, trigger a browser notification on the client's screen instantly."
 *
 * FLOW:
 *   RabbitMQ → Order Service → API Gateway (Socket.io) → This Hook → Browser
 * =============================================================================
 */

"use client";

import { useEffect, useCallback } from "react";
import toast from "react-hot-toast";
import { useSocket } from "./useSocket";
import { SOCKET_EVENTS, Order, STATUS_LABELS, OrderStatus } from "@/lib/types";

export function useNotifications() {
  const { socket, isConnected } = useSocket();

  // Request browser notification permission
  const requestPermission = useCallback(async () => {
    if (typeof window === "undefined") return;
    if (!("Notification" in window)) return;

    if (Notification.permission === "default") {
      await Notification.requestPermission();
    }
  }, []);

  // Show a browser push notification
  const showBrowserNotification = useCallback(
    (title: string, body: string) => {
      if (typeof window === "undefined") return;
      if (!("Notification" in window)) return;
      if (Notification.permission !== "granted") return;

      new Notification(title, {
        body,
        icon: "/favicon.ico",
        badge: "/favicon.ico",
      });
    },
    []
  );

  // Request permission on mount
  useEffect(() => {
    requestPermission();
  }, [requestPermission]);

  // Listen for real-time events and trigger notifications
  useEffect(() => {
    if (!socket || !isConnected) return;

    const handleOrderUpdate = (data: { type: string; order: Order }) => {
      const { order } = data;
      const statusLabel = STATUS_LABELS[order.status as OrderStatus] || order.status;

      // Toast notification (always shows in-app)
      if (order.status === "DELIVERED") {
        toast.success(
          `📦 Order ${order.id} has been delivered!`,
          { duration: 6000 }
        );
        showBrowserNotification(
          "Package Delivered! 🎉",
          `Order ${order.id} for ${order.customerName} has been successfully delivered.`
        );
      } else if (order.status === "FAILED" || order.status === "CANCELLED") {
        toast.error(`Order ${order.id}: ${statusLabel}`, {
          duration: 6000,
        });
        showBrowserNotification(
          `Order ${statusLabel}`,
          `Order ${order.id} status changed to ${statusLabel}.`
        );
      } else if (order.status === "WMS_OUT_OF_STOCK") {
        toast.error(
          `⚠️ Order ${order.id}: Out of stock — compensation triggered`,
          { duration: 6000 }
        );
        showBrowserNotification(
          "Out of Stock Alert",
          `Order ${order.id} items are out of stock. The system is rolling back.`
        );
      } else {
        toast(`Order ${order.id}: ${statusLabel}`, {
          icon: "🔄",
          duration: 4000,
        });
      }
    };

    const handleDriverUpdate = (data: { type: string; order?: Order; message?: string }) => {
      if (data.type === "ROUTE_CHANGE") {
        toast("🗺️ Your route has been updated!", { duration: 5000 });
        showBrowserNotification(
          "Route Updated",
          data.message || "Your delivery route has changed. Check your manifest."
        );
      } else if (data.type === "NEW_DELIVERY") {
        toast("🚨 New high-priority delivery assigned!", { duration: 5000 });
        showBrowserNotification(
          "New Delivery Assignment",
          data.message || "A new delivery has been added to your manifest."
        );
      }
    };

    socket.on(SOCKET_EVENTS.ORDER_UPDATE, handleOrderUpdate);
    socket.on(SOCKET_EVENTS.DRIVER_UPDATE, handleDriverUpdate);

    return () => {
      socket.off(SOCKET_EVENTS.ORDER_UPDATE, handleOrderUpdate);
      socket.off(SOCKET_EVENTS.DRIVER_UPDATE, handleDriverUpdate);
    };
  }, [socket, isConnected, showBrowserNotification]);
}
