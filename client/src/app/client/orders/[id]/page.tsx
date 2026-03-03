/**
 * =============================================================================
 * ORDER DETAIL PAGE - Real-Time Order Tracking
 * =============================================================================
 *
 * Shows full order detail with:
 * - Current status badge
 * - Saga timeline (step-by-step processing progress)
 * - Order items & delivery address
 * - Delivery proof when delivered
 *
 * Updates in REAL-TIME via Socket.io.
 * =============================================================================
 */

"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { api } from "@/lib/api";
import { Order, SOCKET_EVENTS } from "@/lib/types";
import { useSocket } from "@/hooks/useSocket";
import { useNotifications } from "@/hooks/useNotifications";
import OrderStatusBadge from "@/components/OrderStatusBadge";
import OrderTimeline from "@/components/OrderTimeline";
import {
  ArrowLeft,
  Package,
  MapPin,
  User,
  Mail,
  Loader2,
  Camera,
  PenTool,
} from "lucide-react";

export default function OrderDetailPage() {
  const params = useParams();
  const orderId = params.id as string;

  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const { socket, isConnected } = useSocket();
  useNotifications();

  // Fetch initial order data
  useEffect(() => {
    async function fetchOrder() {
      try {
        setLoading(true);
        const response = await api.getOrder(orderId);
        setOrder(response.order || null);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to load order"
        );
      } finally {
        setLoading(false);
      }
    }
    fetchOrder();
  }, [orderId]);

  // Real-time updates for this specific order
  useEffect(() => {
    if (!socket || !isConnected || !order) return;

    // Subscribe to customer room
    socket.emit(SOCKET_EVENTS.SUBSCRIBE_ORDER, {
      customerId: order.customerId,
    });

    const handleUpdate = (data: { type: string; order: Order }) => {
      if (data.order.id === orderId) {
        setOrder(data.order);
      }
    };

    socket.on(SOCKET_EVENTS.ORDER_UPDATE, handleUpdate);

    return () => {
      socket.off(SOCKET_EVENTS.ORDER_UPDATE, handleUpdate);
    };
  }, [socket, isConnected, order?.customerId, orderId]);

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  if (error || !order) {
    return (
      <div className="text-center py-20">
        <p className="text-red-500 mb-2">{error || "Order not found"}</p>
        <Link href="/client" className="text-sm text-blue-600 hover:underline">
          Back to dashboard
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Back */}
      <Link
        href="/client"
        className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to dashboard
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">{order.id}</h2>
          <p className="text-sm text-gray-500 mt-1">
            Created{" "}
            {new Date(order.createdAt).toLocaleDateString("en-LK", {
              day: "numeric",
              month: "long",
              year: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </p>
        </div>
        <OrderStatusBadge status={order.status} className="text-sm px-3 py-1" />
      </div>

      {/* Customer info */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h3 className="font-semibold text-gray-800 mb-3">Customer</h3>
        <div className="space-y-2 text-sm text-gray-600">
          <div className="flex items-center gap-2">
            <User className="w-4 h-4 text-gray-400" />
            {order.customerName}
          </div>
          <div className="flex items-center gap-2">
            <Mail className="w-4 h-4 text-gray-400" />
            {order.customerEmail}
          </div>
          <div className="flex items-center gap-2">
            <MapPin className="w-4 h-4 text-gray-400" />
            {order.deliveryAddress.street}, {order.deliveryAddress.city},{" "}
            {order.deliveryAddress.postalCode},{" "}
            {order.deliveryAddress.country}
          </div>
        </div>
      </div>

      {/* Order items */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h3 className="font-semibold text-gray-800 mb-3">Items</h3>
        <div className="divide-y divide-gray-100">
          {order.items.map((item, i) => (
            <div key={i} className="flex items-center justify-between py-3">
              <div className="flex items-center gap-3">
                <Package className="w-5 h-5 text-gray-400" />
                <div>
                  <p className="text-sm font-medium text-gray-900">
                    {item.productName}
                  </p>
                  <p className="text-xs text-gray-500">
                    {item.productId} &middot; Qty: {item.quantity}
                  </p>
                </div>
              </div>
              <p className="text-sm font-medium text-gray-900">
                LKR {(item.quantity * item.unitPrice).toLocaleString()}
              </p>
            </div>
          ))}
        </div>
        <div className="border-t border-gray-200 pt-3 mt-1 text-right">
          <span className="text-sm text-gray-500">Total: </span>
          <span className="text-lg font-bold text-gray-900">
            LKR {order.totalPrice.toLocaleString()}
          </span>
        </div>
      </div>

      {/* Saga Timeline */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h3 className="font-semibold text-gray-800 mb-4">
          Processing Timeline
        </h3>
        <OrderTimeline steps={order.sagaSteps} />
      </div>

      {/* Driver & External IDs */}
      {(order.driverId || order.cmsOrderId || order.wmsPackageId || order.rosRouteId) && (
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="font-semibold text-gray-800 mb-3">
            System References
          </h3>
          <div className="grid grid-cols-2 gap-3 text-sm">
            {order.cmsOrderId && (
              <div>
                <span className="text-gray-500">CMS ID: </span>
                <span className="font-mono text-gray-900">{order.cmsOrderId}</span>
              </div>
            )}
            {order.wmsPackageId && (
              <div>
                <span className="text-gray-500">WMS Package: </span>
                <span className="font-mono text-gray-900">{order.wmsPackageId}</span>
              </div>
            )}
            {order.rosRouteId && (
              <div>
                <span className="text-gray-500">ROS Route: </span>
                <span className="font-mono text-gray-900">{order.rosRouteId}</span>
              </div>
            )}
            {order.driverId && (
              <div>
                <span className="text-gray-500">Driver: </span>
                <span className="font-mono text-gray-900">{order.driverId}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Delivery Proof */}
      {order.deliveryProof && (
        <div className="bg-green-50 rounded-xl border border-green-200 p-5">
          <h3 className="font-semibold text-green-800 mb-3">
            Delivery Proof
          </h3>
          <div className="space-y-3 text-sm">
            {order.deliveryProof.recipientName && (
              <p className="text-green-700">
                Received by: <strong>{order.deliveryProof.recipientName}</strong>
              </p>
            )}
            {order.deliveryProof.deliveredAt && (
              <p className="text-green-700">
                Delivered at:{" "}
                {new Date(order.deliveryProof.deliveredAt).toLocaleString("en-LK")}
              </p>
            )}
            {order.deliveryProof.signature && (
              <div>
                <div className="flex items-center gap-1 text-green-700 mb-1">
                  <PenTool className="w-4 h-4" />
                  Signature:
                </div>
                <img
                  src={order.deliveryProof.signature}
                  alt="Customer signature"
                  className="max-w-xs border border-green-300 rounded-lg bg-white"
                />
              </div>
            )}
            {order.deliveryProof.photoUrl && (
              <div>
                <div className="flex items-center gap-1 text-green-700 mb-1">
                  <Camera className="w-4 h-4" />
                  Photo:
                </div>
                <img
                  src={order.deliveryProof.photoUrl}
                  alt="Delivery photo"
                  className="max-w-xs border border-green-300 rounded-lg"
                />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
