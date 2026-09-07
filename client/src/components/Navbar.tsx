/**
 * Navbar - Top navigation bar with app branding and connection status
 */

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import ConnectionStatus from "./ConnectionStatus";

export default function Navbar() {
  const pathname = usePathname();
  const isClient = pathname.startsWith("/client");
  const isDriver = pathname.startsWith("/driver");

  return (
    <nav className="sticky top-0 z-50 bg-white/80 backdrop-blur-md border-b border-gray-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2">
            <span className="text-xl  text-gray-900">
              SwiftTrack
            </span>
          </Link>

          {/* Center nav */}
          <div className="flex items-center gap-1">
            <Link
              href="/client"
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                isClient
                  ? "bg-blue-50 text-blue-700"
                  : "text-gray-600 hover:bg-gray-100"
              }`}
            >
              Client Portal
            </Link>
            <Link
              href="/driver"
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                isDriver
                  ? "bg-blue-50 text-blue-700"
                  : "text-gray-600 hover:bg-gray-100"
              }`}
            >
              Driver App
            </Link>
          </div>

          {/* Status */}
          <ConnectionStatus />
        </div>
      </div>
    </nav>
  );
}
