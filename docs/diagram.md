# SwiftTrack — System Diagrams

Visual companion to [system.md](system.md). All diagrams are [Mermaid](https://mermaid.js.org/)
and render on GitHub and in VS Code's Markdown preview (with a Mermaid extension).
Dashed arrows and grey nodes mark parts that are designed but not yet wired in the code.

1. [System context](#1-system-context)
2. [Containers and components](#2-containers-and-components)
3. [RabbitMQ topology](#3-rabbitmq-topology)
4. [Order placement — happy path](#4-order-placement--happy-path)
5. [Failure and compensation](#5-failure-and-compensation)
6. [Driver delivery and real-time push](#6-driver-delivery-and-real-time-push)
7. [Saga state machine](#7-saga-state-machine)
8. [Order status lifecycle](#8-order-status-lifecycle)
9. [Data model](#9-data-model)
10. [Frontend structure](#10-frontend-structure)
11. [Deployment](#11-deployment)
12. [Target architecture — legacy adapters](#12-target-architecture--legacy-adapters)

---

## 1. System context

Who uses SwiftTrack and which external systems it integrates.

```mermaid
flowchart LR
    client(["E-commerce client"])
    driver(["Delivery driver"])

    subgraph swifttrack["SwiftTrack platform"]
        st["SwiftTrack<br/>portal + driver app + middleware"]
    end

    cms[("CMS<br/>Client Management<br/>SOAP / XML, on-prem")]
    wms[("WMS<br/>Warehouse Management<br/>proprietary TCP/IP")]
    ros[("ROS<br/>Route Optimisation<br/>REST / JSON, cloud")]

    client -- "submit orders, track live" --> st
    driver -- "view manifest, mark delivered / failed" --> st
    st -- "create / cancel order" --> cms
    st -- "check / release stock" --> wms
    st -- "optimise / cancel route" --> ros
```

---

## 2. Containers and components

Every runtime part, its internal classes, and every connection between them.

```mermaid
flowchart TB
    subgraph browser["Browser — Next.js 16 client :3001"]
        direction LR
        portal["Client Portal<br/>/client"]
        driverApp["Driver App<br/>/driver"]
        hooks["useOrders · useSocket · useNotifications"]
        libs["lib/api.ts · lib/socket.ts"]
        portal --> hooks
        driverApp --> hooks
        hooks --> libs
    end

    subgraph gateway["API Gateway — NestJS hybrid app :3000"]
        direction TB
        ctrl["OrdersController<br/>REST"]
        wsgw["OrdersGateway<br/>Socket.io rooms"]
        svc["OrdersService<br/>persist · publish · push"]
        mh["OrdersMessageHandler<br/>@EventPattern consumers"]
        pub["ClientProxy ORDER_SERVICE"]
        ctrl --> svc
        mh --> svc
        svc --> wsgw
        svc --> pub
    end

    subgraph broker["RabbitMQ :5672 · UI :15672"]
        direction LR
        qOrders[["orders_queue"]]
        qCms[["cms_queue"]]
        qWms[["wms_queue"]]
        qRos[["ros_queue"]]
        qNotif[["notifications_queue"]]
    end

    subgraph orderSvc["Order Service — NestJS microservice, no HTTP"]
        direction TB
        omh["OrderMessageHandler<br/>order_created · manual ack"]
        saga["SagaOrchestratorService<br/>steps · compensation · notify"]
        omh --> saga
    end

    subgraph legacy["Legacy mocks — one NestJS process, 3 consumers"]
        direction LR
        cms["CMS mock<br/>SOAP stand-in"]
        wms["WMS mock<br/>TCP stand-in<br/>~10% out of stock"]
        ros["ROS mock<br/>REST stand-in"]
    end

    subgraph mongo["MongoDB :27017 — db swifttrack"]
        direction LR
        cOrders[("orders")]
        cSagas[("order_sagas")]
    end

    libs -- "REST / JSON" --> ctrl
    wsgw -- "Socket.io push<br/>order:update · driver:update" --> libs
    libs -- "order:subscribe · driver:subscribe" --> wsgw

    svc <--> cOrders
    pub -- "emit order_created" --> qOrders
    qOrders --> omh
    saga <--> cSagas

    saga -- "send + reply" --> qCms --> cms
    saga -- "send + reply" --> qWms --> wms
    saga -- "send + reply" --> qRos --> ros

    saga -- "emit order_status_updated<br/>saga_compensation_triggered" --> qNotif
    qNotif --> mh
```

---

## 3. RabbitMQ topology

Producers, queues, consumers and the message patterns on each queue.
Solid = event (`emit`, fire-and-forget). Thick = command (`send`, request–reply).
Dashed = handler exists but nothing produces the message yet.

```mermaid
flowchart LR
    GW_P["API Gateway<br/>(producer)"]
    OS["Order Service<br/>saga orchestrator"]
    GW_C["API Gateway<br/>(consumer, noAck: true)"]

    Q1[["orders_queue<br/>durable"]]
    Q2[["cms_queue<br/>durable"]]
    Q3[["wms_queue<br/>durable"]]
    Q4[["ros_queue<br/>durable"]]
    Q5[["notifications_queue<br/>durable"]]

    CMS["CMS mock"]
    WMS["WMS mock"]
    ROS["ROS mock"]
    FUT["future driver / ROS<br/>event producer"]:::future

    GW_P -- "order_created" --> Q1
    Q1 -- "noAck: false · prefetch 10" --> OS

    OS == "cms_create_order<br/>cms_cancel_order" ==> Q2
    Q2 ==> CMS
    OS == "wms_check_stock<br/>wms_release_stock" ==> Q3
    Q3 ==> WMS
    OS == "ros_optimize_route<br/>ros_cancel_route" ==> Q4
    Q4 ==> ROS

    CMS -. "reply via amq.rabbitmq.reply-to" .-> OS
    WMS -. "reply" .-> OS
    ROS -. "reply" .-> OS

    OS -- "order_status_updated<br/>saga_compensation_triggered" --> Q5
    FUT -. "delivery_completed<br/>driver_assigned" .-> Q5
    Q5 --> GW_C

    classDef future fill:#eee,stroke:#999,stroke-dasharray: 4 3,color:#666
```

---

## 4. Order placement — happy path

From the client pressing **Submit** to the order appearing on the driver's manifest.

```mermaid
sequenceDiagram
    autonumber
    actor C as Client (browser)
    participant GW as API Gateway
    participant DB1 as MongoDB orders
    participant MQ as RabbitMQ
    participant OS as Order Service
    participant DB2 as MongoDB order_sagas
    participant CMS as CMS mock
    participant WMS as WMS mock
    participant ROS as ROS mock
    actor D as Driver (browser)

    C->>GW: POST /orders {customer, items, address}
    GW->>GW: ValidationPipe, generate ORD-id, compute total
    GW->>DB1: insert order status=PENDING
    GW-)MQ: emit order_created → orders_queue
    GW--)C: Socket.io order:update ORDER_CREATED
    GW-->>C: 201 {id, status PENDING}

    MQ->>OS: deliver order_created
    OS->>DB2: insert saga STARTED, orderData snapshot

    rect rgb(230, 240, 255)
    Note over OS,CMS: Step 1 — CMS (30 s timeout)
    OS->>DB2: sagaState CMS_PENDING
    OS->>CMS: send cms_create_order (cms_queue)
    CMS-->>OS: {success, cmsOrderId}
    OS->>DB2: completedSteps += CMS_CREATE_ORDER, CMS_COMPLETED
    OS-)MQ: emit order_status_updated CMS_CONFIRMED
    MQ->>GW: notifications_queue
    GW->>DB1: status CMS_CONFIRMED, cmsOrderId, push sagaStep
    GW--)C: order:update STATUS_CHANGED
    end

    rect rgb(230, 250, 235)
    Note over OS,WMS: Step 2 — WMS (30 s timeout)
    OS->>DB2: sagaState WMS_PENDING
    OS->>WMS: send wms_check_stock (wms_queue)
    WMS-->>OS: {success, inStock true, wmsPackageId}
    OS->>DB2: completedSteps += WMS_RESERVE_STOCK, WMS_COMPLETED
    OS-)MQ: emit order_status_updated WMS_CONFIRMED
    MQ->>GW: notifications_queue
    GW->>DB1: status WMS_CONFIRMED, wmsPackageId
    GW--)C: order:update STATUS_CHANGED
    end

    rect rgb(245, 235, 255)
    Note over OS,ROS: Step 3 — ROS (30 s timeout)
    OS->>DB2: sagaState ROS_PENDING
    OS->>ROS: send ros_optimize_route (ros_queue)
    ROS-->>OS: {success, rosRouteId, ETA, route}
    OS->>DB2: completedSteps += ROS_OPTIMIZE_ROUTE, ROS_COMPLETED, COMPLETED
    OS-)MQ: emit order_status_updated ROS_CONFIRMED + ETA + driverId DRV-001
    MQ->>GW: notifications_queue
    GW->>DB1: status ROS_CONFIRMED, rosRouteId, ETA, driverId
    GW--)C: order:update STATUS_CHANGED
    GW--)D: driver:update STATUS_CHANGED (room driver:DRV-001)
    end

    OS->>MQ: ack order_created
```

---

## 5. Failure and compensation

WMS reports out of stock after CMS has already created the order. The orchestrator
undoes only what is in `completedSteps`, in reverse order.

```mermaid
sequenceDiagram
    autonumber
    actor C as Client (browser)
    participant GW as API Gateway
    participant MQ as RabbitMQ
    participant OS as Order Service
    participant DB2 as MongoDB order_sagas
    participant CMS as CMS mock
    participant WMS as WMS mock

    Note over OS,CMS: Step 1 succeeded — completedSteps = [CMS_CREATE_ORDER]

    OS->>WMS: send wms_check_stock
    WMS-->>OS: {success false, inStock false, error OUT_OF_STOCK}
    OS->>DB2: steps += WMS_CHECK_STOCK FAILED

    rect rgb(255, 235, 230)
    Note over OS,CMS: compensate(reason = WMS_OUT_OF_STOCK)
    OS->>DB2: sagaState COMPENSATING, failureReason
    OS->>DB2: read completedSteps
    Note right of OS: ROS_OPTIMIZE_ROUTE? no<br/>WMS_RESERVE_STOCK? no<br/>CMS_CREATE_ORDER? yes
    OS->>CMS: send cms_cancel_order {orderId, cmsOrderId}
    CMS-->>OS: {success true}
    OS->>DB2: steps += CMS_CANCEL_ORDER (compensated)
    OS->>DB2: sagaState FAILED
    end

    OS-)MQ: emit saga_compensation_triggered {reason, [CMS_CANCELLED]}
    OS-)MQ: emit order_status_updated FAILED
    MQ->>GW: notifications_queue
    GW->>GW: status FAILED, sagaSteps += [CMS] CMS_CANCELLED COMPENSATED
    GW--)C: order:update STATUS_CHANGED (FAILED)
    Note over C: error toast + browser notification,<br/>timeline shows the rollback
    OS->>MQ: ack order_created
```

The same path is taken when any `send()` times out after 30 s or ROS fails. The general rule:

```mermaid
flowchart TD
    F["Step fails, times out,<br/>or WMS says out of stock"] --> S["sagaState = COMPENSATING"]
    S --> R["read completedSteps from MongoDB"]
    R --> A{"ROS_OPTIMIZE_ROUTE<br/>completed?"}
    A -- yes --> A1["send ros_cancel_route"] --> B
    A -- no --> B{"WMS_RESERVE_STOCK<br/>completed?"}
    B -- yes --> B1["send wms_release_stock"] --> C
    B -- no --> C{"CMS_CREATE_ORDER<br/>completed?"}
    C -- yes --> C1["send cms_cancel_order"] --> E
    C -- no --> E["sagaState = FAILED"]
    E --> N["emit saga_compensation_triggered<br/>emit order_status_updated FAILED"]
    A1 -. "failure logged,<br/>not retried" .-> B
    B1 -. "failure logged,<br/>not retried" .-> C
```

---

## 6. Driver delivery and real-time push

The driver marks a stop delivered; the client's screen updates immediately.
This path is REST → MongoDB → Socket.io inside the gateway and does not go through RabbitMQ.

```mermaid
sequenceDiagram
    autonumber
    actor D as Driver (browser)
    participant GW as API Gateway
    participant DB1 as MongoDB orders
    actor C as Client (browser)

    D->>GW: GET /orders/driver/DRV-001
    GW->>DB1: find {driverId} sort by ETA
    GW-->>D: manifest
    D->>GW: socket driver:subscribe {DRV-001}
    C->>GW: socket order:subscribe {CUST-001}

    D->>GW: PATCH /orders/:id/delivery {status DELIVERED}
    GW->>DB1: status DELIVERED, deliveryProof.deliveredAt
    GW--)C: order:update STATUS_CHANGED (room customer:CUST-001)
    GW--)D: driver:update STATUS_CHANGED (room driver:DRV-001)
    GW->>DB1: sagaSteps += [ROS] DELIVERY_COMPLETED SUCCESS
    GW-->>D: 200 {order}
    Note over C: useOrders patches the card,<br/>useNotifications shows "Package Delivered!"<br/>toast + browser notification

    alt driver marks FAILED
        D->>GW: PATCH /orders/:id/delivery {status FAILED, failureReason}
        GW->>DB1: status FAILED, failureReason
        GW--)C: order:update (FAILED)
    end
```

Generic path for any update coming from the saga:

```mermaid
flowchart LR
    A["Order Service<br/>emit"] --> B[["notifications_queue"]]
    B --> C["OrdersMessageHandler"]
    C --> D["OrdersService.updateStatus<br/>findOneAndUpdate"]
    D --> E[("orders")]
    D --> F["OrdersGateway"]
    F -- "order:update" --> G["room customer:id"]
    F -- "driver:update<br/>if driverId set" --> H["room driver:id"]
    G --> I["useOrders: patch state<br/>useNotifications: toast"]
    H --> I
```

---

## 7. Saga state machine

`order_sagas.sagaState`, owned by the Order Service.

```mermaid
stateDiagram-v2
    [*] --> STARTED: order_created received
    STARTED --> CMS_PENDING
    CMS_PENDING --> CMS_COMPLETED: cmsOrderId returned
    CMS_COMPLETED --> WMS_PENDING
    WMS_PENDING --> WMS_COMPLETED: in stock
    WMS_COMPLETED --> ROS_PENDING
    ROS_PENDING --> ROS_COMPLETED: route returned
    ROS_COMPLETED --> COMPLETED
    COMPLETED --> [*]

    CMS_PENDING --> COMPENSATING: error / 30 s timeout
    WMS_PENDING --> COMPENSATING: out of stock / error / timeout
    ROS_PENDING --> COMPENSATING: error / timeout
    COMPENSATING --> FAILED: reverse completedSteps undone
    FAILED --> [*]
```

---

## 8. Order status lifecycle

`orders.status`, what clients and drivers see. Solid transitions are produced by the code
today; the states grouped under "Designed, not yet produced" are defined and handled by the UI,
but nothing sets them yet.

```mermaid
stateDiagram-v2
    [*] --> PENDING: POST /orders
    PENDING --> CMS_CONFIRMED: saga step 1
    CMS_CONFIRMED --> WMS_CONFIRMED: saga step 2
    WMS_CONFIRMED --> ROS_CONFIRMED: saga step 3 + driverId
    ROS_CONFIRMED --> DELIVERED: driver PATCH
    ROS_CONFIRMED --> FAILED: driver PATCH with reason

    PENDING --> FAILED: compensated
    CMS_CONFIRMED --> FAILED: compensated
    WMS_CONFIRMED --> FAILED: compensated

    DELIVERED --> [*]
    FAILED --> [*]

    state "Designed, not yet produced" as designed {
        CMS_PROCESSING
        WMS_PROCESSING
        WMS_OUT_OF_STOCK
        ROS_PROCESSING
        ASSIGNED
        IN_TRANSIT
        CANCELLED
    }
```

Intended full lifecycle once the gaps in [system.md §12](system.md#12-gaps-between-design-and-implementation) are closed:

```mermaid
flowchart LR
    P[PENDING] --> CP[CMS_PROCESSING] --> CC[CMS_CONFIRMED]
    CC --> WP[WMS_PROCESSING] --> WC[WMS_CONFIRMED]
    WP --> WO[WMS_OUT_OF_STOCK] --> F[FAILED]
    WC --> RP[ROS_PROCESSING] --> RC[ROS_CONFIRMED]
    RC --> AS[ASSIGNED] --> IT[IN_TRANSIT]
    IT --> DL[DELIVERED]
    IT --> F
    P --> X[CANCELLED]
```

---

## 9. Data model

Two collections in one MongoDB database, each owned by one service. Arrays and sub-objects
are embedded, not referenced. `orders.id` and `order_sagas.orderId` hold the same value but
neither service reads the other's collection.

```mermaid
erDiagram
    ORDERS ||--|{ ORDER_ITEM : "items[] embedded"
    ORDERS ||--|| DELIVERY_ADDRESS : "embedded"
    ORDERS ||--o{ SAGA_STEP : "sagaSteps[] timeline"
    ORDERS ||--o| DELIVERY_PROOF : "embedded"
    ORDERS ||..|| ORDER_SAGAS : "same order id, different owner"
    ORDER_SAGAS ||--o{ SAGA_STEP_RECORD : "steps[] log"

    ORDERS {
        string id PK "ORD-2026-xxxxxxxx, unique"
        string customerId "indexed"
        string customerName
        string customerEmail
        number totalPrice "computed server-side"
        string status "13-value enum, indexed"
        string cmsOrderId
        string wmsPackageId
        string rosRouteId
        string driverId "indexed"
        date estimatedDeliveryTime
        date createdAt
        date updatedAt
    }
    ORDER_ITEM {
        string productId
        string productName
        number quantity
        number unitPrice
    }
    DELIVERY_ADDRESS {
        string street
        string city
        string postalCode
        string country
        number latitude
        number longitude
    }
    SAGA_STEP {
        string service "CMS, WMS or ROS"
        string action
        string status "PENDING, SUCCESS, FAILED, COMPENSATED"
        date timestamp
        object response
        string error
    }
    DELIVERY_PROOF {
        string signature "base64 data URL"
        string photoUrl
        date deliveredAt
        string recipientName
    }
    ORDER_SAGAS {
        string orderId PK "unique"
        string sagaState
        object orderData "snapshot for retry"
        string cmsOrderId
        string wmsPackageId
        string rosRouteId
        string_array completedSteps "drives compensation"
        string failureReason
        date createdAt
        date updatedAt
    }
    SAGA_STEP_RECORD {
        string stepName
        string status
        date startedAt
        date completedAt
        object request
        object response
        string error
    }
```

---

## 10. Frontend structure

```mermaid
flowchart TB
    root["app/layout.tsx<br/>Providers (Toaster) + Navbar + ConnectionStatus"]
    root --> home["/ → redirect /client"]
    root --> cl["/client<br/>dashboard"]
    root --> dr["/driver<br/>manifest"]
    cl --> cn["/client/orders/new<br/>order form"]
    cl --> cd["/client/orders/[id]<br/>detail + OrderTimeline"]
    dr --> dd["/driver/deliveries/[id]<br/>mark delivered / failed"]

    subgraph hooks["hooks"]
        uo["useOrders<br/>REST fetch + room join + live patch"]
        un["useNotifications<br/>toasts + browser Notification API"]
        us["useSocket<br/>socket + isConnected"]
    end

    subgraph lib["lib"]
        api["api.ts<br/>ApiClient → :3000"]
        sock["socket.ts<br/>singleton io() → :3000"]
        types["types.ts<br/>mirror of shared/interfaces.ts"]
    end

    sp["SignaturePad<br/>(built, not yet used)"]:::future

    cl --> uo & un
    dr --> uo & un
    cd --> us & un & api
    dd --> us & un & api
    cn --> api
    uo --> api & us
    un --> us
    us --> sock
    dd -.-> sp

    classDef future fill:#eee,stroke:#999,stroke-dasharray: 4 3,color:#666
```

---

## 11. Deployment

`docker-compose.yml`: six containers on one bridge network with two named volumes.

```mermaid
flowchart TB
    user(["Browser on host"])

    subgraph host["Docker host"]
        subgraph net["swifttrack-network (bridge)"]
            client["swift-client<br/>Next.js · node:22-alpine<br/>container :3000"]
            gw["swift-api-gateway<br/>NestJS · node:18-alpine<br/>container :3000"]
            os["swift-order-service<br/>NestJS · no exposed port"]
            lm["swift-legacy-mock<br/>NestJS · no exposed port"]
            rmq["swift-rabbit<br/>rabbitmq:3-management<br/>:5672 AMQP · :15672 UI<br/>health check"]
            mdb["swift-mongo<br/>mongo:latest<br/>:27017"]
        end
        v1[("volume<br/>swifttrack-rabbitmq-data")]
        v2[("volume<br/>swifttrack-mongodb-data")]
    end

    user -- "host :3001" --> client
    user -- "host :3000 REST + WS" --> gw
    user -. "host :16000 mgmt UI" .-> rmq
    user -. "host :6000 AMQP" .-> rmq
    user -. "host :27017" .-> mdb

    gw -- "amqp://rabbitmq:5672" --> rmq
    os -- "amqp://rabbitmq:5672" --> rmq
    lm -- "amqp://rabbitmq:5672" --> rmq
    gw -- "mongodb://mongodb:27017" --> mdb
    os -- "mongodb://mongodb:27017" --> mdb
    rmq --- v1
    mdb --- v2

    gw -. "depends_on: healthy" .-> rmq
    os -. "depends_on: healthy" .-> rmq
    lm -. "depends_on: healthy" .-> rmq
```

| Host port | Container | Purpose |
| --- | --- | --- |
| 3001 | `swift-client:3000` | Web app |
| 3000 | `swift-api-gateway:3000` | REST + Socket.io |
| 6000 | `swift-rabbit:5672` | AMQP (moved from 5672 to avoid Windows reserved ports) |
| 16000 | `swift-rabbit:15672` | RabbitMQ management UI |
| 27017 | `swift-mongo:27017` | MongoDB |

---

## 12. Target architecture — legacy adapters

How the mocks are meant to be replaced: each adapter consumes canonical JSON from its queue,
translates it to the legacy protocol, and translates the reply back. The orchestrator does not
change.

```mermaid
flowchart LR
    OS["Order Service<br/>canonical JSON commands"]

    subgraph adapters["Adapter layer (Channel Adapter + Message Translator)"]
        A1["CMS adapter<br/>JSON ⇄ SOAP envelope"]
        A2["WMS adapter<br/>JSON ⇄ TCP frames<br/>(Node net socket)"]
        A3["ROS adapter<br/>JSON ⇄ REST call<br/>+ auth, TLS"]
    end

    Q2[["cms_queue"]]
    Q3[["wms_queue"]]
    Q4[["ros_queue"]]

    CMS[("CMS<br/>on-prem SOAP/XML")]
    WMS[("WMS<br/>proprietary TCP/IP")]
    ROS[("ROS<br/>cloud REST/JSON")]

    OS == "send" ==> Q2 ==> A1 -- "HTTP POST text/xml" --> CMS
    OS == "send" ==> Q3 ==> A2 -- "TCP stream" --> WMS
    OS == "send" ==> Q4 ==> A3 -- "HTTPS JSON" --> ROS

    A1 -. "reply" .-> OS
    A2 -. "reply" .-> OS
    A3 -. "reply" .-> OS
```
