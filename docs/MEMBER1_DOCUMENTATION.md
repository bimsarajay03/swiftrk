# SwiftTrack - Member 1 (Orchestrator) Documentation

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Project Structure](#project-structure)
3. [API Gateway](#api-gateway)
4. [Order Service](#order-service)
5. [Saga Pattern Implementation](#saga-pattern-implementation)
6. [RabbitMQ Configuration](#rabbitmq-configuration)
7. [How to Run](#how-to-run)
8. [API Endpoints](#api-endpoints)
9. [WebSocket Events](#websocket-events)
10. [Integration Guide for Other Members](#integration-guide-for-other-members)

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              CLIENT LAYER                                    │
│  ┌──────────────────┐                    ┌──────────────────┐               │
│  │  Client Portal   │                    │   Driver App     │               │
│  │    (Next.js)     │                    │    (Next.js)     │               │
│  │   [Member 3]     │                    │   [Member 3]     │               │
│  └────────┬─────────┘                    └────────┬─────────┘               │
│           │ HTTP + WebSocket                      │                          │
└───────────│───────────────────────────────────────│──────────────────────────┘
            │                                       │
            ▼                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           API GATEWAY (Port 3000)                            │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │                         OrdersModule                                  │   │
│  │  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────┐  │   │
│  │  │ OrdersController│  │  OrdersService  │  │   OrdersGateway     │  │   │
│  │  │ (HTTP REST API) │  │ (Business Logic)│  │ (Socket.io WebSocket│  │   │
│  │  └────────┬────────┘  └────────┬────────┘  └─────────┬───────────┘  │   │
│  │           │                    │                     │               │   │
│  │           └────────────────────┼─────────────────────┘               │   │
│  │                                │                                      │   │
│  │                    ┌───────────┴───────────┐                         │   │
│  │                    │  OrdersMessageHandler │                         │   │
│  │                    │ (RabbitMQ Listener)   │                         │   │
│  │                    └───────────┬───────────┘                         │   │
│  └────────────────────────────────│─────────────────────────────────────┘   │
│                                   │                                          │
│            ┌──────────────────────┼──────────────────────┐                  │
│            ▼                      ▼                      ▼                  │
│      ┌──────────┐          ┌───────────┐          ┌───────────┐            │
│      │ MongoDB  │          │ RabbitMQ  │◄─────────│ RabbitMQ  │            │
│      │ (orders) │          │(emit)     │          │(listen)   │            │
│      └──────────┘          └─────┬─────┘          └───────────┘            │
│                                  │ orders_queue        ▲                    │
└──────────────────────────────────│─────────────────────│────────────────────┘
                                   │                     │
                                   ▼                     │ notifications_queue
┌─────────────────────────────────────────────────────────────────────────────┐
│                           ORDER SERVICE (Microservice)                       │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │                           SagaModule                                  │   │
│  │  ┌────────────────────┐        ┌──────────────────────────────────┐ │   │
│  │  │ OrderMessageHandler│───────▶│    SagaOrchestratorService       │ │   │
│  │  │(RabbitMQ Listener) │        │    (Saga Pattern Logic)          │ │   │
│  │  └────────────────────┘        │                                  │ │   │
│  │                                │  ┌──────────────────────────────┐│ │   │
│  │                                │  │ SAGA STEPS:                  ││ │   │
│  │                                │  │ 1. CMS_CREATE_ORDER         ││ │   │
│  │                                │  │ 2. WMS_CHECK_STOCK          ││ │   │
│  │                                │  │ 3. ROS_OPTIMIZE_ROUTE       ││ │   │
│  │                                │  │                              ││ │   │
│  │                                │  │ COMPENSATIONS:               ││ │   │
│  │                                │  │ - CMS_CANCEL_ORDER          ││ │   │
│  │                                │  │ - WMS_RELEASE_STOCK         ││ │   │
│  │                                │  │ - ROS_CANCEL_ROUTE          ││ │   │
│  │                                │  └──────────────────────────────┘│ │   │
│  │                                └──────────────────────────────────┘ │   │
│  └────────────────────────────────────────────────────────────────────┘   │
│                    │                  │                  │                  │
│             cms_queue            wms_queue          ros_queue               │
│                    ▼                  ▼                  ▼                  │
└─────────────────────────────────────────────────────────────────────────────┘
                     │                  │                  │
                     ▼                  ▼                  ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                   LEGACY SYSTEM MOCKS [Member 2]                             │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐                   │
│  │   CMS Mock   │    │   WMS Mock   │    │   ROS Mock   │                   │
│  │  (SOAP/XML)  │    │    (TCP)     │    │ (REST/JSON)  │                   │
│  └──────────────┘    └──────────────┘    └──────────────┘                   │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Project Structure

```
swiftTrack/
├── docker-compose.yml          # RabbitMQ + MongoDB containers
├── shared/
│   └── interfaces.ts           # Shared TypeScript interfaces
│
├── api-gateway/                # HTTP API + WebSocket (Port 3000)
│   ├── src/
│   │   ├── main.ts             # Bootstrap file
│   │   ├── app.module.ts       # Root module
│   │   └── orders/
│   │       ├── orders.module.ts          # Orders feature module
│   │       ├── orders.controller.ts      # HTTP endpoints
│   │       ├── orders.service.ts         # Business logic
│   │       ├── orders.gateway.ts         # WebSocket (Socket.io)
│   │       ├── orders.message-handler.ts # RabbitMQ listener
│   │       ├── dto/
│   │       │   └── create-order.dto.ts   # Request validation
│   │       └── schemas/
│   │           └── order.schema.ts       # MongoDB schema
│   └── package.json
│
├── order-service/              # Saga Orchestrator (Microservice)
│   ├── src/
│   │   ├── main.ts             # Bootstrap file (RabbitMQ consumer)
│   │   ├── app.module.ts       # Root module
│   │   └── saga/
│   │       ├── saga.module.ts            # Saga feature module
│   │       ├── saga-orchestrator.service.ts  # SAGA PATTERN LOGIC
│   │       ├── order-message.handler.ts  # RabbitMQ listener
│   │       └── schemas/
│   │           └── order-saga.schema.ts  # Saga state schema
│   └── package.json
│
└── legacyMocks/                # [Member 2's work]
    ├── cms-mock/               # SOAP/XML service
    ├── wms-mock/               # TCP service
    └── ros-mock/               # REST service
```

---

## API Gateway

### Purpose

The API Gateway is the entry point for all client requests. It:

1. Receives HTTP requests from Client Portal and Driver App
2. Validates incoming data using DTOs
3. Stores orders in MongoDB
4. Pushes orders to RabbitMQ for processing
5. Provides real-time updates via WebSocket (Socket.io)

### Key Files

#### `main.ts`

```typescript
// Creates HTTP server with:
// - CORS enabled for frontend
// - Global validation pipeline
// - Socket.io WebSocket support
```

#### `orders.controller.ts`

Handles HTTP endpoints:

- `POST /orders` - Create new order
- `GET /orders/:id` - Get order by ID
- `GET /orders` - List all orders (with filters)
- `GET /orders/customer/:customerId` - Customer's orders
- `GET /orders/driver/:driverId` - Driver's deliveries

#### `orders.service.ts`

Business logic:

- Creates orders in MongoDB
- Emits to RabbitMQ (`order_created`)
- Updates order status when saga progresses
- Triggers WebSocket notifications

#### `orders.gateway.ts`

WebSocket implementation:

- Clients subscribe to updates by customerId
- Drivers subscribe by driverId
- Real-time notifications when status changes

#### `orders.message-handler.ts`

Listens for RabbitMQ events from Order Service:

- `order_status_updated` - Updates MongoDB
- `delivery_completed` - Marks delivery done
- `saga_compensation_triggered` - Handles failures

---

## Order Service

### Purpose

The Order Service is a "headless" microservice that:

1. Listens on `orders_queue` for new orders
2. Executes the Saga Pattern
3. Communicates with CMS, WMS, ROS mocks
4. Reports status back to API Gateway

### Key Files

#### `main.ts`

```typescript
// Creates RabbitMQ consumer (NOT an HTTP server)
// Listens on 'orders_queue'
```

#### `saga-orchestrator.service.ts`

**THE HEART OF THE SAGA PATTERN**

This service:

1. Receives order data
2. Executes saga steps in sequence
3. Handles failures with compensating transactions
4. Notifies API Gateway of status changes

#### `order-message.handler.ts`

Entry point for saga execution:

- Listens for `order_created` events
- Calls `sagaOrchestrator.startSaga()`

---

## Saga Pattern Implementation

### What is the Saga Pattern?

The Saga Pattern manages distributed transactions across multiple services. Instead of a single ACID transaction, we have a sequence of local transactions where each step has a compensating action (rollback).

### SwiftTrack Saga Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│                        HAPPY PATH                                    │
└─────────────────────────────────────────────────────────────────────┘

  ORDER_CREATED
       │
       ▼
  ┌────────────────────┐
  │ 1. CMS_CREATE_ORDER│ ──────▶ [CMS Mock] (SOAP/XML)
  │    (Create order   │             │
  │     in CMS)        │◀────────────┘ Returns: cmsOrderId
  └────────────────────┘
       │ SUCCESS
       ▼
  ┌────────────────────┐
  │ 2. WMS_CHECK_STOCK │ ──────▶ [WMS Mock] (TCP)
  │    (Check if items │             │
  │     are in stock)  │◀────────────┘ Returns: inStock, wmsPackageId
  └────────────────────┘
       │ SUCCESS
       ▼
  ┌────────────────────┐
  │ 3. ROS_OPTIMIZE    │ ──────▶ [ROS Mock] (REST)
  │    (Plan delivery  │             │
  │     route)         │◀────────────┘ Returns: rosRouteId, estimatedTime
  └────────────────────┘
       │ SUCCESS
       ▼
  SAGA_COMPLETE ✓


┌─────────────────────────────────────────────────────────────────────┐
│                     COMPENSATION PATH                                │
│              (When WMS returns OUT_OF_STOCK)                        │
└─────────────────────────────────────────────────────────────────────┘

  STEP 2 FAILS (WMS_OUT_OF_STOCK)
       │
       ▼
  ┌────────────────────┐
  │ COMPENSATE:        │
  │ CMS_CANCEL_ORDER   │ ──────▶ [CMS Mock] Cancel the order
  │ (Undo step 1)      │
  └────────────────────┘
       │
       ▼
  SAGA_FAILED ✗
       │
       ▼
  Notify API Gateway → WebSocket → Client sees "Order Failed"
```

### Compensation Rules

| If Step Fails      | Compensate These Steps              |
| ------------------ | ----------------------------------- |
| CMS_CREATE_ORDER   | None (first step)                   |
| WMS_CHECK_STOCK    | CMS_CANCEL_ORDER                    |
| ROS_OPTIMIZE_ROUTE | WMS_RELEASE_STOCK, CMS_CANCEL_ORDER |

### Code Example: Compensation

```typescript
// From saga-orchestrator.service.ts

private async compensate(orderId: string, reason: string): Promise<void> {
  const saga = await this.sagaModel.findOne({ orderId });
  const completedSteps = saga.completedSteps;

  // Compensate in REVERSE order
  if (completedSteps.includes('ROS_OPTIMIZE_ROUTE')) {
    await this.executeRosCancelRoute(orderId);
  }

  if (completedSteps.includes('WMS_RESERVE_STOCK')) {
    await this.executeWmsReleaseStock(orderId);
  }

  if (completedSteps.includes('CMS_CREATE_ORDER')) {
    await this.executeCmsCancelOrder(orderId);
  }

  // Notify API Gateway
  this.apiGatewayClient.emit('saga_compensation_triggered', {
    orderId,
    reason,
    compensatedSteps
  });
}
```

---

## RabbitMQ Configuration

### Queues

| Queue Name            | Producer      | Consumer      | Purpose          |
| --------------------- | ------------- | ------------- | ---------------- |
| `orders_queue`        | API Gateway   | Order Service | New order events |
| `cms_queue`           | Order Service | CMS Mock      | CMS operations   |
| `wms_queue`           | Order Service | WMS Mock      | WMS operations   |
| `ros_queue`           | Order Service | ROS Mock      | ROS operations   |
| `notifications_queue` | Order Service | API Gateway   | Status updates   |

### emit() vs send()

```typescript
// EMIT - Fire and forget (events)
// Use when you don't need a response
this.client.emit("order_created", orderData);

// SEND - Request/Response (commands)
// Use when you need a response
const result = await firstValueFrom(
  this.client.send("wms_check_stock", stockRequest),
);
```

### RabbitMQ Management UI

Access at: http://localhost:15672

- Username: guest
- Password: guest

---

## How to Run

### Prerequisites

- Node.js 18+
- Docker Desktop

### Step 1: Start Infrastructure

```bash
docker-compose up -d
```

### Step 2: Install Dependencies

```bash
cd api-gateway && npm install
cd ../order-service && npm install
```

### Step 3: Start Services

**Terminal 1 - API Gateway:**

```bash
cd api-gateway
npm run start:dev
```

**Terminal 2 - Order Service:**

```bash
cd order-service
npm run start:dev
```

### Step 4: Test with Thunder Client/Postman

**Create Order:**

```http
POST http://localhost:3000/orders
Content-Type: application/json

{
  "customerId": "CUST-001",
  "customerName": "John Doe",
  "customerEmail": "john@example.com",
  "items": [
    {
      "productId": "PROD-001",
      "productName": "Laptop",
      "quantity": 1,
      "unitPrice": 999.99
    }
  ],
  "deliveryAddress": {
    "street": "123 Main St",
    "city": "Colombo",
    "postalCode": "10000",
    "country": "Sri Lanka"
  }
}
```

---

## API Endpoints

### Create Order

```
POST /orders
```

**Request Body:**

```json
{
  "customerId": "string (required)",
  "customerName": "string (required)",
  "customerEmail": "email (required)",
  "items": [
    {
      "productId": "string (required)",
      "productName": "string (required)",
      "quantity": "number (min: 1)",
      "unitPrice": "number (positive)"
    }
  ],
  "deliveryAddress": {
    "street": "string (required)",
    "city": "string (required)",
    "postalCode": "string (required)",
    "country": "string (required)",
    "latitude": "number (optional)",
    "longitude": "number (optional)"
  }
}
```

**Response (201):**

```json
{
  "success": true,
  "message": "Order created successfully. Processing has begun.",
  "order": {
    "id": "ORD-2026-abc12345",
    "status": "PENDING",
    "totalPrice": 999.99,
    "createdAt": "2026-02-07T10:00:00.000Z"
  }
}
```

### Get Order

```
GET /orders/:id
```

### List Orders

```
GET /orders?status=PENDING&limit=20&skip=0
```

### Customer Orders

```
GET /orders/customer/:customerId
```

### Driver Orders

```
GET /orders/driver/:driverId?status=ASSIGNED
```

---

## WebSocket Events

### Connecting (Frontend)

```javascript
import { io } from "socket.io-client";

const socket = io("http://localhost:3000");

// Subscribe to customer updates
socket.emit("order:subscribe", { customerId: "CUST-001" });

// Listen for updates
socket.on("order:update", (data) => {
  console.log("Order updated:", data);
  // data.type: 'ORDER_CREATED' | 'STATUS_CHANGED'
  // data.order: { id, status, ... }
});
```

### Events

| Event Name          | Direction       | Payload                  |
| ------------------- | --------------- | ------------------------ |
| `order:subscribe`   | Client → Server | `{ customerId: string }` |
| `order:unsubscribe` | Client → Server | `{ customerId: string }` |
| `driver:subscribe`  | Client → Server | `{ driverId: string }`   |
| `order:update`      | Server → Client | `{ type, order }`        |
| `driver:update`     | Server → Client | `{ type, ... }`          |

---

## Integration Guide for Other Members

### For Member 2 (Integrator)

Your mock services need to listen on RabbitMQ queues and respond:

**CMS Mock (cms_queue):**

```typescript
// Listen for 'cms_create_order'
// Return: { success: true, cmsOrderId: 'CMS-123' }

// Listen for 'cms_cancel_order'
// Return: { success: true }
```

**WMS Mock (wms_queue):**

```typescript
// Listen for 'wms_check_stock'
// Return: { success: true, inStock: true, wmsPackageId: 'PKG-123' }
// OR: { success: true, inStock: false } (triggers compensation!)

// Listen for 'wms_release_stock'
// Return: { success: true }
```

**ROS Mock (ros_queue):**

```typescript
// Listen for 'ros_optimize_route'
// Return: { success: true, rosRouteId: 'ROUTE-123', estimatedDeliveryTime: '2026-02-07T15:00:00Z' }

// Listen for 'ros_cancel_route'
// Return: { success: true }
```

### For Member 3 (Frontend)

**API Base URL:** `http://localhost:3000`

**WebSocket:** `io('http://localhost:3000')`

**Key Endpoints:**

- `POST /orders` - Create order
- `GET /orders/:id` - Track order
- `GET /orders/customer/:id` - Customer history
- `GET /orders/driver/:id` - Driver manifest

**Real-time Updates:**

```javascript
socket.emit("order:subscribe", { customerId });
socket.on("order:update", handleUpdate);
```

### For Member 4 (Architect)

**Documentation Points:**

1. **Why RabbitMQ?**
   - Handles high volume (Black Friday requirement)
   - Message persistence (orders never lost)
   - Decouples services for scalability

2. **Saga Pattern Benefits:**
   - Manages distributed transactions
   - Provides clear rollback mechanism
   - Audit trail via saga steps

3. **Architecture Patterns Used:**
   - API Gateway Pattern
   - Saga Pattern (Orchestration)
   - Event-Driven Architecture
   - Microservices Architecture

---

## Status Codes Reference

| Status             | Meaning                         |
| ------------------ | ------------------------------- |
| `PENDING`          | Order created, saga not started |
| `CMS_PROCESSING`   | Waiting for CMS response        |
| `CMS_CONFIRMED`    | CMS accepted the order          |
| `WMS_PROCESSING`   | Checking stock in warehouse     |
| `WMS_CONFIRMED`    | Stock reserved                  |
| `WMS_OUT_OF_STOCK` | Out of stock (compensation)     |
| `ROS_PROCESSING`   | Optimizing delivery route       |
| `ROS_CONFIRMED`    | Route optimized                 |
| `ASSIGNED`         | Driver assigned                 |
| `IN_TRANSIT`       | Package being delivered         |
| `DELIVERED`        | Successfully delivered          |
| `FAILED`           | Order failed (compensated)      |
| `CANCELLED`        | Cancelled by user               |

---

## Troubleshooting

### RabbitMQ connection failed

```
Error: connect ECONNREFUSED 127.0.0.1:5672
```

**Solution:** Make sure Docker is running: `docker-compose up -d`

### MongoDB connection failed

```
Error: connect ECONNREFUSED 127.0.0.1:27017
```

**Solution:** Check MongoDB container: `docker ps`

### Order stuck in PENDING

**Check:**

1. Order Service is running
2. RabbitMQ queues have consumers
3. No errors in Order Service logs

### WebSocket not connecting

**Check:**

1. API Gateway is running
2. CORS is configured in main.ts
3. Frontend using correct URL

---

## Contact

For questions about:

- **API Gateway / Order Service:** Member 1
- **Mock Services (CMS/WMS/ROS):** Member 2
- **Frontend (React/Next.js):** Member 3
- **Documentation/Architecture:** Member 4
