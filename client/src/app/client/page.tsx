"use client";

import { useState } from "react";
import { useOrders } from "@/hooks/useOrders";
import { useNotifications } from "@/hooks/useNotifications";
import OrderCard from "@/components/OrderCard";
import { Plus, Package, Truck, CheckCircle, Loader2, RefreshCw } from "lucide-react";
import Link from "next/link";

// Mock customer ID for demo — in production, comes from authentication
const DEMO_CUSTOMER_ID = "CUST-001";

export default function ClientDashboard() {
  const { orders, loading, error, refetch } = useOrders({
    customerId: DEMO_CUSTOMER_ID,
  });
  const [filterStatus, setFilterStatus] = useState<string>("ALL");

  // Activate real-time notifications
  useNotifications();

  // Calculate stats
  const stats = {
    total: orders.length,
    inTransit: orders.filter((o) => o.status === "IN_TRANSIT" || o.status === "ASSIGNED").length,
    delivered: orders.filter((o) => o.status === "DELIVERED").length,
    processing: orders.filter((o) =>
      ["PENDING", "CMS_PROCESSING", "CMS_CONFIRMED", "WMS_PROCESSING", "WMS_CONFIRMED", "ROS_PROCESSING", "ROS_CONFIRMED"].includes(o.status)
    ).length,
  };

  // Filter orders
  const filteredOrders =
    filterStatus === "ALL"
      ? orders
      : orders.filter((o) => {
          if (filterStatus === "PROCESSING")
            return ["PENDING", "CMS_PROCESSING", "CMS_CONFIRMED", "WMS_PROCESSING", "WMS_CONFIRMED", "ROS_PROCESSING", "ROS_CONFIRMED"].includes(o.status);
          if (filterStatus === "IN_TRANSIT")
            return o.status === "IN_TRANSIT" || o.status === "ASSIGNED";
          return o.status === filterStatus;
        });

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Total Orders" value={stats.total} />
        <StatCard label="Processing" value={stats.processing} />
        <StatCard label="In Transit" value={stats.inTransit} />
        <StatCard label="Delivered" value={stats.delivered} />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-2"></div>

        <div className="flex gap-2">
          <button
            onClick={refetch}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50 cursor-pointer"
          >
            <RefreshCw className="w-4 h-4" />
            Refresh
          </button>
          <Link
            href="/client/orders/new"
            className="flex items-center gap-1.5 px-4 py-1.5 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 font-medium"
          >
            <Plus className="w-4 h-4" />
            New Order
          </Link>
        </div>
      </div>

      {/* Order list */}
      {loading ? (
        <div className="flex justify-center py-20">
          <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
        </div>
      ) : error ? (
        <div className="text-center py-20">
          <p className="text-red-500 mb-2">{error}</p>
          <button
            onClick={refetch}
            className="text-sm text-blue-600 hover:underline"
          >
            Try again
          </button>
        </div>
      ) : filteredOrders.length === 0 ? (
        <div className="text-center py-20 text-gray-400">
          <Package className="w-12 h-12 mx-auto mb-3 opacity-40" />
          <p>No orders found</p>
          <Link
            href="/client/orders/new"
            className="text-sm text-blue-600 hover:underline mt-2 inline-block"
          >
            Create your first order
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredOrders.map((order) => (
            <OrderCard key={order.id} order={order} linkPrefix="/client/orders" />
          ))}
        </div>
      )}
    </div>
  );
}

// Small stat card component
function StatCard({
  label,
  value,
}: {
  label: string;
  value: number;
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 flex items-center gap-4">
      <div>
        <p className="text-2xl font-bold">{value}</p>
        <p className="text-xs">{label}</p>
      </div>
    </div>
  );
}
