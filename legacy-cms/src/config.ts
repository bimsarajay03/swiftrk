/**
 * =============================================================================
 * LEGACY INTEGRATION CONFIG
 * =============================================================================
 *
 * Environment variables for both roles in this package:
 *   - adapters   (src/main.ts)          : where to reach each legacy system
 *   - simulators (src/systems/main.ts)  : which ports the fake systems listen on
 *
 * Defaults suit running everything on a laptop; docker-compose overrides the
 * hostnames with the `legacy-systems` service name.
 * =============================================================================
 */

export interface LegacyConfig {
  // Adapters
  cmsSoapUrl: string;
  wmsTcpHost: string;
  wmsTcpPort: number;
  rosBaseUrl: string;
  rosApiKey: string;
  adapterTimeoutMs: number;

  // Simulators
  cmsPort: number;
  wmsPort: number;
  rosPort: number;
  wmsOosRate: number;
  rosLatencyMs: number;
}

function num(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): LegacyConfig {
  return {
    cmsSoapUrl: env.CMS_SOAP_URL || 'http://localhost:8081/cms/soap',
    wmsTcpHost: env.WMS_TCP_HOST || 'localhost',
    wmsTcpPort: num(env.WMS_TCP_PORT, 9100),
    rosBaseUrl: env.ROS_BASE_URL || 'http://localhost:8082',
    rosApiKey: env.ROS_API_KEY || 'dev-ros-key',
    adapterTimeoutMs: num(env.ADAPTER_TIMEOUT_MS, 10000),

    cmsPort: num(env.CMS_PORT, 8081),
    wmsPort: num(env.WMS_PORT, 9100),
    rosPort: num(env.ROS_PORT, 8082),
    wmsOosRate: num(env.WMS_OOS_RATE, 0.1),
    rosLatencyMs: num(env.ROS_LATENCY_MS, 0),
  };
}
