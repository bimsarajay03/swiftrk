/**
 * =============================================================================
 * DELIVERY DETAIL PAGE - Driver View
 * =============================================================================
 *
 * Drivers can:
 * - View delivery details (address, items)
 * - Mark package as "DELIVERED" or "FAILED" with reason
 *
 * Updates are sent to the API Gateway which pushes them into RabbitMQ,
 * triggering real-time notifications on the client portal.
 * =============================================================================
 */

"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { api } from "@/lib/api";
import { Order, SOCKET_EVENTS } from "@/lib/types";
import { useSocket } from "@/hooks/useSocket";
import { useNotifications } from "@/hooks/useNotifications";
import OrderStatusBadge from "@/components/OrderStatusBadge";
import toast from "react-hot-toast";
import {
  ArrowLeft,
  Package,
  MapPin,
  User,
  CheckCircle,
  XCircle,
  Loader2,
  Navigation,
} from "lucide-react";

const DEMO_DRIVER_ID = "DRV-001";

const FAILURE_REASONS = [
  "Recipient not available",
  "Wrong address",
  "Package damaged",
  "Customer refused delivery",
  "Access denied to building",
  "Other",
];

export default function DeliveryDetailPage() {
  const params = useParams();
  const router = useRouter();
  const orderId = params.id as string;

  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Delivery action state
  const [showFailForm, setShowFailForm] = useState(false);
  const [failureReason, setFailureReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const { socket, isConnected } = useSocket();
  useNotifications();

  // Fetch order
  useEffect(() => {
    async function fetchOrder() {
      try {
        setLoading(true);
        const response = await api.getOrder(orderId);
        setOrder(response.order || null);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to load delivery"
        );
      } finally {
        setLoading(false);
      }
    }
    fetchOrder();
  }, [orderId]);

  // Real-time updates
  useEffect(() => {
    if (!socket || !isConnected) return;

    socket.emit(SOCKET_EVENTS.DRIVER_SUBSCRIBE, {
      driverId: DEMO_DRIVER_ID,
    });

    const handleUpdate = (data: { type: string; order: Order }) => {
      if (data.order.id === orderId) {
        setOrder(data.order);
      }
    };

    socket.on(SOCKET_EVENTS.DRIVER_UPDATE, handleUpdate);
    socket.on(SOCKET_EVENTS.ORDER_UPDATE, handleUpdate);

    return () => {
      socket.off(SOCKET_EVENTS.DRIVER_UPDATE, handleUpdate);
      socket.off(SOCKET_EVENTS.ORDER_UPDATE, handleUpdate);
    };
  }, [socket, isConnected, orderId]);

  // Mark as delivered
  const handleDelivered = async () => {
    try {
      setSubmitting(true);
      await api.updateDeliveryStatus(orderId, {
        driverId: DEMO_DRIVER_ID,
        status: "DELIVERED",
      });
      toast.success("Delivery marked as completed!");
      router.push("/driver");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to update status"
      );
    } finally {
      setSubmitting(false);
    }
  };

  // Mark as failed
  const handleFailed = async () => {
    if (!failureReason) {
      toast.error("Please select a failure reason");
      return;
    }

    try {
      setSubmitting(true);
      await api.updateDeliveryStatus(orderId, {
        driverId: DEMO_DRIVER_ID,
        status: "FAILED",
        failureReason,
      });
      toast.success("Delivery marked as failed");
      router.push("/driver");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to update status"
      );
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="w-8 h-8 animate-spin text-emerald-600" />
      </div>
    );
  }

  if (error || !order) {
    return (
      <div className="text-center py-20">
        <p className="text-red-500 mb-2">{error || "Delivery not found"}</p>
        <Link
          href="/driver"
          className="text-sm text-emerald-600 hover:underline"
        >
          Back to manifest
        </Link>
      </div>
    );
  }

  const isActionable =
    order.status === "ASSIGNED" ||
    order.status === "IN_TRANSIT" ||
    order.status === "ROS_CONFIRMED";

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Back */}
      <Link
        href="/driver"
        className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to manifest
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">{order.id}</h2>
          <p className="text-sm text-gray-500 mt-1">
            {order.items.length} item{order.items.length !== 1 ? "s" : ""}{" "}
            &middot; LKR {order.totalPrice.toLocaleString()}
          </p>
        </div>
        <OrderStatusBadge status={order.status} className="text-sm px-3 py-1" />
      </div>

      {/* Customer & Address */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
        <div className="flex items-center gap-2 text-sm">
          <User className="w-4 h-4 text-gray-400" />
          <span className="font-medium text-gray-900">
            {order.customerName}
          </span>
        </div>
        <div className="flex items-start gap-2 text-sm">
          <MapPin className="w-4 h-4 text-gray-400 mt-0.5" />
          <div>
            <p className="text-gray-900">{order.deliveryAddress.street}</p>
            <p className="text-gray-500">
              {order.deliveryAddress.city},{" "}
              {order.deliveryAddress.postalCode},{" "}
              {order.deliveryAddress.country}
            </p>
          </div>
        </div>

        {/* Navigate button (opens in maps) */}
        {order.deliveryAddress.latitude && order.deliveryAddress.longitude && (
          <a
            href={`https://www.google.com/maps/dir/?api=1&destination=${order.deliveryAddress.latitude},${order.deliveryAddress.longitude}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-emerald-600 text-white text-sm rounded-lg hover:bg-emerald-700"
          >
            <Navigation className="w-4 h-4" />
            Navigate
          </a>
        )}
      </div>

      {/* Items */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h3 className="font-semibold text-gray-800 mb-3">Package Contents</h3>
        <div className="divide-y divide-gray-100">
          {order.items.map((item, i) => (
            <div key={i} className="flex items-center justify-between py-2">
              <div className="flex items-center gap-2">
                <Package className="w-4 h-4 text-gray-400" />
                <span className="text-sm text-gray-900">
                  {item.productName}
                </span>
              </div>
              <span className="text-sm text-gray-500">x{item.quantity}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Delivery Actions */}
      {isActionable && (
        <div className="bg-white rounded-xl border-2 border-emerald-200 p-5 space-y-5">
          <h3 className="font-semibold text-gray-800">Delivery Actions</h3>

          {/* Action buttons */}
          <div className="flex gap-3 pt-2">
            <button
              onClick={handleDelivered}
              disabled={submitting}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-green-600 text-white font-semibold rounded-xl hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <CheckCircle className="w-5 h-5" />
              )}
              Mark as Delivered
            </button>

            <button
              onClick={() => setShowFailForm(!showFailForm)}
              className="flex items-center justify-center gap-2 px-4 py-3 bg-red-50 text-red-600 font-semibold rounded-xl hover:bg-red-100 border border-red-200"
            >
              <XCircle className="w-5 h-5" />
              Failed
            </button>
          </div>

          {/* Failure form */}
          {showFailForm && (
            <div className="bg-red-50 rounded-lg p-4 space-y-3 border border-red-200">
              <p className="text-sm font-medium text-red-800">
                Reason for failure:
              </p>
              <div className="space-y-2">
                {FAILURE_REASONS.map((reason) => (
                  <label
                    key={reason}
                    className="flex items-center gap-2 text-sm text-red-700 cursor-pointer"
                  >
                    <input
                      type="radio"
                      name="failureReason"
                      value={reason}
                      checked={failureReason === reason}
                      onChange={(e) => setFailureReason(e.target.value)}
                      className="text-red-600"
                    />
                    {reason}
                  </label>
                ))}
              </div>
              <button
                onClick={handleFailed}
                disabled={submitting || !failureReason}
                className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-red-600 text-white font-medium rounded-lg hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed text-sm"
              >
                {submitting ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  "Confirm Failed Delivery"
                )}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Already delivered */}
      {order.status === "DELIVERED" && order.deliveryProof && (
        <div className="bg-green-50 rounded-xl border border-green-200 p-5 text-center">
          <CheckCircle className="w-12 h-12 text-green-500 mx-auto mb-2" />
          <p className="font-semibold text-green-800">
            Successfully Delivered
          </p>
          {order.deliveryProof.deliveredAt && (
            <p className="text-sm text-green-600 mt-1">
              {new Date(order.deliveryProof.deliveredAt).toLocaleString(
                "en-LK"
              )}
            </p>
          )}
        </div>
      )}

      {order.status === "FAILED" && (
        <div className="bg-red-50 rounded-xl border border-red-200 p-5 text-center">
          <XCircle className="w-12 h-12 text-red-400 mx-auto mb-2" />
          <p className="font-semibold text-red-800">Delivery Failed</p>
        </div>
      )}
    </div>
  );
}
