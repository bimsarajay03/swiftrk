/**
 * ConnectionStatus - Shows Socket.io connection state
 */

"use client";

import { useSocket } from "@/hooks/useSocket";
import { Wifi, WifiOff } from "lucide-react";

export default function ConnectionStatus() {
  const { isConnected } = useSocket();

  return (
    <div className="flex items-center gap-1.5 text-xs">
      {isConnected ? (
        <>
          <Wifi className="w-3.5 h-3.5 text-green-500" />
          <span className="text-green-600">Live</span>
        </>
      ) : (
        <>
          <WifiOff className="w-3.5 h-3.5 text-red-400" />
          <span className="text-red-500">Offline</span>
        </>
      )}
    </div>
  );
}
