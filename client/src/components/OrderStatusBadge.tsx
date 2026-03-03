/**
 * OrderStatusBadge - Displays order status as a color-coded pill
 */

import { OrderStatus, STATUS_LABELS, STATUS_COLORS } from "@/lib/types";

interface Props {
  status: OrderStatus;
  className?: string;
}

export default function OrderStatusBadge({ status, className = "" }: Props) {
  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[status] || "bg-gray-100 text-gray-800"} ${className}`}
    >
      {STATUS_LABELS[status] || status}
    </span>
  );
}
