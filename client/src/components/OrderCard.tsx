/**
 * OrderCard - Displays a summary card for a single order
 */

import Link from "next/link";
import { Order } from "@/lib/types";
import OrderStatusBadge from "./OrderStatusBadge";
import { Package, MapPin, Clock} from "lucide-react";

interface Props {
  order: Order;
  linkPrefix?: string; // "/client/orders" or "/driver/deliveries"
}

export default function OrderCard({ order, linkPrefix = "/client/orders" }: Props) {
  const formattedDate = new Date(order.createdAt).toLocaleDateString("en-LK", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <Link href={`${linkPrefix}/${order.id}`}>
      <div className="bg-white rounded-xl border border-gray-200 p-5 hover:border-blue-300 transition-all cursor-pointer">
        <div className="flex items-start justify-between mb-3">
          <div>
            <h3 className="font-semibold text-gray-900">{order.id}</h3>
            <p className="text-sm text-gray-500">{order.customerName}</p>
          </div>
          <OrderStatusBadge status={order.status} />
        </div>

        <div className="space-y-2 text-sm text-gray-600">
          <div className="flex items-center gap-2">
            <Package className="w-4 h-4 text-gray-400" />
            <span>
              {order.items.length} item{order.items.length !== 1 ? "s" : ""} —{" "}
              <span className="font-medium text-gray-900">
                LKR {order.totalPrice.toLocaleString()}
              </span>
            </span>
          </div>

          <div className="flex items-center gap-2">
            <MapPin className="w-4 h-4 text-gray-400" />
            <span>
              {order.deliveryAddress.street}, {order.deliveryAddress.city}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-gray-400" />
            <span>{formattedDate}</span>
          </div>
        </div>
      </div>
    </Link>
  );
}
