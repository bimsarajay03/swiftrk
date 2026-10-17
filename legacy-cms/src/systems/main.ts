/**
 * =============================================================================
 * LEGACY SYSTEM SIMULATORS - CMS, WMS, ROS
 * =============================================================================
 *
 * Stand-ins for the three back-office systems, each speaking its native
 * protocol. They know nothing about RabbitMQ; the adapters in ../adapters
 * call them over the network.
 *
 * CMS (SOAP/XML over HTTP) -> :8081  POST /cms/soap
 * WMS (framed TCP)         -> :9100
 * ROS (REST/JSON)          -> :8082  /api/v1/routes
 *
 * Runs as its own container (`legacy-systems`) so every adapter call really
 * crosses the network.
 * =============================================================================
 */

import { Logger } from '@nestjs/common';
import { loadConfig } from '../config';
import { startCmsServer } from './cms-soap.server';
import { startWmsServer } from './wms-tcp.server';
import { startRosServer } from './ros-rest.server';

async function bootstrap() {
  const logger = new Logger('LegacySystems');
  const config = loadConfig();

  const cms = await startCmsServer({ port: config.cmsPort });
  logger.log(`CMS SOAP endpoint on http://0.0.0.0:${cms.port}/cms/soap`);

  const wms = await startWmsServer({
    port: config.wmsPort,
    oosRate: config.wmsOosRate,
  });
  logger.log(
    `WMS TCP server on 0.0.0.0:${wms.port} (out-of-stock rate ${config.wmsOosRate})`,
  );

  const ros = await startRosServer({
    port: config.rosPort,
    apiKey: config.rosApiKey,
    latencyMs: config.rosLatencyMs,
  });
  logger.log(`ROS REST API on http://0.0.0.0:${ros.port}/api/v1`);

  const shutdown = async (signal: string) => {
    logger.log(`${signal} received, shutting down`);
    await Promise.all([cms.close(), wms.close(), ros.close()]);
    process.exit(0);
  };
  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
}

bootstrap().catch((err) => {
  console.error('Failed to start legacy system simulators:', err);
  process.exit(1);
});
