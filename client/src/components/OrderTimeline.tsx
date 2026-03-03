/**
 * OrderTimeline - Shows the saga step progression of an order
 *
 * Visually displays each step the order went through in the
 * Saga Pattern: CMS → WMS → ROS → Assigned → Delivered
 */

import { SagaStep } from "@/lib/types";
import { CheckCircle, XCircle, Clock, RotateCcw } from "lucide-react";

interface Props {
  steps: SagaStep[];
}

const stepIcon = {
  PENDING: <Clock className="w-5 h-5 text-yellow-500" />,
  SUCCESS: <CheckCircle className="w-5 h-5 text-green-500" />,
  FAILED: <XCircle className="w-5 h-5 text-red-500" />,
  COMPENSATED: <RotateCcw className="w-5 h-5 text-orange-500" />,
};

export default function OrderTimeline({ steps }: Props) {
  if (!steps || steps.length === 0) {
    return (
      <div className="text-sm text-gray-400 italic">
        No processing steps recorded yet.
      </div>
    );
  }

  return (
    <div className="space-y-0">
      {steps.map((step, i) => (
        <div key={i} className="flex gap-3">
          {/* Vertical line + icon */}
          <div className="flex flex-col items-center">
            <div className="mt-1">{stepIcon[step.status]}</div>
            {i < steps.length - 1 && (
              <div className="w-0.5 flex-1 bg-gray-200 my-1" />
            )}
          </div>

          {/* Content */}
          <div className="pb-5">
            <p className="text-sm font-medium text-gray-900">
              [{step.service}] {step.action}
            </p>
            <p className="text-xs text-gray-500">
              {new Date(step.timestamp).toLocaleString("en-LK")}
            </p>
            {step.error && (
              <p className="text-xs text-red-600 mt-0.5">{step.error}</p>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
