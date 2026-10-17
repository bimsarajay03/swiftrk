import { Module } from '@nestjs/common';
import { LegacyMockController } from './legacy-mock.controller';
import { loadConfig } from './config';
import { CmsSoapAdapter } from './adapters/cms-soap.adapter';
import { WmsTcpAdapter } from './adapters/wms-tcp.adapter';
import { RosRestAdapter } from './adapters/ros-rest.adapter';

/**
 * main.ts creates this module once per queue (cms/wms/ros), so each of the
 * three microservices gets its own adapter instances. The WMS adapter connects
 * lazily, so only the instance that actually handles wms_* messages opens a
 * TCP connection.
 */
@Module({
  controllers: [LegacyMockController],
  providers: [
    {
      provide: CmsSoapAdapter,
      useFactory: () => {
        const config = loadConfig();
        return new CmsSoapAdapter({
          url: config.cmsSoapUrl,
          timeoutMs: config.adapterTimeoutMs,
        });
      },
    },
    {
      provide: WmsTcpAdapter,
      useFactory: () => {
        const config = loadConfig();
        return new WmsTcpAdapter({
          host: config.wmsTcpHost,
          port: config.wmsTcpPort,
          timeoutMs: config.adapterTimeoutMs,
        });
      },
    },
    {
      provide: RosRestAdapter,
      useFactory: () => {
        const config = loadConfig();
        return new RosRestAdapter({
          baseUrl: config.rosBaseUrl,
          apiKey: config.rosApiKey,
          timeoutMs: config.adapterTimeoutMs,
        });
      },
    },
  ],
})
export class LegacyMockModule {}
