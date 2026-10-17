# Legacy Mocks: Real Protocol Implementation Plan

Today the CMS, WMS and ROS mocks ([legacy-mock.controller.ts](../legacy-cms/src/legacy-mock.controller.ts))
take JSON from RabbitMQ and send JSON back. The SOAP/XML, TCP and REST labels appear only in
comments and log strings ([system.md §12](system.md), gap 1). This plan makes each mock speak
its system's real protocol, so the platform actually bridges three formats (requirement N1).

## 1. Goal and scope

**Goal:** each legacy call in the saga goes through its native protocol on a real network hop:

- **CMS:** SOAP 1.1 envelope over HTTP POST, XML reply, SOAP Faults for errors.
- **WMS:** a proprietary length-prefixed TCP frame format on a persistent socket.
- **ROS:** a REST/JSON HTTP API, called with `fetch`, using an API key.

**Unchanged:** the Order Service and the saga. Queue names, message patterns, request payloads
and reply shapes all stay the same. The protocol change happens behind the queues, so
[saga-orchestrator.service.ts](../order-service/src/saga/saga-orchestrator.service.ts) is not touched.

**Out of scope:** WSDL-generated clients, WS-Security, TLS, retrying failed compensations,
resuming a saga after a crash (gaps 9 and 12 stay open).

## 2. Target architecture

```
Order Service (saga)
   │  RabbitMQ: cms_queue / wms_queue / ros_queue   (canonical JSON, unchanged)
   ▼
legacy-mock container ─ ADAPTERS (Channel Adapter + Message Translator)
   │ CmsSoapAdapter ──HTTP POST text/xml──────────────▶ CMS SOAP server   :8081
   │ WmsTcpAdapter  ──TCP, length-prefixed frames─────▶ WMS TCP server    :9100
   │ RosRestAdapter ──HTTP JSON + X-API-Key───────────▶ ROS REST server   :8082
   ▼                                                  legacy-systems container ─ SIMULATORS
canonical JSON reply back over RabbitMQ (direct reply-to)
```

There are two roles, built from the same `legacy-cms` package:

| Role | Container | Entry point | Job |
| --- | --- | --- | --- |
| Adapters | `legacy-mock` (existing) | `dist/main.js` | Consume queues, translate JSON to the native protocol, call the simulator, translate the reply back |
| Simulators | `legacy-systems` (new) | `dist/systems/main.js` | Stand in for the real third-party and on-prem systems; know nothing about RabbitMQ |

The simulators run in their own container so each call really crosses the Docker network.
If CMS, WMS and ROS ran in the adapters' own process, the "protocol" would only be a loopback
call inside one Node process, and stopping the container would no longer demonstrate a legacy
outage (§8).

## 3. File layout

```
legacy-cms/src/
  main.ts                         # unchanged: 3 RMQ microservices (cms/wms/ros queues)
  legacy-mock.module.ts           # + providers: CmsSoapAdapter, WmsTcpAdapter, RosRestAdapter
  legacy-mock.controller.ts       # handlers become async and delegate to adapters, then ack
  config.ts                       # env vars with defaults (§7)
  adapters/
    cms-soap.adapter.ts
    wms-tcp.adapter.ts
    ros-rest.adapter.ts
    adapter-error.ts              # maps transport/protocol errors → canonical error codes
  protocols/
    soap.ts                       # envelope build + parse, fault build + parse
    wms-frame.ts                  # encode/decode, FrameDecoder (stream reassembly), field escaping
  systems/
    main.ts                       # starts all three simulators
    cms-soap.server.ts
    wms-tcp.server.ts
    ros-rest.server.ts
  scripts/wms-probe.ts            # CLI: send one WMS frame, print the reply
  **/*.spec.ts                    # tests sit next to the code (jest rootDir is src/)
```

> Implemented. Tests and the probe live under `src/` rather than `test/` and `scripts/`:
> jest only scans `src/`, and a `.ts` file outside `src/` would move the build output to
> `dist/src/` and break `node dist/main`.

Adapters and simulators share the codecs in `protocols/`. That is convenient, but a codec bug
would then be symmetric: both sides would agree on the wrong bytes. The codec tests therefore
check against **fixed expected bytes and XML strings** (golden fixtures), not only round trips.

**Dependencies to add** to [legacy-cms/package.json](../legacy-cms/package.json):

- `fast-xml-parser`: XML building and parsing for SOAP. Use it instead of the `soap` package,
  which is driven by WSDL and hides the envelope, which is the part we want to show.
- `express`: HTTP for the CMS and ROS simulators. It is already installed transitively through
  `@nestjs/platform-express`; list it explicitly.
- No TCP or HTTP client library: Node's `net` module and global `fetch` (Node 18+) are enough.

## 4. Canonical contract (must not change)

The adapters receive exactly what the saga sends today and must return exactly what it reads.

| Pattern | Request from saga | Reply the saga reads |
| --- | --- | --- |
| `cms_create_order` | `orderId, customerId, customerName, customerEmail, items[], totalPrice` | `{ success, cmsOrderId?, error?, message }` |
| `cms_cancel_order` | `orderId, cmsOrderId` | `{ success, error?, message }` |
| `wms_check_stock` | `orderId, items[{productId, quantity}]` | `{ success, inStock, wmsPackageId?, error?, message }` |
| `wms_reserve_stock` | `orderId` (not called by the saga; implement for completeness) | `{ success, error?, message }` |
| `wms_release_stock` | `orderId, wmsPackageId` | `{ success, error?, message }` |
| `ros_optimize_route` | `orderId, deliveryAddress, items[]` | `{ success, rosRouteId?, estimatedDeliveryTime?, optimizedRoute?, error?, message }` |
| `ros_cancel_route` | `orderId, rosRouteId` | `{ success, error?, message }` |

`optimizedRoute` keeps its current shape `{ waypoints[{lat,lng,address}], totalDistance, totalDuration }`
([shared/interfaces.ts](../shared/interfaces.ts) `RosResponse`).

The native formats deliberately use **different field names** from the canonical ones
(`ClientRef`, `Sku`, `distanceKm`, …), so the adapters do real translation instead of copying
JSON through.

## 5. Per-system design

### 5.1 CMS: SOAP 1.1 over HTTP

**Simulator** (`systems/cms-soap.server.ts`, port 8081)

- `POST /cms/soap`, `Content-Type: text/xml; charset=utf-8`, `SOAPAction` header selects the
  operation: `urn:swifttrack:cms#CreateOrder` or `urn:swifttrack:cms#CancelOrder`.
- Body parsed with `express.text({ type: ['text/xml', 'application/soap+xml'] })`.
- Keeps an in-memory `Map<orderRef, cmsOrderId>`:
  - `CreateOrder` for an `OrderRef` it has already seen returns the **same** `CmsOrderId`. Saga
    redeliveries then do not create duplicate CMS orders.
  - `CancelOrder` for an unknown `CmsOrderId` returns a SOAP Fault.
- Errors use HTTP 500 with a `soapenv:Fault` body (the SOAP 1.1 convention).
- Optional extra: `GET /cms/soap?wsdl` serves a static, hand-written WSDL describing the two operations.

Request built by the adapter:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
                  xmlns:cms="urn:swifttrack:cms">
  <soapenv:Header/>
  <soapenv:Body>
    <cms:CreateOrderRequest>
      <cms:OrderRef>ORD-1729150000000-1234</cms:OrderRef>
      <cms:Client>
        <cms:ClientId>CUST-001</cms:ClientId>
        <cms:ClientName>Jane Perera</cms:ClientName>
        <cms:ClientEmail>jane@example.com</cms:ClientEmail>
      </cms:Client>
      <cms:LineItems>
        <cms:Item><cms:Sku>PROD-001</cms:Sku><cms:Description>Box</cms:Description>
                  <cms:Qty>2</cms:Qty><cms:UnitPrice>1500.00</cms:UnitPrice></cms:Item>
      </cms:LineItems>
      <cms:TotalAmount currency="LKR">3000.00</cms:TotalAmount>
    </cms:CreateOrderRequest>
  </soapenv:Body>
</soapenv:Envelope>
```

Success reply:

```xml
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:cms="urn:swifttrack:cms">
  <soapenv:Body>
    <cms:CreateOrderResponse>
      <cms:Status>ACCEPTED</cms:Status>
      <cms:CmsOrderId>CMS-1729150000123-0042</cms:CmsOrderId>
    </cms:CreateOrderResponse>
  </soapenv:Body>
</soapenv:Envelope>
```

Fault:

```xml
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
  <soapenv:Body>
    <soapenv:Fault>
      <faultcode>soapenv:Client</faultcode>
      <faultstring>Unknown CmsOrderId CMS-…</faultstring>
      <detail><cms:ErrorCode xmlns:cms="urn:swifttrack:cms">CMS_ORDER_NOT_FOUND</cms:ErrorCode></detail>
    </soapenv:Fault>
  </soapenv:Body>
</soapenv:Envelope>
```

**Adapter** (`adapters/cms-soap.adapter.ts`)

| Canonical | SOAP |
| --- | --- |
| `orderId` | `OrderRef` |
| `customerId / customerName / customerEmail` | `Client/ClientId / ClientName / ClientEmail` |
| `items[].productId / productName / quantity / unitPrice` | `LineItems/Item/Sku / Description / Qty / UnitPrice` |
| `totalPrice` | `TotalAmount` (2 decimal places) |
| reply `CmsOrderId` | `cmsOrderId` |
| reply `Fault/detail/ErrorCode` | `error` (fallback `CMS_FAULT`) |

Parser gotchas (`fast-xml-parser`):

- Set `removeNSPrefix: true` so the adapter reads `Envelope.Body.CreateOrderResponse` without caring which prefix the server used.
- Set `isArray: (name) => name === 'Item'`. Otherwise a single item parses as an object, not an array.
- Let the builder escape text (`&`, `<` in customer names). Never build XML with template strings.
- Check for `Body.Fault` **before** looking for the response element, whatever the HTTP status.

### 5.2 WMS: proprietary TCP

**Frame format.** Every message, in both directions, is:

```
┌───────────────┬────────────────────────────────────────────┐
│ length: u32 BE│ body: UTF-8, `|`-separated fields          │
│ (body bytes)  │ TYPE|SEQ|field3|field4|...                  │
└───────────────┴────────────────────────────────────────────┘
```

- `SEQ` is a client-chosen integer that the server echoes back. Several requests can then share
  one socket, and replies are matched to requests by `SEQ`, not by arrival order.
- Field escaping: `%` → `%25`, `|` → `%7C`, `,` → `%2C`, `:` → `%3A`. This is required because
  `productId` is only validated as a non-empty string
  ([create-order.dto.ts](../api-gateway/src/orders/dto/create-order.dto.ts)), so a user can put a `|` in it.
- Maximum body size 64 KiB. A larger length header makes the receiver close the socket
  (protection against a corrupt stream).

| Request | Meaning | Success reply | Failure reply |
| --- | --- | --- | --- |
| `CHK\|seq\|orderId\|sku:qty,sku:qty` | Check and hold stock | `ACK\|seq\|OK\|WMS-PKG-1234` | `NAK\|seq\|OUT_OF_STOCK\|sku` |
| `RSV\|seq\|orderId` | Reserve (unused by saga) | `ACK\|seq\|OK` | `NAK\|seq\|NOT_FOUND` |
| `REL\|seq\|orderId\|pkgId` | Release held stock | `ACK\|seq\|OK` | `NAK\|seq\|NOT_FOUND` |
| `PNG\|seq` | Heartbeat | `PON\|seq` | — |
| anything else | | | `NAK\|seq\|BAD_REQUEST` |

**Simulator** (`systems/wms-tcp.server.ts`, port 9100)

- `net.createServer`. Each socket gets its own `FrameDecoder`.
- In-memory `Map<orderId, pkgId>`, so `REL` on an unknown order returns `NAK NOT_FOUND`, and a
  repeated `CHK` for the same order returns the same package ID.
- Out-of-stock rules, which keep today's demo behaviour and add a deterministic trigger:
  - any line with `qty >= 100` is always out of stock (for scripted demos and tests);
  - otherwise random, with probability `WMS_OOS_RATE` (default `0.1`, the current rate).
    Set it to `0` in tests.

**Adapter** (`adapters/wms-tcp.adapter.ts`)

- One **persistent** connection, opened lazily on first use. `main.ts` builds `LegacyMockModule`
  three times (once per queue), so a connection opened in the constructor would create three
  sockets. Opening lazily means only the WMS handlers ever connect.
- `pending: Map<seq, {resolve, reject, timer}>`. Each request has a 10 s timeout (below the
  saga's 30 s) that rejects with `WMS_TIMEOUT`.
- On `close` or `error`, reject every pending request with `WMS_UNAVAILABLE`, then reconnect
  with backoff (0.5 s, 1 s, 2 s, capped at 10 s). Do not retry requests automatically: a `CHK`
  might have been applied before the socket dropped.
- `FrameDecoder` (in `protocols/wms-frame.ts`) buffers incoming chunks and emits complete
  frames. It must handle: one frame split across several `data` events, several frames in one
  event, and a length header that is itself split. This is the most common bug in
  hand-written TCP code; test it directly (§9).
- Optional: send `PNG` every 15 s while idle, to detect a dead peer faster than TCP keepalive does.

| Canonical | TCP |
| --- | --- |
| `wms_check_stock {orderId, items}` | `CHK\|seq\|orderId\|productId:quantity,...` |
| `ACK…OK\|pkg` | `{ success: true, inStock: true, wmsPackageId: pkg }` |
| `NAK…OUT_OF_STOCK\|sku` | `{ success: false, inStock: false, error: 'OUT_OF_STOCK', message: 'Out of stock: <sku>' }` |
| `wms_release_stock {orderId, wmsPackageId}` | `REL\|seq\|orderId\|wmsPackageId` |

### 5.3 ROS: REST/JSON over HTTP

**Simulator** (`systems/ros-rest.server.ts`, port 8082, Express)

| Method | Path | Body / reply | Status codes |
| --- | --- | --- | --- |
| `POST` | `/api/v1/routes` | in: `{ reference, origin{lat,lng,label}, destination{lat,lng,label}, parcelCount }` · out: `{ routeId, eta, legs[{lat,lng,label}], distanceKm, durationMin }` | 201, 400 bad body, 401 bad key |
| `DELETE` | `/api/v1/routes/:routeId` | — | 204, 404 unknown, 401 |
| `GET` | `/health` | `{ status: 'ok' }` | 200 |

- Auth: `X-API-Key` header must equal `ROS_API_KEY`; otherwise 401 `{ error: 'UNAUTHORIZED' }`.
- Routes are stored in memory, so a `DELETE` of an unknown route returns 404.
- The route data stays as it is today (warehouse at 6.9271, 79.8612, destination from the address
  or a Colombo fallback, ETA 45 min out, random distance and duration); only the transport changes.
- Optional: `ROS_LATENCY_MS` to add an artificial delay, which makes the asynchronous saga visible in the UI.

**Adapter** (`adapters/ros-rest.adapter.ts`)

- `fetch(url, { method, headers: { 'Content-Type': 'application/json', 'X-API-Key': key }, signal: AbortSignal.timeout(10_000) })`.
- Translation:

| Canonical | REST |
| --- | --- |
| `orderId` | `reference` |
| `deliveryAddress.{latitude,longitude}` | `destination.{lat,lng}` (fallback 6.93, 79.87) |
| `deliveryAddress.street + city` | `destination.label` |
| `items.length` | `parcelCount` |
| reply `routeId / eta / legs / distanceKm / durationMin` | `rosRouteId / estimatedDeliveryTime / optimizedRoute.waypoints / totalDistance / totalDuration` |

- Status mapping: 2xx → success. 404 on `DELETE` → **success** (the route is already gone,
  so compensation is idempotent). Other 4xx → `ROS_REJECTED:<status>`. 5xx and network errors →
  `ROS_UNAVAILABLE`. Abort → `ROS_TIMEOUT`.

## 6. Controller changes and error handling

[legacy-mock.controller.ts](../legacy-cms/src/legacy-mock.controller.ts) becomes a thin layer:

```ts
@MessagePattern('cms_create_order')
async handleCmsCreateOrder(@Payload() data: CmsCreateOrderCommand, @Ctx() context: RmqContext) {
  try {
    return await this.cms.createOrder(data);   // returns the canonical reply
  } finally {
    this.ack(context);
  }
}
```

- **Ack timing:** ack once the adapter call has finished (success or translated failure), not
  before it starts. If the adapter process crashes mid-call, the message is then redelivered.
  This is safe because the simulators handle repeated `orderId`s idempotently (§5.1, §5.2).
- **Never throw back to the saga.** Each adapter catches everything and returns
  `{ success: false, error: <code>, message }`. The saga already treats `success: false` as a
  failed step and compensates.
- **Error codes** (`adapters/adapter-error.ts`): `CMS_UNAVAILABLE`, `CMS_TIMEOUT`, `CMS_FAULT`
  (or the fault's `ErrorCode`), `WMS_UNAVAILABLE`, `WMS_TIMEOUT`, `OUT_OF_STOCK`,
  `ROS_UNAVAILABLE`, `ROS_TIMEOUT`, `ROS_REJECTED:<status>`.
- **Timeouts:** every adapter uses 10 s, so the saga gets a clear error code instead of hitting
  its own 30 s RxJS timeout.
- **Logging:** log the native request and reply at `debug` level (SOAP XML, frame text, HTTP
  status and body), so the protocol translation can be shown live from `docker compose logs`.
- Replace the `any` payloads with small command interfaces next to the adapters.

## 7. Configuration and deployment

New environment variables (read in `config.ts`; the defaults suit `npm run start` on a laptop):

| Variable | Used by | Default (local) | Compose value |
| --- | --- | --- | --- |
| `CMS_SOAP_URL` | adapters | `http://localhost:8081/cms/soap` | `http://legacy-systems:8081/cms/soap` |
| `WMS_TCP_HOST` / `WMS_TCP_PORT` | adapters | `localhost` / `9100` | `legacy-systems` / `9100` |
| `ROS_BASE_URL` | adapters | `http://localhost:8082` | `http://legacy-systems:8082` |
| `ROS_API_KEY` | both | `dev-ros-key` | `dev-ros-key` |
| `CMS_PORT` / `WMS_PORT` / `ROS_PORT` | simulators | `8081` / `9100` / `8082` | same |
| `WMS_OOS_RATE` | WMS simulator | `0.1` | `0.1` |
| `ADAPTER_TIMEOUT_MS` | adapters | `10000` | `10000` |

[docker-compose.yml](../docker-compose.yml): add a service and point the existing one at it.

```yaml
  legacy-systems:
    build: ./legacy-cms
    container_name: swift-legacy-systems
    command: ["node", "dist/systems/main"]
    ports:
      - "8081:8081"   # CMS SOAP (curl-able from host for demos)
      - "8082:8082"   # ROS REST
      - "9100:9100"   # WMS TCP
    environment:
      - ROS_API_KEY=dev-ros-key
    networks:
      - swifttrack-network

  legacy-mock:
    # ...existing...
    environment:
      - RABBITMQ_URL=amqp://guest:guest@rabbitmq:5672
      - CMS_SOAP_URL=http://legacy-systems:8081/cms/soap
      - WMS_TCP_HOST=legacy-systems
      - WMS_TCP_PORT=9100
      - ROS_BASE_URL=http://legacy-systems:8082
      - ROS_API_KEY=dev-ros-key
    depends_on:
      rabbitmq:
        condition: service_healthy
      legacy-systems:
        condition: service_started
```

`service_started` is enough here: the WMS adapter reconnects on its own, and the HTTP adapters
connect per request.

Add scripts to `legacy-cms/package.json`: `"start:systems": "ts-node src/systems/main.ts"` (not a second `nest start`: both would wipe and rebuild the same `dist/`)
and `"start:systems:prod": "node dist/systems/main"`. Local start order becomes: RabbitMQ, MongoDB,
**simulators**, adapters, Order Service, Gateway, client.

## 8. Demo scenarios this enables

| Scenario | How | What you see |
| --- | --- | --- |
| Happy path | Place a normal order | SOAP XML, `CHK`/`ACK` frames and `POST /api/v1/routes` in adapter logs; order reaches `ROS_CONFIRMED` |
| Out of stock + compensation | Set an item's quantity to 100 or more | `NAK…OUT_OF_STOCK`, then a SOAP `CancelOrderRequest`; order `FAILED` |
| CMS outage | `docker stop swift-legacy-systems`, place an order | `CMS_UNAVAILABLE` within 10 s; saga fails cleanly, no compensation needed |
| WMS drops mid-session | Restart `legacy-systems` while running | Adapter logs the reconnect with backoff; the next order succeeds |
| Native protocol by hand | `curl -X POST localhost:8081/cms/soap -H 'SOAPAction: urn:swifttrack:cms#CreateOrder' -H 'Content-Type: text/xml' --data @sample.xml`; `curl -H 'X-API-Key: dev-ros-key' localhost:8082/health` | Raw XML and JSON from the "legacy" systems |

Add `legacy-cms/src/scripts/wms-probe.ts` (`npm run wms:probe`), a small CLI that sends one framed `CHK` and prints the reply,
because the binary length header makes the TCP protocol hard to test with `nc`.

## 9. Testing

**Unit (no network)**

- `soap.spec.ts`: build the CreateOrder envelope and compare it with a golden XML string; parse a
  response with one item and with several; parse a Fault; escape `&`/`<` in names.
- `wms-frame.spec.ts`: encode and compare with golden bytes; escape and unescape `| , : %`;
  `FrameDecoder` with (a) one frame split in two chunks, (b) two frames in one chunk, (c) the
  4-byte header split 2+2, (d) an oversize length, which must raise an error.

**Integration (adapters against simulators on ephemeral ports, `listen(0)`)**

- Every canonical pattern returns the exact reply shape in §4.
- CMS duplicate `OrderRef` → same `cmsOrderId`; cancel unknown → the simulator returns a Fault with
  `CMS_ORDER_NOT_FOUND`, and the adapter maps it to `success: true` (nothing left to undo, see §11).
- WMS: `WMS_OOS_RATE=0` + qty 100 → `OUT_OF_STOCK`; 20 concurrent `CHK`s on one socket all
  resolve to the right `SEQ`; kill the server → pending requests reject with `WMS_UNAVAILABLE`.
- ROS: wrong key → `ROS_REJECTED:401`; delete unknown → `success: true`; server delay over the
  timeout → `ROS_TIMEOUT`.

**End to end**: `docker compose up --build`, then run the scenarios in §8 through the client.

## 10. Implementation order

Each step leaves the system working.

1. **Scaffolding.** Add dependencies, `config.ts`, `systems/main.ts` with empty servers, the npm
   scripts and the compose service. Check that both containers start.
2. **ROS first** (simplest). Simulator, adapter and controller delegation for the two ROS
   patterns, with tests. The CMS and WMS handlers keep their current inline replies until their turn.
3. **CMS.** `protocols/soap.ts` with golden tests, then the simulator, adapter and controller wiring.
4. **WMS** (hardest). `protocols/wms-frame.ts` with `FrameDecoder` tests first, then the
   simulator, then the adapter with connection management, then the wiring and `wms-probe.ts`.
5. **Error-path pass.** Unify error codes, check that the 10 s timeouts beat the saga's 30 s, and
   run the outage scenarios.
6. **Docs.** Update [system.md](system.md) §4.5 (mocks become adapters + simulators), §9.9
   ("designed" becomes implemented), §12 (remove gap 1), §14.1–14.2 (new container, ports, env
   vars), and the [README](../README.md) start-up steps.

## 11. Risks and notes

- **Node version.** The `legacy-cms` Dockerfile uses `node:18-alpine`. Global `fetch` and
  `AbortSignal.timeout` work there, but NestJS 11 officially needs Node 20+ (system.md gap 14).
  Bumping the image to `node:20-alpine` while touching this package is cheap.
- **Shared codecs** can hide symmetric bugs; the golden fixtures in §9 are the mitigation.
- **In-memory simulator state** is lost when `legacy-systems` restarts. A cancel issued after
  a restart will then get `NOT_FOUND`. All three adapters map `NOT_FOUND` on a cancel or
  release to `success: true`, because nothing is left to undo, so compensation is idempotent.
- **No retries** on non-idempotent calls (`CHK`, `CreateOrder`) after a dropped connection.
  The simulators' idempotency is what makes the saga's redelivery safe; real systems would
  need the same guarantee, or an idempotency key.
