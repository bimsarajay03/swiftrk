# SwiftTrack — System Description

This document describes the whole SwiftTrack system: what it does, what it is required to do
and why, the parts it is made of, how those parts talk to each other, and the reasoning behind
the architecture and technology choices. Diagrams for everything described here are in
[diagram.md](diagram.md).

Everything below is written against the code as it is in this repository. Where the code
does less than the design intends, that is stated in the relevant section and collected in
[§12 Gaps between design and implementation](#12-gaps-between-design-and-implementation).

---

## Contents

1. [What the system is](#1-what-the-system-is)
2. [Requirements and why they exist](#2-requirements-and-why-they-exist)
3. [Architecture at a glance](#3-architecture-at-a-glance)
4. [The parts and what each one does](#4-the-parts-and-what-each-one-does)
5. [How the parts communicate](#5-how-the-parts-communicate)
6. [End-to-end flows](#6-end-to-end-flows)
7. [Data model](#7-data-model)
8. [State models](#8-state-models)
9. [Design choices and why](#9-design-choices-and-why)
10. [Technology stack and why](#10-technology-stack-and-why)
11. [How each requirement is met](#11-how-each-requirement-is-met)
12. [Gaps between design and implementation](#12-gaps-between-design-and-implementation)
13. [Security](#13-security)
14. [Deployment and configuration](#14-deployment-and-configuration)

---

## 1. What the system is

**SwiftLogistics (Pvt) Ltd.** is a Sri Lankan last-mile delivery company serving e-commerce
businesses, from large online retailers to small independent sellers. It runs three back-office
systems that were built separately and cannot talk to each other:

| System | Responsibility | How it is reached |
| --- | --- | --- |
| **CMS** — Client Management System | Client contracts, billing, order intake | Legacy on-premise **SOAP / XML** API |
| **WMS** — Warehouse Management System | Tracks packages from receipt at the warehouse to loading on a vehicle | Proprietary messaging over **TCP/IP** |
| **ROS** — Route Optimisation System | Third-party cloud service that turns addresses and vehicle availability into routes | **REST / JSON** API |

**SwiftTrack** is the middleware platform that joins them. It gives clients a web portal and
drivers an app, and behind those it turns one customer order into a coordinated set of
operations across CMS, WMS and ROS, keeping them consistent and pushing progress back to
the people who need to see it.

In concrete terms the system:

- accepts an order from a client through the portal and acknowledges it immediately;
- persists the order and places it on a durable queue so it cannot be lost;
- runs a **saga** that creates the order in CMS, checks and reserves stock in WMS, and plans a
  route in ROS, one after the other;
- if any step fails, **undoes the steps that already succeeded** (compensating transactions) and
  marks the order failed;
- pushes every status change to the client portal and the driver app in real time over
  WebSockets;
- lets a driver see their manifest and mark each delivery `DELIVERED` or `FAILED` with a reason,
  with the change appearing on the client's screen immediately.

The project is a prototype built for the UCSC **Middleware Architecture (SCS2314)** assignment.
The three legacy systems are simulated (small stand-ins that speak each system's real protocol); the brief ([guidelines.md](guidelines.md)) asks for a
minimal implementation that shows the orchestration and real-time updates working end to end.

---

## 2. Requirements and why they exist

### 2.1 Functional requirements

| # | Requirement | Why it exists |
| --- | --- | --- |
| F1 | Clients can log in, see their orders and track them in real time | Clients currently have no self-service view; they need to know where their parcels are without calling SwiftLogistics |
| F2 | Clients can submit orders through the portal, which are passed to WMS and ROS | Order intake is the entry point for all revenue; today it is manual and siloed |
| F3 | Drivers can see their manifest and optimised route for the day | Drivers need one ordered list of stops produced by ROS rather than paper or phone calls |
| F4 | Drivers receive real-time route changes and new high-priority deliveries | Routes change during the day; a driver who only checks in the morning will go to the wrong place |
| F5 | Drivers mark packages `DELIVERED` or `FAILED` with a reason | The outcome of each stop must flow back to the client and to billing |
| F6 | Drivers capture a digital signature or photo as proof of delivery | Disputes over "I never received it" need evidence |

### 2.2 Non-functional requirements (the brief's "architectural challenges")

| # | Requirement | Why it exists |
| --- | --- | --- |
| N1 | **Heterogeneous integration** — bridge SOAP/XML, REST/JSON and proprietary TCP | The three back-office systems cannot be replaced; the platform has to speak each one's protocol and data format |
| N2 | **Real-time tracking and notifications** | "When a driver marks a package as delivered, the client portal should reflect this change immediately"; drivers need push notifications for route changes |
| N3 | **High-volume, asynchronous processing** | Black Friday and Avurudu sales produce bursts of orders; the portal must not block while ROS computes a route or WMS confirms a package |
| N4 | **Never lose an order**, even if a back-end system is temporarily down | A lost order is lost revenue and a broken promise to the client |
| N5 | **Distributed transaction consistency** with defined recovery | One order touches three systems with no shared transaction; if WMS says "out of stock" after CMS has already created the order, CMS must be put back |
| N6 | **Scalability and resilience** — scale with clients, drivers and deliveries; survive the failure of any single component | The company is growing quickly |
| N7 | **Security** — all communication, especially portal↔backend and calls to the external ROS, must be secure | Client data, addresses and billing information cross the network |

### 2.3 Constraints

| Constraint | Source | Effect on the design |
| --- | --- | --- |
| Open-source technologies only | Assignment brief | RabbitMQ, MongoDB, NestJS, Next.js, Socket.io, Docker |
| Team-agreed stack: NestJS backend, Next.js frontend, RabbitMQ + Socket.io, MongoDB | Team decision recorded at the end of [guidelines.md](guidelines.md) | One language (TypeScript) end to end |
| Legacy systems are mocked; real-time tracking is "architecturally described but minimally implemented" | Assignment brief | CMS/WMS/ROS are in-memory simulators behind real SOAP, TCP and REST adapters; several real-time paths are wired on one side only (see §12) |

---

## 3. Architecture at a glance

SwiftTrack is a **message-driven microservice architecture** with an **API Gateway** in front, a
**message broker** in the middle and a **saga orchestrator** coordinating the legacy systems.

```
Browser (Client Portal / Driver App)
        │  REST (commands, queries)      ▲  Socket.io (pushed updates)
        ▼                                │
   API Gateway  ──── MongoDB `orders`
        │  emit order_created            ▲  consume notifications_queue
        ▼                                │
                     RabbitMQ
        │  orders_queue                  ▲  notifications_queue
        ▼                                │
   Order Service (Saga Orchestrator) ──── MongoDB `order_sagas`
        │  send / reply over cms_queue, wms_queue, ros_queue
        ▼
   Legacy adapters (JSON ↔ SOAP / TCP frames / REST)
        │  SOAP/XML over HTTP · length-prefixed TCP · REST/JSON
        ▼
   Legacy system simulators: CMS :8081 · WMS :9100 · ROS :8082
```

There are seven runtime parts:

1. **Client** — Next.js app serving the client portal (`/client`) and driver app (`/driver`).
2. **API Gateway** — NestJS hybrid app: REST API, Socket.io server and RabbitMQ producer/consumer.
3. **RabbitMQ** — durable queues between every backend component.
4. **Order Service** — NestJS microservice that runs the saga.
5. **Legacy adapters** — one NestJS process hosting CMS, WMS and ROS consumers that translate to each legacy protocol.
6. **Legacy system simulators** — CMS (SOAP), WMS (TCP) and ROS (REST) stand-ins in their own container.
7. **MongoDB** — one database, two collections with separate owners.

Two further parts hold the system together at build time: **`shared/interfaces.ts`** (the
contract for message names, queue names and order types) and **`docker-compose.yml`** (the
deployment topology).

See [diagram.md](diagram.md) for the context, container, queue-topology, sequence, state and
deployment diagrams.

---

## 4. The parts and what each one does

### 4.1 Client — Next.js web app (`client/`)

**Purpose.** The only user-facing part. It hosts two apps in one Next.js project, split by route.

| Route | Who uses it | What it does |
| --- | --- | --- |
| `/` | — | Redirects to `/client` |
| `/client` | E-commerce client | Dashboard: order count, processing / in transit / delivered stats, order cards that update live |
| `/client/orders/new` | Client | Order form (items, delivery address). Submits `POST /orders` and returns to the dashboard |
| `/client/orders/[id]` | Client | Order detail: items, address, external IDs (CMS/WMS/ROS), a **saga timeline** of every step including compensations, and delivery proof (signature image) if present |
| `/driver` | Driver | Manifest: every order assigned to the driver, sorted `IN_TRANSIT` → `ASSIGNED` → `ROS_CONFIRMED` → `DELIVERED` → `FAILED`, with address and ETA |
| `/driver/deliveries/[id]` | Driver | One stop: address, items, "navigate" link, **Mark Delivered**, or **Mark Failed** with a reason from a fixed list ("Recipient not available", "Wrong address", …) |

**Internal structure.**

| Layer | Files | Responsibility |
| --- | --- | --- |
| Transport | [client/src/lib/api.ts](../client/src/lib/api.ts) | `ApiClient` wrapping `fetch` for all six REST endpoints; base URL from `NEXT_PUBLIC_API_URL` |
| Transport | [client/src/lib/socket.ts](../client/src/lib/socket.ts) | Singleton Socket.io client; WebSocket with polling fallback; infinite reconnection with 1–5 s backoff |
| Types | [client/src/lib/types.ts](../client/src/lib/types.ts) | Mirror of `shared/interfaces.ts`, plus UI label and colour maps for each status |
| State | [client/src/hooks/useSocket.ts](../client/src/hooks/useSocket.ts) | Exposes the socket and an `isConnected` flag to components |
| State | [client/src/hooks/useOrders.ts](../client/src/hooks/useOrders.ts) | Fetches orders over REST, then joins the right Socket.io room and patches local state on every `order:update` / `driver:update` (replace if known, prepend if new) |
| State | [client/src/hooks/useNotifications.ts](../client/src/hooks/useNotifications.ts) | Turns pushed updates into toasts (`react-hot-toast`) and browser notifications (Notification API): success on `DELIVERED`, error on `FAILED` / `CANCELLED` / `WMS_OUT_OF_STOCK`, info otherwise |
| UI | [client/src/components/](../client/src/components/) | `Navbar`, `ConnectionStatus` (live socket indicator), `OrderCard`, `OrderStatusBadge`, `OrderTimeline` (saga steps with success / failed / compensated icons), `SignaturePad` (canvas signature capture) |

**Identity.** There is no login. The portal uses a fixed `CUST-001` and the driver app a fixed
`DRV-001` (see §12, §13).

### 4.2 API Gateway (`api-gateway/`)

**Purpose.** The single entry point for the frontend and the bridge between the synchronous
world of the browser and the asynchronous world of the broker. It is a NestJS **hybrid
application**: one process that is both an HTTP/WebSocket server and a RabbitMQ consumer
([main.ts](../api-gateway/src/main.ts)).

**Responsibilities.**

1. **Validate input at the edge.** A global `ValidationPipe` with `whitelist`,
   `forbidNonWhitelisted` and `transform` checks `CreateOrderDto`
   ([create-order.dto.ts](../api-gateway/src/orders/dto/create-order.dto.ts)): required strings, a valid
   email, positive quantities and prices, nested item and address validation. Unknown fields are
   rejected with `400`.
2. **Own the customer-facing order record.** It generates the order ID
   (`ORD-<year>-<first 8 hex of a UUIDv4>`), computes `totalPrice` from the items, and stores the
   order in the `orders` collection with status `PENDING`.
3. **Start processing without waiting.** It **emits** `order_created` to `orders_queue`
   (fire-and-forget) and returns `201` straight away.
4. **Apply progress from the saga.** It consumes `notifications_queue`, updates the order in
   MongoDB, appends saga steps to the order's history, and…
5. **…push every change to the browser.** After each update it emits `order:update` to the
   room `customer:<customerId>` and, if a driver is assigned, `driver:update` to
   `driver:<driverId>`.
6. **Accept driver outcomes.** `PATCH /orders/:id/delivery` sets `DELIVERED` (with
   `deliveryProof`) or `FAILED` (with `failureReason`) and records a timeline step.

**Internal structure** (all in [api-gateway/src/orders/](../api-gateway/src/orders/)):

| Class | Kind | Role |
| --- | --- | --- |
| `OrdersController` | HTTP controller | The six REST endpoints (§5.2) |
| `OrdersService` | Provider | Persistence (`create`, `findById`, `findByCustomerId`, `findByDriverId`, `findAll`, `updateStatus`, `addSagaStep`), publishes `order_created`, calls the gateway to push updates |
| `OrdersGateway` | Socket.io gateway | `order:subscribe` / `order:unsubscribe` / `driver:subscribe` handlers that join and leave rooms; `emitOrderUpdate`, `emitDriverUpdate`, `broadcast` |
| `OrdersMessageHandler` | RMQ controller | `@EventPattern` handlers for `order_status_updated`, `saga_compensation_triggered`, `delivery_completed`, `driver_assigned` |
| `Order` schema | Mongoose schema | The `orders` document (§7.1) |
| `ORDER_SERVICE` client | `ClientProxy` (RMQ) | Publisher bound to `orders_queue` |

### 4.3 RabbitMQ (message broker)

**Purpose.** Decouples every backend component in time and in availability. Nothing in the
backend calls anything else directly; every interaction is a message on a durable queue.

| Queue | Producer | Consumer | Carries |
| --- | --- | --- | --- |
| `orders_queue` | API Gateway | Order Service | `order_created` (event); `retry_order_saga` (command, handler is a stub) |
| `cms_queue` | Order Service | CMS adapter | `cms_create_order`, `cms_cancel_order` (commands) |
| `wms_queue` | Order Service | WMS adapter | `wms_check_stock`, `wms_release_stock` (commands); `wms_reserve_stock` handler exists but is not called |
| `ros_queue` | Order Service | ROS adapter | `ros_optimize_route`, `ros_cancel_route` (commands) |
| `notifications_queue` | Order Service | API Gateway | `order_status_updated`, `saga_compensation_triggered` (events) |

All queues are declared `durable: true`. The broker's data directory is on a named Docker
volume, so queues and persisted messages survive a container restart. Replies to commands go
back over RabbitMQ's direct reply-to pseudo-queue (NestJS's default for `send()`), matched to the
request by a correlation ID.

### 4.4 Order Service — Saga Orchestrator (`order-service/`)

**Purpose.** Owns the distributed transaction. It is a "headless" NestJS microservice created
with `NestFactory.createMicroservice`: no HTTP port, only a RabbitMQ consumer on `orders_queue`
with **manual acknowledgement** (`noAck: false`) and `prefetchCount: 10`
([main.ts](../order-service/src/main.ts)).

**Parts.**

| Class | Role |
| --- | --- |
| `OrderMessageHandler` ([order-message.handler.ts](../order-service/src/saga/order-message.handler.ts)) | `@EventPattern('order_created')` → `startSaga()`, then **acks in a `finally`** so the message leaves the queue only after the saga has run (or failed and compensated). `@MessagePattern('retry_order_saga')` is a placeholder |
| `SagaOrchestratorService` ([saga-orchestrator.service.ts](../order-service/src/saga/saga-orchestrator.service.ts)) | Runs the saga steps, records state, compensates, and notifies the gateway |
| `OrderSaga` schema ([order-saga.schema.ts](../order-service/src/saga/schemas/order-saga.schema.ts)) | The `order_sagas` document (§7.2) |
| `CMS_SERVICE`, `WMS_SERVICE`, `ROS_SERVICE`, `API_GATEWAY` | Four RMQ `ClientProxy` instances bound to `cms_queue`, `wms_queue`, `ros_queue`, `notifications_queue` |

**What the saga does.**

1. Create an `order_sagas` record in state `STARTED` with a snapshot of the order.
2. **CMS** — `send('cms_create_order')`. On success, push `CMS_CREATE_ORDER` to
   `completedSteps`, store `cmsOrderId`, state `CMS_COMPLETED`, emit
   `order_status_updated { status: CMS_CONFIRMED }`. On failure, compensate.
3. **WMS** — `send('wms_check_stock')`. On success, push `WMS_RESERVE_STOCK` to
   `completedSteps`, store `wmsPackageId`, state `WMS_COMPLETED`, emit `WMS_CONFIRMED`. If the
   reply is `success: false` or `inStock: false`, record the failure and compensate with reason
   `WMS_OUT_OF_STOCK`.
4. **ROS** — `send('ros_optimize_route')`. On success, push `ROS_OPTIMIZE_ROUTE`, store
   `rosRouteId`, state `ROS_COMPLETED` then `COMPLETED`, and emit `ROS_CONFIRMED` together with
   the ETA and `driverId: 'DRV-001'`. On failure, compensate with reason `ROS_FAILED`.

Each `send()` is wrapped in `timeout(30000)` and `catchError`, so a slow or dead legacy system
turns into a normal failure result and then a compensation rather than a hung saga.

**Compensation** (`compensate()`): set state `COMPENSATING`, read `completedSteps` back from
MongoDB, and undo in **reverse order** only what actually succeeded:
`ros_cancel_route` → `wms_release_stock` → `cms_cancel_order`. Then set state `FAILED`, emit
`saga_compensation_triggered { reason, compensatedSteps }` and `order_status_updated { FAILED }`.
A compensating call that itself fails is logged and skipped, not retried.

### 4.5 Legacy adapters and system simulators (`legacy-cms/`)

**Purpose.** Bridge the canonical JSON commands on `cms_queue`, `wms_queue` and `ros_queue` to
each back-office system's own protocol, so the saga never sees SOAP, frames or HTTP statuses.
The package has two roles, run as two containers:

| Role | Container / command | Code | Job |
| --- | --- | --- | --- |
| Adapters | `legacy-mock` / `npm run start:dev` | [main.ts](../legacy-cms/src/main.ts), [legacy-mock.controller.ts](../legacy-cms/src/legacy-mock.controller.ts), [adapters/](../legacy-cms/src/adapters/) | Three RMQ microservices (manual acks). Each handler calls its adapter, which translates JSON → native request, calls the system, and translates the reply back |
| Simulators | `legacy-systems` / `npm run start:systems` | [systems/](../legacy-cms/src/systems/) | Stand-ins for CMS, WMS and ROS. They know nothing about RabbitMQ |

| System | Wire protocol | Adapter → system |
| --- | --- | --- |
| CMS | SOAP 1.1 over HTTP, `POST /cms/soap` on :8081, `SOAPAction urn:swifttrack:cms#CreateOrder` / `#CancelOrder`; errors are `soapenv:Fault` (HTTP 500) with `<cms:ErrorCode>` | Envelopes built/parsed with `fast-xml-parser` ([protocols/soap.ts](../legacy-cms/src/protocols/soap.ts)); field names differ from the canonical ones (`OrderRef`, `Sku`, `TotalAmount`) |
| WMS | Proprietary TCP on :9100: `[u32 BE length][TYPE\|SEQ\|fields…]`, types `CHK`/`RSV`/`REL`/`PNG` → `ACK`/`NAK`/`PON` | One persistent socket, replies matched by `SEQ`, reconnect with backoff (0.5 s → 10 s), frame reassembly in [protocols/wms-frame.ts](../legacy-cms/src/protocols/wms-frame.ts) |
| ROS | REST/JSON on :8082: `POST /api/v1/routes`, `DELETE /api/v1/routes/:id`, `X-API-Key` | `fetch` with a timeout; 404 on delete counts as success |

| Pattern | Behaviour |
| --- | --- |
| `cms_create_order` | Returns `cmsOrderId = CMS-<epoch ms>-<0000–9999>`. Idempotent on `orderId` (a redelivery returns the same ID) |
| `cms_cancel_order` | Cancels; an unknown order (`CMS_ORDER_NOT_FOUND`) is reported as success, since there is nothing to undo |
| `wms_check_stock` | Returns `wmsPackageId = WMS-PKG-<0–9999>`. **Fails with `OUT_OF_STOCK` for any line with quantity ≥ 100**, and at random with probability `WMS_OOS_RATE` (default 0.1), so a compensation can be demonstrated. Idempotent on `orderId` |
| `wms_reserve_stock` | `NOT_FOUND` unless the order was checked first (not called by the saga) |
| `wms_release_stock` | Releases; an unknown package is reported as success |
| `ros_optimize_route` | Returns `rosRouteId = ROUTE-<0–999>`, an ETA 45 minutes out, two waypoints (Colombo warehouse → delivery address) and random distance / duration. Idempotent on `orderId` |
| `ros_cancel_route` | Deletes; 404 is reported as success |

**Errors.** Adapters never throw back to the saga. Transport and protocol failures become
`{ success: false, error }` with codes such as `CMS_UNAVAILABLE`, `CMS_TIMEOUT`, `CMS_FAULT`,
`WMS_UNAVAILABLE`, `WMS_TIMEOUT`, `OUT_OF_STOCK`, `ROS_UNAVAILABLE`, `ROS_TIMEOUT` and
`ROS_REJECTED:<status>`. Each adapter call times out after 10 s (`ADAPTER_TIMEOUT_MS`), inside the
saga's 30 s timeout, so the saga gets a specific code rather than a generic timeout.

The simulators keep state in memory only; it is lost when `legacy-systems` restarts.

### 4.6 MongoDB

**Purpose.** Durable state. One database, `swifttrack`, with two collections that have
**separate owners and separate purposes**:

| Collection | Owner | Purpose |
| --- | --- | --- |
| `orders` | API Gateway | The customer-facing view of an order: what the portal and driver app read, including a human-readable timeline (`sagaSteps`) |
| `order_sagas` | Order Service | The orchestrator's state machine: which steps ran, which completed (and therefore need compensating), external IDs, failure reason |

Neither service reads the other's collection. They share one MongoDB instance only to keep the
prototype simple; in production each would have its own database.

### 4.7 Shared contract (`shared/interfaces.ts`)

[shared/interfaces.ts](../shared/interfaces.ts) defines the vocabulary every part agreed on:
`OrderStatus`, `SagaStepStatus`, `Order`, `CreateOrderDto`, `MESSAGE_PATTERNS`, `QUEUE_NAMES`,
the CMS / WMS / ROS response shapes, `SOCKET_EVENTS`, and the driver manifest types. It also
sets the naming convention: **events are past tense and fire-and-forget**
(`order_created`), **commands are present tense and expect a reply** (`cms_create_order`).

No service imports this file at build time: each service declares its own matching types, and
the client keeps a mirror in `client/src/lib/types.ts`. It works as a written contract that the
team keeps in step by hand.

### 4.8 Deployment topology (`docker-compose.yml`)

[docker-compose.yml](../docker-compose.yml) defines seven containers on one bridge network
(`swifttrack-network`): `rabbitmq` (with a health check), `mongodb`, `api-gateway`,
`order-service`, `legacy-mock` (adapters), `legacy-systems` (CMS/WMS/ROS simulators, built from
the same `legacy-cms` image) and `client`. Backend services wait for RabbitMQ to be healthy
before starting. Named volumes persist broker and database data. Port mappings are in §14.

---

## 5. How the parts communicate

### 5.1 Channels

| From → To | Protocol | Style | Why this style |
| --- | --- | --- | --- |
| Browser → Gateway | HTTP/JSON (REST) | Request–response | Commands and queries the user is waiting on; simple, cacheable, easy to validate |
| Gateway → Browser | Socket.io (WebSocket, polling fallback) | Server push into rooms | Status changes happen seconds later, in another process; polling would waste requests and add latency |
| Gateway → Order Service | AMQP via `orders_queue` | **Event, `emit()`**, fire-and-forget | The customer must not wait for the saga; the queue holds the order if the Order Service is down |
| Order Service → CMS / WMS / ROS | AMQP via `cms_queue` / `wms_queue` / `ros_queue` | **Command, `send()`**, request–reply with 30 s timeout | The orchestrator needs each answer (IDs, in-stock flag) to decide the next step and to compensate later |
| Adapters → CMS | SOAP 1.1 over HTTP | Request–response, 10 s timeout | The CMS is an on-premise SOAP service; the adapter owns the envelope and fault handling |
| Adapters → WMS | Length-prefixed TCP frames on a persistent socket | Multiplexed request–reply (by `SEQ`), 10 s timeout | The WMS speaks a proprietary TCP protocol; one long-lived connection avoids a handshake per call |
| Adapters → ROS | HTTP/JSON (REST) + API key | Request–response, 10 s timeout | ROS is a third-party cloud API |
| Order Service → Gateway | AMQP via `notifications_queue` | **Event, `emit()`** | Progress reports; the orchestrator does not care who listens |
| Gateway, Order Service → MongoDB | MongoDB wire protocol (Mongoose) | Direct | Each service reads and writes only its own collection |

**Message envelope.** NestJS's RMQ transport serialises each message as
`{ "pattern": "<name>", "data": { … } }`, plus an `id` for `send()` so the reply can be
correlated. Every handler routes on `pattern`.

**Acknowledgement modes.**

| Consumer | `noAck` | Effect |
| --- | --- | --- |
| Order Service on `orders_queue` | `false`, `prefetchCount: 10` | The message is acked only after the saga finishes. If the process dies mid-saga, RabbitMQ redelivers it. Up to 10 sagas run concurrently per instance |
| Legacy adapters on `cms/wms/ros_queue` | `false` | Each handler acks once its legacy call has finished, then replies. Safe to redeliver because the systems are idempotent on `orderId` |
| API Gateway on `notifications_queue` | `true` | Auto-ack on delivery. Simpler, but an update in flight when the gateway crashes is lost (see §12) |

### 5.2 REST API (API Gateway, port 3000)

| Method | Path | Purpose | Response body |
| --- | --- | --- | --- |
| `POST` | `/orders` | Create an order and start the saga. `201` immediately | `{ success, message, order: { id, status: "PENDING", totalPrice, createdAt } }` |
| `GET` | `/orders?status=&limit=&skip=` | List orders, newest first (default limit 50) | `{ success, total, orders }` |
| `GET` | `/orders/customer/:customerId` | Client portal: a customer's orders, newest first | `{ success, customerId, count, orders }` |
| `GET` | `/orders/driver/:driverId?status=` | Driver manifest, sorted by ETA | `{ success, driverId, count, orders }` |
| `GET` | `/orders/:id` | One order with its full `sagaSteps` timeline. `404` if absent | `{ success, order }` |
| `PATCH` | `/orders/:id/delivery` | Driver sets `DELIVERED` or `FAILED`; body `{ driverId, status, failureReason?, signature?, photoUrl? }` | `{ success, message, order }` |

The static routes `customer/:id` and `driver/:id` are declared before `:id` so Express does not
treat "customer" as an order ID.

### 5.3 Socket.io events

| Direction | Event | Payload | Effect |
| --- | --- | --- | --- |
| Browser → Gateway | `order:subscribe` | `{ customerId }` | Join room `customer:<customerId>` |
| Browser → Gateway | `order:unsubscribe` | `{ customerId }` | Leave that room |
| Browser → Gateway | `driver:subscribe` | `{ driverId }` | Join room `driver:<driverId>` |
| Gateway → Browser | `order:update` | `{ type: "ORDER_CREATED" \| "STATUS_CHANGED", order }` | Sent to the customer's room on creation and every status change |
| Gateway → Browser | `driver:update` | `{ type: "STATUS_CHANGED", order }` (also `NEW_ASSIGNMENT` from the unused `driver_assigned` path) | Sent to the driver's room whenever an order with that `driverId` changes |

Rooms mean an update reaches only the parties who care about that order, rather than every
connected browser.

### 5.4 RabbitMQ message catalogue

| Pattern | Kind | Queue | Producer → Consumer | Payload (main fields) | Reply |
| --- | --- | --- | --- | --- | --- |
| `order_created` | event | `orders_queue` | Gateway → Order Service | `orderId, customerId, customerName, customerEmail, items[], totalPrice, deliveryAddress` | — |
| `cms_create_order` | command | `cms_queue` | Order Service → CMS | `orderId, customer*, items, totalPrice` | `{ success, cmsOrderId }` |
| `cms_cancel_order` | command (compensation) | `cms_queue` | Order Service → CMS | `orderId, cmsOrderId` | `{ success }` |
| `wms_check_stock` | command | `wms_queue` | Order Service → WMS | `orderId, items[{productId, quantity}]` | `{ success, inStock, wmsPackageId?, error? }` |
| `wms_release_stock` | command (compensation) | `wms_queue` | Order Service → WMS | `orderId, wmsPackageId` | `{ success }` |
| `ros_optimize_route` | command | `ros_queue` | Order Service → ROS | `orderId, deliveryAddress, items` | `{ success, rosRouteId, estimatedDeliveryTime, optimizedRoute }` |
| `ros_cancel_route` | command (compensation) | `ros_queue` | Order Service → ROS | `orderId, rosRouteId` | `{ success }` |
| `order_status_updated` | event | `notifications_queue` | Order Service → Gateway | `orderId, status, cmsOrderId?, wmsPackageId?, rosRouteId?, driverId?, estimatedDeliveryTime?, sagaStep?` | — |
| `saga_compensation_triggered` | event | `notifications_queue` | Order Service → Gateway | `orderId, reason, compensatedSteps[]` | — |
| `delivery_completed` | event | `notifications_queue` | *(no producer yet)* → Gateway | `orderId, driverId, deliveryProof` | — |
| `driver_assigned` | event | `notifications_queue` | *(no producer yet)* → Gateway | `orderId, driverId, driverName, estimatedDeliveryTime` | — |

---

## 6. End-to-end flows

Sequence diagrams for each flow are in [diagram.md](diagram.md).

### 6.1 Placing an order (happy path)

1. The client fills in `/client/orders/new`; the browser sends `POST /orders`.
2. The gateway validates the DTO, generates the ID, computes the total, saves the order as
   `PENDING` in `orders`, **emits** `order_created` to `orders_queue`, pushes
   `order:update {ORDER_CREATED}` to `customer:CUST-001`, and returns `201`. The client is
   redirected to the dashboard, which already shows the new order.
3. The Order Service receives `order_created`, creates the saga record and **sends**
   `cms_create_order`. CMS replies with a `cmsOrderId`. The orchestrator records it and emits
   `order_status_updated {CMS_CONFIRMED}`.
4. The gateway consumes that event, updates the order and appends a timeline step, and pushes
   `order:update`. The card on the dashboard changes to "Confirmed by CMS" without a refresh.
5. The same happens for WMS (`WMS_CONFIRMED`, with `wmsPackageId`) and ROS (`ROS_CONFIRMED`,
   with `rosRouteId`, ETA and `driverId: DRV-001`).
6. Because the order now has a `driverId`, the gateway also pushes `driver:update` to
   `driver:DRV-001`. The order appears on the driver's manifest.
7. The Order Service acks `order_created`. The saga record ends in `COMPLETED`.

### 6.2 Failure and compensation (WMS out of stock)

1. Steps 1–3 above: CMS has created the order and `CMS_CREATE_ORDER` is in `completedSteps`.
2. WMS replies `{ success: false, inStock: false, error: "OUT_OF_STOCK" }`.
3. The orchestrator records `WMS_CHECK_STOCK` as `FAILED`, sets the saga to `COMPENSATING`,
   reads `completedSteps` (`[CMS_CREATE_ORDER]`) and **sends** `cms_cancel_order`. CMS confirms.
4. The saga is set to `FAILED`. The orchestrator emits `saga_compensation_triggered`
   (`compensatedSteps: [CMS_CANCELLED]`) and `order_status_updated {FAILED}`.
5. The gateway marks the order `FAILED`, appends a `COMPENSATED` step `[CMS] CMS_CANCELLED` with
   reason `WMS_OUT_OF_STOCK`, and pushes the update. The client sees an error toast and the
   timeline shows the rollback.

The same path runs if any step times out after 30 s or ROS fails. Compensation always walks
`completedSteps` in reverse, so it undoes exactly what succeeded and nothing more.

### 6.3 Driver delivery

1. The driver opens `/driver`; `useOrders` calls `GET /orders/driver/DRV-001` and joins
   `driver:DRV-001`.
2. The driver opens a stop and taps **Mark Delivered** (or **Mark Failed** and picks a reason).
3. The browser sends `PATCH /orders/:id/delivery`. The gateway sets `DELIVERED` (with
   `deliveryProof.deliveredAt`) or `FAILED` (with `failureReason`), appends a timeline step, and
   pushes `order:update` to the customer room and `driver:update` to the driver room.
4. The client portal shows "Delivered" and fires both a toast and a browser notification
   ("Package Delivered!") immediately.

This flow is synchronous REST → MongoDB → Socket.io inside the gateway; it does not pass through
RabbitMQ. The `delivery_completed` consumer exists for a design in which delivery events arrive
from a driver/ROS service over the broker.

### 6.4 Real-time update path, generically

```
Order Service ── emit ──▶ notifications_queue ──▶ Gateway handler
   ──▶ MongoDB findOneAndUpdate ──▶ OrdersGateway.emitOrderUpdate / emitDriverUpdate
   ──▶ Socket.io room ──▶ useOrders patches state, useNotifications shows toast
```

---

## 7. Data model

### 7.1 `orders` (API Gateway)

| Field | Type | Notes |
| --- | --- | --- |
| `id` | string, unique, indexed | `ORD-2026-1a2b3c4d`; used instead of `_id` for readability |
| `customerId`, `customerName`, `customerEmail` | string | `customerId` indexed |
| `items[]` | embedded `{ productId, productName, quantity, unitPrice }` | |
| `totalPrice` | number | Computed by the gateway, never accepted from the client |
| `deliveryAddress` | embedded `{ street, city, postalCode, country, latitude?, longitude? }` | |
| `status` | enum of 13 `OrderStatus` values, indexed | Default `PENDING` |
| `sagaSteps[]` | embedded `{ service: CMS\|WMS\|ROS, action, status: PENDING\|SUCCESS\|FAILED\|COMPENSATED, timestamp, response?, error? }` | The timeline the client sees |
| `cmsOrderId`, `wmsPackageId`, `rosRouteId` | string | External references, filled in as the saga progresses |
| `driverId` | string, indexed | |
| `estimatedDeliveryTime` | date | From ROS |
| `deliveryProof` | embedded `{ signature?, photoUrl?, deliveredAt?, recipientName? }` | |
| `createdAt`, `updatedAt` | date | Mongoose timestamps |

Compound indexes: `{customerId, createdAt desc}` for the portal, `{driverId, status}` for the
manifest, `{status, createdAt desc}` for filtered lists.

### 7.2 `order_sagas` (Order Service)

| Field | Type | Notes |
| --- | --- | --- |
| `orderId` | string, unique, indexed | One saga per order |
| `sagaState` | string | See §8.2 |
| `orderData` | object | Snapshot of the `order_created` payload, kept for retry |
| `cmsOrderId`, `wmsPackageId`, `rosRouteId` | string | Needed by compensating calls |
| `steps[]` | `{ stepName, status, startedAt, completedAt?, request?, response?, error? }` | Full execution log, including compensations |
| `completedSteps[]` | string[] | **The compensation list.** Written immediately after each step succeeds, read back when compensating |
| `failureReason` | string | |
| `createdAt`, `updatedAt` | date | |

**Why two collections.** `orders` answers "what should the customer and driver see?";
`order_sagas` answers "what has the orchestrator done and what must it undo?". Different readers,
different writers, different lifecycles. Keeping them apart means the UI model can change without
touching recovery logic, and each collection can move to its own database later.

---

## 8. State models

State diagrams are in [diagram.md](diagram.md).

### 8.1 Order status (what customers and drivers see)

Defined values: `PENDING`, `CMS_PROCESSING`, `CMS_CONFIRMED`, `WMS_PROCESSING`, `WMS_CONFIRMED`,
`WMS_OUT_OF_STOCK`, `ROS_PROCESSING`, `ROS_CONFIRMED`, `ASSIGNED`, `IN_TRANSIT`, `DELIVERED`,
`FAILED`, `CANCELLED`.

Transitions the code actually produces:

```
PENDING → CMS_CONFIRMED → WMS_CONFIRMED → ROS_CONFIRMED → DELIVERED
                                                        → FAILED   (driver)
PENDING / CMS_CONFIRMED / WMS_CONFIRMED → FAILED                    (saga compensated)
```

The `*_PROCESSING`, `WMS_OUT_OF_STOCK`, `ASSIGNED`, `IN_TRANSIT` and `CANCELLED` values are part
of the designed lifecycle and are handled by the UI, but nothing sets them yet (§12).

### 8.2 Saga state (what the orchestrator tracks)

```
STARTED → CMS_PENDING → CMS_COMPLETED → WMS_PENDING → WMS_COMPLETED
        → ROS_PENDING → ROS_COMPLETED → COMPLETED
any *_PENDING step fails or times out → COMPENSATING → FAILED
```

`COMPENSATED` is defined in the type but not used; a compensated saga ends in `FAILED`.

---

## 9. Design choices and why

### 9.1 Message broker in the middle, not direct HTTP calls

**Choice.** Every backend interaction is a message on a durable RabbitMQ queue.

**Why.**
- **N4 (never lose an order).** The order is written to MongoDB and placed on a durable queue
  before any legacy system is contacted. If the Order Service is down, the message waits. If it
  crashes mid-saga, the unacked message is redelivered.
- **N3 (high volume).** The queue absorbs a Black Friday burst; the Order Service drains it at
  its own pace (10 in flight per instance), and more instances can be added as competing
  consumers on `orders_queue` without code changes.
- **N1 (heterogeneous integration).** Each legacy system sits behind its own queue. Adding,
  replacing or moving one changes only its adapter; the orchestrator keeps sending the same
  JSON command.
- **N6 (resilience).** A failed component stops consuming; it does not make its callers fail.

**Alternatives considered.** Synchronous REST chaining (gateway → CMS → WMS → ROS) is simpler
but couples availability: one slow system blocks the customer and one dead system loses the
order. Apache Kafka would also give durability and much higher throughput, but its strengths
(replayable log, partitions, stream processing) are not needed here, while RabbitMQ gives
per-message acks, request–reply and a management UI out of the box and is a first-class NestJS
transport.

### 9.2 Saga with orchestration, not two-phase commit or choreography

**Choice.** A central `SagaOrchestratorService` runs CMS → WMS → ROS and runs compensating
transactions in reverse on failure.

**Why.**
- **N5 (consistency).** CMS, WMS and ROS are independent systems with no shared transaction
  coordinator; a third-party cloud ROS will never take part in a two-phase commit. A saga
  accepts eventual consistency and makes recovery explicit: every forward step has a named
  undo (`cms_cancel_order`, `wms_release_stock`, `ros_cancel_route`).
- **Orchestration over choreography.** With choreography each service would react to the
  previous one's events and the rollback logic would be spread across all of them.
  With an orchestrator, the whole transaction, including its current state and what still has to
  be undone, is in one class and one MongoDB document. That makes it easy to inspect, debug,
  explain in a timeline UI, and change the order of steps.
- **Record before you need it.** `completedSteps` is written to MongoDB right after each
  success, so compensation reads persisted state rather than in-memory variables, and undoes only
  what succeeded.
- **Timeouts as failures.** A 30 s `timeout` on every call turns "no answer" into "failed",
  so a hung legacy system leads to a rollback instead of a saga stuck forever.

**Trade-off.** The orchestrator is a central component; it must be stateless apart from
MongoDB so it can be scaled and restarted (it is).

### 9.3 `emit()` for events, `send()` for commands

**Choice.** The gateway **emits** `order_created`; the orchestrator **sends** to CMS / WMS / ROS
and **emits** status updates.

**Why.** Emitting lets the gateway return `201` in milliseconds regardless of how long the
saga takes (N3). Sending is required where the caller needs the answer: the orchestrator can't
decide whether to continue or compensate, or what ID to cancel, without the reply. The
naming convention (events past tense, commands present tense) makes the difference visible
in the code.

### 9.4 API Gateway as a hybrid app

**Choice.** One NestJS process serves REST, hosts the Socket.io server and consumes
`notifications_queue`.

**Why.** The component that receives a status update from the broker is the same component that
holds the WebSocket connections, so it can push the update with no extra hop. It also gives the
frontend one origin for both REST and WebSocket, and one place to put validation, CORS and
(later) authentication.

**Trade-off.** Socket.io rooms are held in process memory, and `notifications_queue` is a single
competing-consumer queue. Running several gateway instances would need the Socket.io Redis
adapter (or a fan-out exchange per instance) so every instance can reach every client.

### 9.5 Real-time push with Socket.io rooms

**Choice.** Socket.io, with clients joining `customer:<id>` or `driver:<id>` rooms.

**Why.** N2 asks for immediate updates. Push removes polling load and latency. Rooms limit each
update to the people concerned, which matters both for bandwidth and for privacy. Socket.io adds
automatic reconnection and a long-polling fallback for restrictive networks, which matters for
drivers on mobile data.

### 9.6 Asynchronous intake: "accepted" is not "processed"

**Choice.** `POST /orders` returns `PENDING` straight away; progress arrives over WebSocket.

**Why.** N3 explicitly forbids blocking the portal while ROS or WMS work. The UI is designed
around this: the order card appears immediately and changes state in place.

### 9.7 Separate state for the customer view and the saga

**Choice.** `orders` owned by the gateway, `order_sagas` owned by the Order Service (§7).

**Why.** It follows "each service owns its data", keeps the UI model independent of
recovery logic, and lets either service be redeployed or moved to its own database alone.

### 9.8 MongoDB, a document store

**Why.** An order is a naturally nested document: items, an address, a list of saga steps,
delivery proof. Storing it as one document means one read for the order detail page and
atomic `$push` for appending timeline steps, with no join tables and no ORM mapping layer.
The schema can grow (e.g. photo proof, GPS points) without migrations.

### 9.9 Adapters for legacy protocols

**Choice.** Each legacy system is fronted by an adapter that consumes canonical JSON commands
from a queue and speaks the native protocol outward: SOAP envelopes to the CMS, framed TCP to
the WMS, REST calls to the ROS.

**Why.** It keeps protocol translation (SOAP envelopes, TCP framing, REST auth) out of the
orchestrator, which only knows the canonical message. This is the Channel Adapter and
Message Translator pattern. Replacing a legacy system, or its protocol, changes only its adapter.
The systems behind the adapters are simulators in their own container, so every call crosses
the network and an outage can be demonstrated by stopping that container.

### 9.10 Validation at the edge, IDs and totals on the server

**Why.** `whitelist` + `forbidNonWhitelisted` rejects unexpected fields before anything is
stored or queued, so bad data never reaches the saga or the legacy systems. Order IDs and
`totalPrice` are generated by the server so clients can't choose IDs or set prices.

### 9.11 Integration patterns used

| Pattern | Where |
| --- | --- |
| API Gateway | `api-gateway/` |
| Message Broker / Point-to-Point Channel | RabbitMQ, one queue per consumer |
| Event Message vs Command Message | `emit()` events vs `send()` commands |
| Request–Reply with Correlation Identifier | `send()` over RabbitMQ direct reply-to |
| Guaranteed Delivery | Durable queues, persistent volume, manual acks on `orders_queue` |
| Competing Consumers | Scaling Order Service instances on `orders_queue` |
| Saga (orchestration) + Compensating Transaction | `SagaOrchestratorService` |
| Channel Adapter + Message Translator | Legacy adapters ([legacy-cms/src/adapters/](../legacy-cms/src/adapters/)) |
| Canonical Data Model | `shared/interfaces.ts` |
| Publish–Subscribe to clients | Socket.io rooms |
| Database per service (logical) | `orders` vs `order_sagas` |

---

## 10. Technology stack and why

### 10.1 Summary

| Layer | Technology | Version (as pinned) |
| --- | --- | --- |
| Language | TypeScript | ^5.7 (backend), ^5 (client) |
| Backend framework | NestJS | ^11 |
| Messaging transport | `@nestjs/microservices` (RMQ), `amqplib`, `amqp-connection-manager` | ^11.1 / ^0.10 / ^5.0 |
| Reactive control | RxJS | ^7.8 |
| Real-time | Socket.io / `socket.io-client` | ^4.8 |
| Broker | RabbitMQ | `rabbitmq:3-management` |
| Database | MongoDB with Mongoose | `mongo:latest`, Mongoose ^9.1 |
| Validation | `class-validator`, `class-transformer` | ^0.14 / ^0.5 |
| Frontend | Next.js (App Router), React, React Compiler | 16.1.6 / 19.2.3 / 1.0.0 |
| Styling and UI | Tailwind CSS 4, `lucide-react`, `react-hot-toast` | |
| Packaging | Docker, Docker Compose v2 | Node 18 (backend images), Node 22 (client image) |
| Quality | ESLint 9, Prettier, Jest 30, Supertest | |

### 10.2 Why each choice

**TypeScript everywhere.** One language across four codebases means one set of tools and
types that read the same in the gateway, the orchestrator and the browser. Message payloads
are typed at each end, which catches many contract mistakes at compile time even without a
shared package.

**NestJS for all backend services.**
- Its `@nestjs/microservices` package treats RabbitMQ as a first-class transport:
  `@EventPattern` / `@MessagePattern` on the consumer side and `ClientProxy.emit()` / `.send()`
  on the producer side, including request–reply correlation. Without it, each service would
  need hand-written AMQP channel, reply-queue and correlation code.
- Hybrid apps (HTTP + WebSocket + RMQ in one process) are built in; that is exactly the gateway's
  role.
- The module and dependency-injection system gives every service the same shape
  (module → controller/handler → service → schema), which helps a team of five work in parallel.
- Built-in `ValidationPipe`, `@nestjs/mongoose` and `@nestjs/websockets` cover validation,
  persistence and Socket.io without extra glue.

**RabbitMQ.** Durable queues and persistent messages (N4), per-message acks with redelivery,
prefetch-based flow control (N3), request–reply via direct reply-to, mature client libraries, and a
management UI that makes queues visible during development and demos. It is open source and runs
as a single container.

**RxJS.** `ClientProxy.send()` returns an Observable; `timeout`, `catchError` and
`firstValueFrom` express "wait at most 30 s, turn any error into a failure result, then continue"
in three operators.

**MongoDB + Mongoose.** See §9.8. Mongoose schemas give the documents enums, required fields and
indexes, and decorator-based schemas fit NestJS.

**Socket.io.** Rooms, automatic reconnection, transport fallback and a matching browser client.
A NestJS gateway is a few decorators. Plain WebSockets would need reconnection, rooms and
fallback written by hand.

**Next.js + React.** One project serves both the client portal and the driver app under
different routes, sharing components, hooks and types. The App Router gives file-based routing;
the React Compiler handles memoisation automatically. A responsive web app stands in for a native
driver app in the prototype.

**Tailwind CSS.** Fast to build consistent dashboards; status colours are a single lookup table
(`STATUS_COLORS`).

**Docker Compose.** The full system (broker, database, three services and frontend) starts with
one command on any machine, with service-name DNS on a private network and persistent volumes.

**Open source throughout,** as the brief requires.

---

## 11. How each requirement is met

| Req. | Mechanism | Status in prototype |
| --- | --- | --- |
| F1 Client tracking | `/client` dashboard and detail page; REST for initial load; `order:update` pushes; saga timeline | Implemented; no login (fixed `CUST-001`) |
| F2 Order submission → WMS → ROS | `POST /orders` → `order_created` → saga CMS → WMS → ROS | Implemented end to end against the legacy simulators |
| F3 Driver manifest and route | `/driver` from `GET /orders/driver/:id`, ETA from ROS | Implemented; route shown as a summary, not a map |
| F4 Driver real-time route changes | `driver:update` to `driver:<id>` room; toasts and browser notifications in `useNotifications` | Partially: pushes are sent on every status change; route-change / new-delivery events are not yet produced |
| F5 Mark delivered / failed with reason | `/driver/deliveries/[id]` → `PATCH /orders/:id/delivery` | Implemented |
| F6 Signature or photo proof | API and schema accept `signature` / `photoUrl`; `SignaturePad` component exists; detail page shows a signature | Partially: driver page does not yet send a signature or photo |
| N1 Heterogeneous integration | Per-system queue + adapter; canonical JSON | Implemented: SOAP/XML, framed TCP and REST/JSON adapters against simulators |
| N2 Real-time | Socket.io rooms fed from `notifications_queue` | Implemented for client; driver side partial |
| N3 Async, high volume | `emit()` + immediate `201`; durable queue buffering; prefetch; competing consumers | Implemented |
| N4 Never lose an order | Persist before publish; durable queues and volumes; manual ack after saga | Implemented with caveats (§12) |
| N5 Distributed consistency | Orchestrated saga, persisted `completedSteps`, reverse compensation, 30 s timeouts | Implemented; compensation is best-effort |
| N6 Scale and resilience | Stateless services, broker decoupling, competing consumers | Order Service and adapters scale horizontally; gateway needs a Socket.io adapter to scale |
| N7 Security | Edge validation, server-side IDs/totals | Mostly not yet implemented (§13) |

---

## 12. Gaps between design and implementation

Found by reading the code. Each is either a deliberate prototype simplification or a gap to close.

1. **Closed: legacy adapters translate protocols.** The adapters now speak SOAP, framed TCP and
   REST to simulators (§4.5). The simulators are still in-memory stand-ins, not the real systems.
2. **Driver assignment is hard-coded.** The orchestrator attaches `driverId: 'DRV-001'` to the
   final `ROS_CONFIRMED` update. Nothing emits `driver_assigned`, so status `ASSIGNED` (and
   the `NEW_ASSIGNMENT` driver push) is never reached. Nothing sets `IN_TRANSIT` either.
3. **Out-of-stock is reported as `FAILED`.** The reason `WMS_OUT_OF_STOCK` is recorded in the
   saga and timeline, but the order status goes straight to `FAILED`, so the portal's specific
   out-of-stock toast never fires. The `*_PROCESSING` statuses are also never emitted.
4. **Proof of delivery isn't captured.** The driver page sends only the status; `SignaturePad`
   is not wired in and there is no photo upload.
5. **Delivery events bypass the broker.** `PATCH /orders/:id/delivery` updates MongoDB and
   pushes Socket.io directly. The `delivery_completed` consumer has no producer.
6. **Driver toast types don't match.** `useNotifications` reacts to `ROUTE_CHANGE` and
   `NEW_DELIVERY`; the gateway sends `STATUS_CHANGED` and `NEW_ASSIGNMENT`.
7. **WMS step naming.** The saga calls `wms_check_stock` but records the completed step as
   `WMS_RESERVE_STOCK`; `wms_reserve_stock` itself is never called. Check-and-reserve is
   treated as one operation.
8. **ROS compensation can't currently run.** ROS is the last step, and a step is added to
   `completedSteps` only on success, so `ros_cancel_route` is unreachable today. It is there for
   when steps are added after ROS (e.g. driver assignment).
9. **Crash mid-saga is not resumable.** On redelivery, `startSaga` tries to insert a second
   `order_sagas` document with the same unique `orderId`, fails, and the handler acks the message.
   The order stays at its last status. `retry_order_saga` is a stub. A fix is to load the existing
   saga and resume from `completedSteps`.
10. **Dual write at intake.** The gateway saves to MongoDB and then publishes. If the publish
    fails, the order sits at `PENDING` with no saga. A transactional outbox (or a sweeper that
    re-publishes stale `PENDING` orders) would close this.
11. **Gateway auto-acks notifications** (`noAck: true`). An update in flight during a gateway
    crash is lost; the order then lags behind the saga record.
12. **Compensation is best-effort.** A failing compensating call is logged, not retried. Production
    would need retries with backoff and a dead-letter queue.
13. **`shared/interfaces.ts` is not imported.** Types are kept in sync by hand, which is how the
    mismatches in items 3 and 6 arose. A shared npm workspace package would enforce it.
14. **Node version in backend images.** The backend Dockerfiles use `node:18-alpine`; NestJS 11
    and Mongoose 9 need Node 20+. Local development on Node 20/22 is unaffected.

---

## 13. Security

**In place.**
- Input validation with whitelisting at the gateway; unknown fields rejected.
- Server-generated order IDs and totals.
- The Order Service and adapters expose no HTTP ports; they are reachable only through the broker on
  the private Docker network. The legacy simulators publish 8081/9100/8082 to the host for demos;
  ROS calls need an API key, CMS and WMS have no authentication.
- Socket.io rooms scope pushes to one customer or driver.

**Not yet in place, and what production needs.**

| Gap | Production measure |
| --- | --- |
| No authentication; fixed customer and driver IDs | OAuth2 / OIDC login; JWT checked on REST and on the Socket.io handshake; room joins authorised against the token's subject |
| No authorisation on endpoints (any caller can read any order or mark any delivery) | Role-based access: clients see their own orders, drivers only their manifest, `PATCH /delivery` only by the assigned driver |
| CORS `*` on REST and WebSocket | Allow-list the portal's origin |
| Plain HTTP, WS and AMQP | TLS on all three (HTTPS, WSS, AMQPS); TLS and credentials for calls to the external ROS |
| RabbitMQ `guest/guest`, management UI exposed | Per-service broker users with least-privilege vhost permissions; UI not publicly exposed |
| MongoDB without auth | Authentication, per-service users, encryption at rest |
| Signature stored as base64 in the order document | Object storage with signed URLs; retention policy for personal data |
| No rate limiting | Rate limiting at the gateway to absorb abuse as well as genuine bursts |

---

## 14. Deployment and configuration

### 14.1 Containers and ports

| Service | Container | Host port → container port | Depends on |
| --- | --- | --- | --- |
| RabbitMQ | `swift-rabbit` | `6000 → 5672` (AMQP), `16000 → 15672` (UI) | — (has health check) |
| MongoDB | `swift-mongo` | `27017 → 27017` | — |
| API Gateway | `swift-api-gateway` | `3000 → 3000` | RabbitMQ healthy, MongoDB started |
| Order Service | `swift-order-service` | none | RabbitMQ healthy, MongoDB started |
| Legacy adapters | `swift-legacy-mock` | none | RabbitMQ healthy, legacy-systems started |
| Legacy system simulators | `swift-legacy-systems` | `8081` (CMS SOAP), `9100` (WMS TCP), `8082` (ROS REST) | — |
| Client | `swift-client` | `3001 → 3000` | API Gateway |

AMQP is mapped to 6000 and the UI to 16000 to avoid reserved-port ranges on Windows. Inside the
Docker network services use `rabbitmq:5672` and `mongodb:27017` by service name.

### 14.2 Environment variables

| Variable | Used by | Default |
| --- | --- | --- |
| `RABBITMQ_URL` | Gateway, Order Service, adapters | `amqp://localhost:6000` |
| `CMS_SOAP_URL` | Adapters | `http://localhost:8081/cms/soap` |
| `WMS_TCP_HOST` / `WMS_TCP_PORT` | Adapters | `localhost` / `9100` |
| `ROS_BASE_URL` | Adapters | `http://localhost:8082` |
| `ROS_API_KEY` | Adapters, simulators | `dev-ros-key` |
| `ADAPTER_TIMEOUT_MS` | Adapters | `10000` |
| `CMS_PORT` / `WMS_PORT` / `ROS_PORT` | Simulators | `8081` / `9100` / `8082` |
| `WMS_OOS_RATE` | WMS simulator | `0.1` |
| `ROS_LATENCY_MS` | ROS simulator | `0` |
| `MONGODB_URI` | Gateway, Order Service | `mongodb://localhost:27017/swifttrack` |
| `PORT` | Gateway | `3000` |
| `NEXT_PUBLIC_API_URL` | Client | `http://localhost:3000` |
| `NEXT_PUBLIC_SOCKET_URL` | Client | `http://localhost:3000` |

### 14.3 Start-up order

Start RabbitMQ and MongoDB, then the **legacy simulators** and **legacy adapters** (so commands
have a consumer that can reach a system), then the
**Order Service**, then the **API Gateway**, then the **client**. The RabbitMQ health check
enforces the first step under Compose. Because queues are durable, starting the gateway before
the Order Service is safe: orders queue up and are processed once the Order Service starts. Full
instructions are in [README.md](../README.md).
