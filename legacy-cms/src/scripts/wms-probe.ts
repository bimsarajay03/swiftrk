/**
 * =============================================================================
 * WMS PROBE - send one framed request to the WMS simulator and print the reply
 * =============================================================================
 *
 * The WMS protocol has a binary length header, so it is awkward to test with
 * `nc`. This sends one frame and prints both sides as text.
 *
 *   npm run wms:probe -- CHK ORD-123 PROD-001:2 PROD-002:1
 *   npm run wms:probe -- REL ORD-123 WMS-PKG-42
 *   npm run wms:probe -- PNG
 *
 * Host/port come from WMS_TCP_HOST / WMS_TCP_PORT (default localhost:9100).
 * =============================================================================
 */

import * as net from 'net';
import { loadConfig } from '../config';
import {
  FrameDecoder,
  WmsMessageType,
  decodeBody,
  encodeItems,
  encodeMessage,
  escapeField,
} from '../protocols/wms-frame';

function buildFields(type: string, args: string[]): string[] {
  switch (type) {
    case 'CHK': {
      const [orderId, ...items] = args;
      return [
        escapeField(orderId ?? `PROBE-${Date.now()}`),
        encodeItems(
          (items.length ? items : ['PROD-001:1']).map((entry) => {
            const [sku, qty] = entry.split(':');
            return { sku, qty: Number(qty ?? 1) };
          }),
        ),
      ];
    }
    case 'RSV':
    case 'REL':
      return args.map(escapeField);
    case 'PNG':
      return [];
    default:
      throw new Error(`Unknown type ${type}; use CHK, RSV, REL or PNG`);
  }
}

function main() {
  const [type = 'PNG', ...args] = process.argv.slice(2);
  const { wmsTcpHost: host, wmsTcpPort: port } = loadConfig();
  const frame = encodeMessage(
    type as WmsMessageType,
    1,
    buildFields(type, args),
  );

  const socket = net.createConnection({ host, port }, () => {
    console.log(
      `→ ${host}:${port}  [len=${frame.length - 4}] ${frame.subarray(4).toString('utf8')}`,
    );
    socket.write(frame);
  });

  const decoder = new FrameDecoder();
  socket.on('data', (chunk) => {
    for (const body of decoder.push(chunk)) {
      const reply = decodeBody(body);
      console.log(`← [len=${body.length}] ${body.toString('utf8')}`);
      socket.end();
      process.exitCode = reply.type === 'NAK' ? 2 : 0;
    }
  });
  socket.setTimeout(5000, () => {
    console.error('No reply within 5 s');
    socket.destroy();
    process.exitCode = 1;
  });
  socket.on('error', (err) => {
    console.error(`Cannot reach WMS at ${host}:${port}: ${err.message}`);
    process.exitCode = 1;
  });
}

main();
