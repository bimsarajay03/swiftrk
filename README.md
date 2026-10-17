# SwiftTrack

Middleware platform for **SwiftLogistics (Pvt) Ltd.**, a last-mile delivery company.
SwiftTrack sits between a customer-facing portal / driver app and three legacy back-office
systems that were never designed to talk to each other, and makes a single order flow
cleanly across all of them.

Built for the UCSC **Middleware Architecture (SCS2314)** assignment — see [docs/guidelines.md](docs/guidelines.md)
for the original brief.

---

## The problem

SwiftLogistics runs three independent systems, each speaking a different protocol:

| System | What it does | Native protocol |
| --- | --- | --- |
| **CMS** — Client Management System | Contracts, billing, order intake | Legacy on-prem **SOAP / XML** |
| **WMS** — Warehouse Management System | Package tracking inside the warehouse | Proprietary **TCP/IP** messaging |
| **ROS** — Route Optimisation System | Third-party route planning | Cloud **REST / JSON** |

A single customer order has to touch all three. That creates four hard problems, and the
architecture here exists to answer each one:

1. **Heterogeneous integration** — one order, three protocols. Solved by putting a message
   broker in the middle and giving each legacy system an adapter that speaks its dialect.
2. **Never lose an order** — a back-end being down must not drop work. Solved with durable
   RabbitMQ queues; the order is persisted and queued before any legacy system is contacted.
3. **Don't block the customer** — route optimisation is slow. Solved by making order intake
   asynchronous and pushing progress back over WebSockets instead of making the browser wait.
4. **Distributed consistency** — if the warehouse says "out of stock" *after* the CMS already
   created the order, the CMS order must be undone. Solved with the **Saga pattern** and
   explicit compensating transactions.

---

## What it does

- **Client portal** — submit an order, watch it move through CMS → WMS → ROS live, view a
  per-order timeline of every saga step including rollbacks.
- **Driver app** — see the day's manifest, mark deliveries as `DELIVERED` / `FAILED`, and
  capture a digital signature as proof of delivery.
- **Order orchestration** — a saga orchestrator drives the three legacy systems in sequence
  and rolls back in reverse order on any failure.
- **Real-time updates** — every status change is pushed to the browser over Socket.io; no
  polling.

---

## Architecture

```
   ┌──────────────────┐          ┌──────────────────┐
   │  Client Portal   │          │    Driver App    │      Next.js 16 (client/)
   │    /client       │          │     /driver      │      :3001
   └────────┬─────────┘          └────────┬─────────┘
            │  REST  +  Socket.io (order:update / driver:update)
            └───────────────┬─────────────┘
                            ▼
            ┌───────────────────────────────┐
            │        API GATEWAY            │   NestJS hybrid app (api-gateway/)
            │  REST controller  ·  WS gw    │   :3000
            │  Mongo `orders`  ·  RMQ pub   │
            └───────┬───────────────▲───────┘
       emit         │               │  consume
  `order_created`   │               │  notifications_queue
                    ▼               │
              ╔═════════════════════╧═════╗
              ║        RABBITMQ           ║   :6000 amqp · :16000 UI
              ║ orders_queue              ║
              ║ cms_queue / wms_queue /   ║
              ║ ros_queue                 ║
              ║ notifications_queue       ║
              ╚══╤═══════════════════╤════╝
                 ▼                   ▲
        ┌────────────────────┐       │
        │   ORDER SERVICE    │───────┘   NestJS microservice (order-service/)
        │ Saga Orchestrator  │           Mongo `order_sagas`
        └───┬──────┬─────┬───┘
            │      │     │  request/response over RMQ
            ▼      ▼     ▼
        ┌────────────────────┐
        │  LEGACY ADAPTERS   │           legacy-cms/ (3 RMQ consumers)
        └───┬──────┬─────┬───┘           JSON → native protocol → JSON
       SOAP │  TCP │     │ REST
            ▼      ▼     ▼
        ┌──────┬──────┬──────┐
        │ CMS  │ WMS  │ ROS  │           Legacy system simulators
        │:8081 │:9100 │:8082 │           (legacy-cms/src/systems)
        └──────┴──────┴──────┘
```

**MongoDB** holds two collections: `orders` (owned by the gateway, the customer-facing view)
and `order_sagas` (owned by the order service, the orchestration state machine). Two owners,
two stores of truth for two different concerns.

### Why these choices

- **RabbitMQ over HTTP calls** — durable queues mean an order survives a broker or consumer
  restart, and the gateway can accept Black-Friday-scale bursts without back-pressuring the UI.
- **Orchestration over choreography** — a central orchestrator makes saga state inspectable in
  one place and makes compensation logic explicit rather than emergent.
- **`emit()` vs `send()`** — the gateway *emits* `order_created` (fire-and-forget, so the
  customer gets an instant `201`), while the orchestrator *sends* to CMS/WMS/ROS
  (request-response, because it needs the returned IDs to compensate later).
- **MongoDB** — orders are deeply nested documents (items, address, saga steps, delivery
  proof); a document store avoids an ORM mapping layer entirely.

---

## The saga

`SagaOrchestratorService` ([order-service/src/saga/saga-orchestrator.service.ts](order-service/src/saga/saga-orchestrator.service.ts))
runs three steps forward and compensates backward.

```
 order_created
      │
      ├─▶ 1. cms_create_order   ──▶ CMS   ── ok ─▶ status CMS_CONFIRMED
      │
      ├─▶ 2. wms_check_stock    ──▶ WMS   ── ok ─▶ status WMS_CONFIRMED
      │                                  ── out of stock ─┐
      │                                                   │
      ├─▶ 3. ros_optimize_route ──▶ ROS   ── ok ─▶ status ROS_CONFIRMED
      │                                  ── fail ────────┤
      ▼                                                   ▼
   COMPLETED                                        COMPENSATE
                                            (reverse of completed steps)
                                              ros_cancel_route
                                              wms_release_stock
                                              cms_cancel_order
                                                     │
                                                     ▼
                                              status FAILED
```

Every call has a 30-second timeout and every failure path is caught, so a hung legacy system
degrades into a compensation rather than a stuck saga. Completed steps are recorded in
`order_sagas.completedSteps` *before* compensation needs them — the orchestrator only rolls
back what actually succeeded.

Saga states: `STARTED → CMS_PENDING → CMS_COMPLETED → WMS_PENDING → WMS_COMPLETED →
ROS_PENDING → ROS_COMPLETED → COMPLETED`, or `→ COMPENSATING → FAILED`.

Order statuses visible to the customer are defined in [shared/interfaces.ts](shared/interfaces.ts):
`PENDING`, `CMS_PROCESSING`, `CMS_CONFIRMED`, `WMS_PROCESSING`, `WMS_CONFIRMED`,
`WMS_OUT_OF_STOCK`, `ROS_PROCESSING`, `ROS_CONFIRMED`, `ASSIGNED`, `IN_TRANSIT`,
`DELIVERED`, `FAILED`, `CANCELLED`.

> The WMS simulator fails ~10% of stock checks at random, and always fails a line with
> quantity ≥ 100. That's deliberate — order 100 of something and you'll see a real
> compensation run end-to-end in the timeline UI.

---

## Quickstart

**Prerequisites:** Docker, Node.js 20+, npm.

### Option A — everything in Docker

```bash
docker-compose up -d --build
```

Brings up RabbitMQ, MongoDB, the gateway, the order service, the legacy adapters, the
legacy system simulators and the frontend. Open <http://localhost:3001>.

### Option B — infra in Docker, services locally (better for development)

```bash
# 1. Infrastructure only
docker-compose up -d rabbitmq mongodb

# 2. Install dependencies
for d in api-gateway order-service legacy-cms client; do (cd "$d" && npm install); done
```

Then run each service in its own terminal — **start the legacy systems and adapters first**,
so the orchestrator's request-response calls have someone to answer them:

```bash
cd legacy-cms    && npm run start:systems  # CMS SOAP :8081, WMS TCP :9100, ROS REST :8082
cd legacy-cms    && npm run start:dev   # adapters: cms/wms/ros_queue → native protocols
cd order-service && npm run start:dev   # saga orchestrator
cd api-gateway   && npm run start:dev   # REST + WebSocket    → :3000
cd client        && npm run dev         # Next.js portal      → :3001
```

### Ports

| Service | URL |
| --- | --- |
| Frontend (Next.js) | <http://localhost:3001> |
| API Gateway (REST + Socket.io) | <http://localhost:3000> |
| RabbitMQ management UI | <http://localhost:16000> (`guest` / `guest`) |
| RabbitMQ AMQP | `localhost:6000` |
| MongoDB | `mongodb://localhost:27017/swifttrack` |
| CMS simulator (SOAP) | <http://localhost:8081/cms/soap> |
| WMS simulator (TCP frames) | `localhost:9100` |
| ROS simulator (REST) | <http://localhost:8082/api/v1> (`X-API-Key: dev-ros-key`) |

> AMQP is mapped to **6000** (not the usual 5672) and the management UI to **16000**, to dodge
> reserved-port conflicts on Windows. Inside the Docker network, services still connect to
> `rabbitmq:5672` directly.

### Try it

1. Go to <http://localhost:3001/client> → **New Order**, fill in items and an address.
2. Watch the order card advance through `PENDING → CMS_CONFIRMED → WMS_CONFIRMED →
   ROS_CONFIRMED` without refreshing.
3. Open <http://localhost:3001/driver>, open the delivery, sign, and mark it delivered — the
   client portal updates immediately.
4. Submit ~10 orders to trip the WMS out-of-stock path and watch a compensation roll back.

---

## API

Base URL `http://localhost:3000`.

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/orders` | Create an order; returns immediately and starts the saga |
| `GET` | `/orders` | List orders — `?status=&limit=&skip=` |
| `GET` | `/orders/:id` | One order, including its full `sagaSteps` history |
| `GET` | `/orders/customer/:customerId` | Orders for a customer (client portal) |
| `GET` | `/orders/driver/:driverId` | Manifest for a driver — `?status=` |
| `PATCH` | `/orders/:id/delivery` | Driver marks `DELIVERED` / `FAILED`, attaches proof |

Create an order:

```bash
curl -X POST http://localhost:3000/orders \
  -H 'Content-Type: application/json' \
  -d '{
    "customerId": "CUST-001",
    "customerName": "Acme Retail",
    "customerEmail": "ops@acme.lk",
    "items": [
      { "productId": "SKU-1", "productName": "Widget", "quantity": 2, "unitPrice": 1500 }
    ],
    "deliveryAddress": {
      "street": "42 Galle Road", "city": "Colombo",
      "postalCode": "00300", "country": "LK"
    }
  }'
```

The gateway generates the order ID (`ORD-<year>-<short-uuid>`) and computes `totalPrice` from
the items — clients don't send either.

### WebSocket (Socket.io, same origin as the REST API)

```js
socket.emit("order:subscribe",  { customerId: "CUST-001" });
socket.on("order:update",  (data) => { /* status changed */ });

socket.emit("driver:subscribe", { driverId: "DRV-001" });
socket.on("driver:update", (data) => { /* new assignment / delivery event */ });
```

Subscriptions are Socket.io **rooms** (`customer:{id}`, `driver:{id}`), so an update fans out
only to the parties who care about that order.

---

## Repository layout

```
api-gateway/     NestJS hybrid app — REST + Socket.io + RMQ producer/consumer
  src/orders/
    orders.controller.ts       REST endpoints
    orders.service.ts          persistence, publishes order_created, pushes WS updates
    orders.gateway.ts          Socket.io rooms and emitters
    orders.message-handler.ts  @EventPattern consumers on notifications_queue
    schemas/order.schema.ts    customer-facing order document

order-service/   NestJS microservice — the orchestrator
  src/saga/
    saga-orchestrator.service.ts   forward steps + compensation
    order-message.handler.ts       consumes order_created from orders_queue
    schemas/order-saga.schema.ts   saga state machine document

legacy-cms/      Legacy integration (see docs/setup.txt §4)
  src/adapters/      RMQ consumers translating JSON ↔ SOAP / TCP frames / REST
  src/protocols/     SOAP envelope codec, WMS frame codec
  src/systems/       CMS, WMS and ROS simulators (own container: legacy-systems)

client/          Next.js 16 + React 19 + Tailwind 4
  src/app/client/    portal: dashboard, new order, order detail + timeline
  src/app/driver/    driver app: manifest, delivery detail, signature capture
  src/hooks/         useOrders, useSocket, useNotifications
  src/lib/           api.ts (REST), socket.ts (Socket.io), types.ts

shared/interfaces.ts   Single source of truth for order types, message patterns,
                       queue names and socket event names across all services
docs/                  All project documentation:
  setup.txt              how to run everything, ports, legacy protocols
  system.md              full system description and design choices
  diagram.md             Mermaid diagrams (context, sequences, states)
  guidelines.md          original assignment brief and scenario
  mock-implementation.md plan for the SOAP / TCP / REST legacy adapters
  MEMBER1_DOCUMENTATION.md  orchestrator documentation
```

### Message patterns & queues

Defined once in [shared/interfaces.ts](shared/interfaces.ts) as `MESSAGE_PATTERNS` and
`QUEUE_NAMES`. Events use past tense and are fire-and-forget (`order_created`,
`order_status_updated`); commands use present tense and expect a reply (`cms_create_order`,
`wms_check_stock`, `ros_optimize_route`).

| Queue | Consumer | Carries |
| --- | --- | --- |
| `orders_queue` | Order Service | `order_created` from the gateway |
| `cms_queue` | CMS adapter (SOAP) | create / cancel order |
| `wms_queue` | WMS adapter (TCP) | check / reserve / release stock |
| `ros_queue` | ROS adapter (REST) | optimise / cancel route |
| `notifications_queue` | API Gateway | `order_status_updated`, `delivery_completed`, `saga_compensation_triggered`, `driver_assigned` |

---

## Tech stack

Everything is open source, per the assignment constraint. Versions below are the ones
actually pinned in the `package.json` files.

### Backend — all three services

| Package | Version | Role |
| --- | --- | --- |
| `@nestjs/core`, `@nestjs/common` | ^11.0.1 | DI container, module system, decorators |
| `@nestjs/microservices` | ^11.1.13 | RabbitMQ transport — `@MessagePattern` / `@EventPattern`, `ClientProxy` |
| `amqplib` + `amqp-connection-manager` | ^0.10.9 / ^5.0.0 | AMQP driver underneath the Nest transport; the connection manager gives automatic reconnect |
| `rxjs` | ^7.8.1 | `ClientProxy.send()` returns an Observable — `firstValueFrom`, `timeout`, `catchError` drive the saga's per-step deadlines |
| `reflect-metadata` | ^0.2.2 | Required for TypeScript decorator metadata |
| TypeScript | ^5.7.3 | Language, `experimentalDecorators` + `emitDecoratorMetadata` |

### API Gateway only

| Package | Version | Role |
| --- | --- | --- |
| `@nestjs/platform-express` | ^11.0.1 | HTTP server for the REST endpoints |
| `@nestjs/websockets` + `@nestjs/platform-socket.io` | ^11.1.13 | WebSocket gateway, room management |
| `socket.io` | ^4.8.3 | Real-time push to portal and driver app |
| `@nestjs/mongoose` + `mongoose` | ^11.0.4 / ^9.1.6 | `orders` collection, schema decorators |
| `class-validator` + `class-transformer` | ^0.14.3 / ^0.5.1 | `ValidationPipe` on `CreateOrderDto` — `whitelist` + `forbidNonWhitelisted` reject unknown fields at the edge |
| `uuid` | ^9.0.1 | Order ID generation (`ORD-<year>-<short-uuid>`) |

### Order Service only

`@nestjs/mongoose` + `mongoose` for the `order_sagas` collection. No HTTP server —
it is a pure RabbitMQ microservice created with `NestFactory.createMicroservice`.

### Legacy adapters and systems

The core Nest packages and the RMQ transport, plus `fast-xml-parser` (SOAP envelopes) and
`express` (the CMS and ROS simulators). TCP uses Node's `net` module and HTTP calls use the
built-in `fetch`. No database — the simulators keep their state in memory.

### Frontend (`client/`)

| Package | Version | Role |
| --- | --- | --- |
| `next` | 16.1.6 | App Router, server components, `next dev -p 3001` |
| `react` / `react-dom` | 19.2.3 | UI runtime |
| `babel-plugin-react-compiler` | 1.0.0 | React Compiler — automatic memoisation |
| `tailwindcss` + `@tailwindcss/postcss` | ^4 | Styling, CSS-first config |
| `socket.io-client` | ^4.8.3 | Consumes `order:update` / `driver:update` |
| `lucide-react` | ^0.575.0 | Icons |
| `react-hot-toast` | ^2.6.0 | Toast notifications on status changes |
| `typescript` | ^5 | Shared types mirrored from `shared/interfaces.ts` |

### Infrastructure

| Component | Image / version | Notes |
| --- | --- | --- |
| RabbitMQ | `rabbitmq:3-management` | Durable queues; management UI bundled |
| MongoDB | `mongo:latest` | Two collections in the `swifttrack` database |
| Docker Compose | v2 (`services:` schema, no `version:` key) | Named volumes `swifttrack-rabbitmq-data` / `-mongodb-data` persist across restarts |
| Node.js | 22 (frontend image), 18 (backend images) | See the note below |

### Tooling

ESLint 9 (flat config) with `typescript-eslint` 8 and Prettier · Jest 30 + `ts-jest` for unit
tests, plus a Supertest e2e harness scaffolded in each service's `test/` directory.

> **Node version caveat:** the three backend `Dockerfile`s use `node:18-alpine`, but NestJS 11
> and Mongoose 9 both require **Node 20+**. The containers may fail to build or run until those
> are bumped to `node:20-alpine` or newer. Local development on Node 20/22 is unaffected — this
> only bites the all-Docker path.

---

## Current limitations

This is a prototype for an architecture assignment, and a few things are deliberately stubbed:

- **No authentication.** The portal uses a hardcoded `CUST-001` and the driver app `DRV-001`.
  CORS is wide open and RabbitMQ uses default `guest` credentials. Production would need JWTs
  on both REST and WebSocket handshakes, TLS everywhere, and real broker credentials.
- **The legacy systems are simulators.** The adapters really speak SOAP/XML, framed TCP and
  REST to them, but the systems themselves are small in-memory stand-ins (state is lost on
  restart) and WMS stock availability is randomised.
- **Driver assignment is hardcoded** to `DRV-001` once ROS confirms a route.
- **Compensation is best-effort.** If a compensating call itself fails it is logged, not retried
  — a production system would need a dead-letter queue and a retry policy.

## Troubleshooting

```bash
docker ps                      # are rabbit + mongo up?
docker-compose logs -f         # infra logs
```

- **Orders stay `PENDING`** — the order service isn't consuming `orders_queue`. Check it's
  running and connected to `amqp://localhost:6000`.
- **Stuck at `CMS_PROCESSING`** — the legacy adapters aren't running; the orchestrator will
  time out after 30s and compensate.
- **Orders fail with `CMS_UNAVAILABLE` / `WMS_UNAVAILABLE` / `ROS_UNAVAILABLE`** — the adapters
  are running but the legacy systems aren't (`npm run start:systems`).
- **No live updates** — the gateway must start its microservice consumers *and* its HTTP
  server (it's a hybrid app); confirm `RabbitMQ consumer listening on notifications_queue`
  appears in its startup logs.
- **Queues piling up** — inspect them at <http://localhost:16000> (`guest` / `guest`).
