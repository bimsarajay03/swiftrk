/**
 * =============================================================================
 * CREATE NEW ORDER PAGE
 * =============================================================================
 *
 * Form for clients to submit a new order.
 * Sends a POST request to the API Gateway which then pushes
 * the order into RabbitMQ for Saga processing.
 * =============================================================================
 */

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { CreateOrderDto, OrderItem, DeliveryAddress } from "@/lib/types";
import { ArrowLeft, Plus, Trash2, Send, Loader2 } from "lucide-react";
import Link from "next/link";
import toast from "react-hot-toast";

const DEMO_CUSTOMER_ID = "CUST-001";

export default function NewOrderPage() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);

  const [customerName, setCustomerName] = useState("John Doe");
  const [customerEmail, setCustomerEmail] = useState("john@example.com");

  const [items, setItems] = useState<OrderItem[]>([
    { productId: "PROD-001", productName: "", quantity: 1, unitPrice: 0 },
  ]);

  const [address, setAddress] = useState<DeliveryAddress>({
    street: "",
    city: "Colombo",
    postalCode: "",
    country: "Sri Lanka",
  });

  const addItem = () => {
    setItems([
      ...items,
      {
        productId: `PROD-${String(items.length + 1).padStart(3, "0")}`,
        productName: "",
        quantity: 1,
        unitPrice: 0,
      },
    ]);
  };

  const removeItem = (index: number) => {
    if (items.length <= 1) return;
    setItems(items.filter((_, i) => i !== index));
  };

  const updateItem = (index: number, field: keyof OrderItem, value: string | number) => {
    const updated = [...items];
    updated[index] = { ...updated[index], [field]: value };
    setItems(updated);
  };

  const totalPrice = items.reduce(
    (sum, item) => sum + item.quantity * item.unitPrice,
    0
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Validate
    if (!customerName.trim()) return toast.error("Customer name is required");
    if (items.some((item) => !item.productName.trim()))
      return toast.error("All items need a product name");
    if (items.some((item) => item.unitPrice <= 0))
      return toast.error("All items need a price > 0");
    if (!address.street.trim()) return toast.error("Street address is required");

    const dto: CreateOrderDto = {
      customerId: DEMO_CUSTOMER_ID,
      customerName: customerName.trim(),
      customerEmail: customerEmail.trim(),
      items: items.map((item) => ({
        ...item,
        productName: item.productName.trim(),
      })),
      deliveryAddress: address,
    };

    try {
      setSubmitting(true);
      const response = await api.createOrder(dto);
      toast.success(`Order ${response.order?.id || ""} created successfully!`);
      router.push("/client");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to create order"
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto">
      {/* Back link */}
      <Link
        href="/client"
        className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-6"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to dashboard
      </Link>

      <h2 className="text-xl font-bold text-gray-900 mb-6">
        Submit New Order
      </h2>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Customer Info */}
        <section className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
          <h3 className="font-semibold text-gray-800">Customer Information</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Name
              </label>
              <input
                type="text"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Email
              </label>
              <input
                type="email"
                value={customerEmail}
                onChange={(e) => setCustomerEmail(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                required
              />
            </div>
          </div>
        </section>

        {/* Order Items */}
        <section className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-gray-800">Order Items</h3>
            <button
              type="button"
              onClick={addItem}
              className="flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700"
            >
              <Plus className="w-4 h-4" />
              Add Item
            </button>
          </div>

          <div className="space-y-3">
            {items.map((item, i) => (
              <div
                key={i}
                className="grid grid-cols-12 gap-2 items-end border-b border-gray-100 pb-3"
              >
                <div className="col-span-5">
                  <label className="block text-xs text-gray-500 mb-1">
                    Product Name
                  </label>
                  <input
                    type="text"
                    value={item.productName}
                    onChange={(e) =>
                      updateItem(i, "productName", e.target.value)
                    }
                    placeholder="e.g. Laptop"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                    required
                  />
                </div>
                <div className="col-span-2">
                  <label className="block text-xs text-gray-500 mb-1">
                    Qty
                  </label>
                  <input
                    type="number"
                    min="1"
                    value={item.quantity}
                    onChange={(e) =>
                      updateItem(i, "quantity", parseInt(e.target.value) || 1)
                    }
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  />
                </div>
                <div className="col-span-3">
                  <label className="block text-xs text-gray-500 mb-1">
                    Unit Price (LKR)
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={item.unitPrice}
                    onChange={(e) =>
                      updateItem(
                        i,
                        "unitPrice",
                        parseFloat(e.target.value) || 0
                      )
                    }
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  />
                </div>
                <div className="col-span-2 flex justify-end">
                  <button
                    type="button"
                    onClick={() => removeItem(i)}
                    disabled={items.length <= 1}
                    className="p-2 text-red-400 hover:text-red-600 disabled:opacity-30"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="text-right text-sm font-medium text-gray-700">
            Total:{" "}
            <span className="text-lg text-gray-900">
              LKR {totalPrice.toLocaleString()}
            </span>
          </div>
        </section>

        {/* Delivery Address */}
        <section className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
          <h3 className="font-semibold text-gray-800">Delivery Address</h3>
          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Street
              </label>
              <input
                type="text"
                value={address.street}
                onChange={(e) =>
                  setAddress({ ...address, street: e.target.value })
                }
                placeholder="123 Main St"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                required
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  City
                </label>
                <input
                  type="text"
                  value={address.city}
                  onChange={(e) =>
                    setAddress({ ...address, city: e.target.value })
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Postal Code
                </label>
                <input
                  type="text"
                  value={address.postalCode}
                  onChange={(e) =>
                    setAddress({ ...address, postalCode: e.target.value })
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Country
                </label>
                <input
                  type="text"
                  value={address.country}
                  onChange={(e) =>
                    setAddress({ ...address, country: e.target.value })
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                />
              </div>
            </div>
          </div>
        </section>

        {/* Submit */}
        <button
          type="submit"
          disabled={submitting}
          className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-blue-600 text-white font-semibold rounded-xl hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {submitting ? (
            <Loader2 className="w-5 h-5 animate-spin" />
          ) : (
            <Send className="w-5 h-5" />
          )}
          {submitting ? "Submitting..." : "Submit Order"}
        </button>
      </form>
    </div>
  );
}
