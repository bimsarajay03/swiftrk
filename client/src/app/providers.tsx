/**
 * Providers - Wraps the app with client-side providers (Toaster for notifications)
 */

"use client";

import { Toaster } from "react-hot-toast";

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Toaster
        position="top-right"
        toastOptions={{
          style: {
            borderRadius: "12px",
            background: "#1e293b",
            color: "#f8fafc",
            fontSize: "14px",
          },
        }}
      />
      {children}
    </>
  );
}
