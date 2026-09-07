"use client";

import { useOrders } from "@/hooks/useOrders";
import { useNotifications } from "@/hooks/useNotifications";
import OrderStatusBadge from "@/components/OrderStatusBadge";
import {
  MapPin,
  Package,
  CheckCircle,
  XCircle,
  Loader2,
  RefreshCw,
  Clock,
} from "lucide-react";
import Link from "next/link";

// Mock driver ID for demo
const DEMO_DRIVER_ID = "DRV-001";

export default function DriverDashboard() {
  const { orders, loading, error, refetch } = useOrders({
    driverId: DEMO_DRIVER_ID,
  });

  // Activate real-time notifications
  useNotifications();

  // Stats
  const stats = {
    total: orders.length,
    pending: orders.filter(
      (o) => o.status === "ASSIGNED" || o.status === "ROS_CONFIRMED"
    ).length,
    inTransit: orders.filter((o) => o.status === "IN_TRANSIT").length,
    delivered: orders.filter((o) => o.status === "DELIVERED").length,
    failed: orders.filter((o) => o.status === "FAILED").length,
  };

  // Sort: IN_TRANSIT first, then ASSIGNED, then rest
  const priorityOrder: Record<string, number> = {
    IN_TRANSIT: 0,
    ASSIGNED: 1,
    ROS_CONFIRMED: 2,
    DELIVERED: 3,
    FAILED: 4,
  };

  const sortedOrders = [...orders].sort(
    (a, b) =>
      (priorityOrder[a.status] ?? 5) - (priorityOrder[b.status] ?? 5)
  );

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <MiniStat label="Total" value={stats.total}/>
        <MiniStat label="Pending" value={stats.pending}/>
        <MiniStat label="In Transit" value={stats.inTransit} />
        <MiniStat label="Delivered" value={stats.delivered}/>
        <MiniStat label="Failed" value={stats.failed}/>
      </div>

      {/* Route summary (mock) */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div>
            <p className="font-semibold text-gray-900">
              Today&apos;s Route
            </p>
            <p className="text-sm text-gray-500">
              {stats.total} deliveries &middot; Optimized by ROS
            </p>
          </div>
        </div>
        <button
          onClick={refetch}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50 cursor-pointer"
        >
          <RefreshCw className="w-4 h-4" />
          Refresh
        </button>
      </div>

      {/* Delivery list */}
      <h3 className="font-semibold text-gray-900">Delivery Manifest</h3>

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="w-8 h-8 animate-spin text-emerald-600" />
        </div>
      ) : error ? (
        <div className="text-center py-16">
          <p className="text-red-500 mb-2">{error}</p>
          <button
            onClick={refetch}
            className="text-sm text-emerald-600 hover:underline"
          >
            Try again
          </button>
        </div>
      ) : sortedOrders.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <Package className="w-12 h-12 mx-auto mb-3 opacity-40" />
          <p>No deliveries assigned yet</p>
        </div>
      ) : (
        <div className="space-y-3">
          {sortedOrders.map((order, i) => (
            <Link key={order.id} href={`/driver/deliveries/${order.id}`} className="block">
              <div className="bg-white rounded-xl border border-gray-200 p-4 hover:border-emerald-300 transition-all cursor-pointer">
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-3">                   
                    <div>
                      <p className="font-semibold text-gray-900">
                        {order.id}
                      </p>
                      <p className="text-sm text-gray-500">
                        {order.customerName}
                      </p>
                      <div className="flex items-center gap-1 mt-1 text-sm text-gray-500">
                        <MapPin className="w-3.5 h-3.5" />
                        {order.deliveryAddress.street},{" "}
                        {order.deliveryAddress.city}
                      </div>
                      {order.estimatedDeliveryTime && (
                        <div className="flex items-center gap-1 mt-0.5 text-xs text-gray-400">
                          <Clock className="w-3 h-3" />
                          ETA:{" "}
                          {new Date(
                            order.estimatedDeliveryTime
                          ).toLocaleTimeString("en-LK", {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-col items-end gap-2">
                    <OrderStatusBadge status={order.status} />
                    <span className="text-xs text-gray-400">
                      {order.items.length} item{order.items.length !== 1 ? "s" : ""}
                    </span>
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function MiniStat({
  label,
  value,
}: {
  label: string;
  value: number;
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-3">
      <p className={`text-2xl font-bold`}>{value}</p>
      <p className="text-xs text-gray-500">{label}</p>
    </div>
  );
}
