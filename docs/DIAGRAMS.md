# Diagrams

Visual reference for the system: data model, runtime sequences, and the
conversation-context state machine. All diagrams are Mermaid and render inline
on GitHub. See also [ARCHITECTURE.md](ARCHITECTURE.md) and [RAG.md](RAG.md).

- [Container view](#container-view)
- [Data model (ERD)](#data-model-erd)
- [Sequence — standard chat turn](#sequence--standard-chat-turn)
- [Sequence — order modification with confirmation](#sequence--order-modification-with-confirmation)
- [Sequence — image and similar-item search](#sequence--image-and-similar-item-search)
- [Conversation-context state](#conversation-context-state)
- [Module map](#module-map)

## Container view

```mermaid
flowchart TB
  subgraph Client
    UI[Next.js storefront<br/>catalog · cart · chat sidebar]
  end

  subgraph Backend[FastAPI backend]
    REST[REST routes]
    WS[WebSocket chat]
    Agent[TwoPassAgent]
    Tools[Tools: product/FAQ/variant/order/tracking]
    Provider[LLM provider boundary]
    Auth[Signed sessions]
  end

  subgraph Data
    PG[(Postgres + pgvector)]
    Redis[(Redis)]
  end

  subgraph Telemetry
    OO[(OpenObserve)]
    LF[(Langfuse)]
  end

  LLM[(OpenAI / Anthropic / Gemini)]

  UI -->|REST| REST
  UI -->|WebSocket| WS
  WS --> Auth
  WS --> Agent
  Agent --> Tools
  Agent --> Provider
  Provider --> LLM
  Tools --> PG
  REST --> PG
  Agent --> Redis
  REST --> Redis
  Backend -.OTel.-> OO
  Provider -.traces/cost.-> LF
```

## Data model (ERD)

Postgres schema ([`db/schema.py`](../backend/db/schema.py)). Vectors are
`pgvector` columns; product embeddings use an HNSW cosine index and product
name/category have trigram GIN indexes for the hybrid keyword pass.

```mermaid
erDiagram
  PRODUCT ||--o{ VARIANT   : has
  PRODUCT ||--o{ IMAGE     : has
  PRODUCT ||--o{ EMBEDDING : has
  PRODUCT ||--o{ ORDER     : "ordered as"
  VARIANT ||--o{ ORDER     : "chosen in"

  PRODUCT {
    uuid   id PK
    string store
    text   name
    string category
    numeric price
    string currency
    text   description
    array  tags
  }
  VARIANT {
    uuid   id PK
    uuid   product_id FK
    string color
    string size
    int    stock
  }
  IMAGE {
    uuid id PK
    uuid product_id FK
    text url
  }
  EMBEDDING {
    uuid   id PK
    uuid   product_id FK
    text   description "composite embed text"
    vector embedding "1536-dim"
  }
  FAQ {
    uuid   id PK
    string store
    text   content
    vector embedding "1536-dim"
  }
  ORDER {
    uuid   order_id PK
    uuid   user_id
    uuid   product_id FK
    uuid   variant_id FK
    string store
    string status
    jsonb  current_location
    jsonb  delivery_address
  }
  FLAGGED_SESSION {
    uuid    id PK
    string  session_id
    uuid    user_id
    string  store
    bool    requires_human
    float   confidence_score
    text    user_query
    text    assistant_response
    json    message_history
  }
```

`FAQ` and `FLAGGED_SESSION` are intentionally standalone (no FKs): FAQs are
store-scoped text, and a flagged session is an audit snapshot of one turn.

## Sequence — standard chat turn

```mermaid
sequenceDiagram
  autonumber
  participant UI as Storefront
  participant WS as WebSocket
  participant AG as TwoPassAgent
  participant LLM as Provider
  participant DB as Postgres/pgvector
  participant RD as Redis

  UI->>WS: EventSchema { question, store, … }
  WS->>WS: verify_token, session lock check
  WS->>AG: execute(user_input, store, user_id, …)
  AG->>RD: load conversation context
  AG->>LLM: parse Pass1Output (intent + tool plan)
  LLM-->>AG: intent, tool_calls, assessment
  AG->>AG: apply intent-transition context policy
  par tools in parallel
    AG->>DB: product_search / faq_search / …
    DB-->>AG: results
  end
  AG->>LLM: generate(Pass 2 response)
  LLM-->>AG: natural-language reply
  AG->>RD: persist updated context
  AG-->>WS: MessageResponse { content, products, … }
  WS-->>UI: MessageResponse
```

## Sequence — order modification with confirmation

Order changes are **two-step and fail-closed**: the policy gate must allow the
action, and the user must confirm before anything is processed.

```mermaid
sequenceDiagram
  autonumber
  participant UI
  participant AG as TwoPassAgent
  participant LLM as Provider
  participant DB as Postgres
  participant RD as Redis

  UI->>AG: "return this order" (order in context)
  AG->>LLM: Pass 1 → intent=order_modification
  AG->>DB: faq_search("return policy")
  AG->>LLM: policy validation (structured, fail-closed)
  alt allowed
    AG->>RD: store pending_action (TTL)
    AG-->>UI: MessageResponse { pending_action }
    UI->>AG: event { confirm_action_id }
    AG->>DB: process_order(return)
    AG-->>UI: success message
  else denied
    AG-->>UI: explanation, no action taken
  end
```

## Sequence — image and similar-item search

Both entry points converge on the same vision→text→hybrid-search path. For a
selected shop item, the item's own catalog image is used and the source product
is excluded from its own results.

```mermaid
sequenceDiagram
  autonumber
  participant UI
  participant AG as TwoPassAgent
  participant LLM as Provider (vision)
  participant DB as pgvector

  alt user uploaded an image
    UI->>AG: event { image }
    AG->>LLM: describe_image(uploaded)
  else "similar to THIS shop item"
    UI->>AG: "show similar" (product in context)
    AG->>DB: get_product_primary_image(id)
    AG->>LLM: describe_image(item image)
    Note over AG: set exclude_product_id = source id
  end
  LLM-->>AG: visual description (text)
  AG->>DB: hybrid product_search(description, exclude_product_id)
  DB-->>AG: similar products (source omitted)
  AG-->>UI: MessageResponse { products }
```

## Conversation-context state

The agent retains product/order/pending references only while the intent
permits. `context_policy.apply_intent_transitions` clears stale references
**before** planning the next turn, preventing cross-question bleed. Specific
references ("this", "it") keep context; generic ones ("an order", "another")
clear it.

```mermaid
stateDiagram-v2
  [*] --> Idle
  Idle --> Browsing        : product_search / product selected
  Browsing --> Browsing    : refine / "similar to this"
  Browsing --> OrderFlow   : order intent (clears product ctx)

  Idle --> OrderFlow       : track / modify order
  OrderFlow --> Tracking   : order_tracking
  OrderFlow --> Modifying  : order_modification (specific ref)
  Modifying --> Confirming : policy allows → pending_action
  Confirming --> OrderFlow : confirmed / declined
  Tracking --> OrderFlow   : "another order" (generic → clear)

  OrderFlow --> Browsing   : product intent (clears order ctx)
  Browsing --> Idle        : reset / new topic
  OrderFlow --> Locked     : repeated policy violations
  Locked --> [*]
```

## Module map

```mermaid
flowchart LR
  subgraph api
    endpoint[endpoint.py<br/>REST + WS]
    agent[agent.py<br/>TwoPassAgent]
    schema[agent_schema.py<br/>Pass1Output, tools]
    policy[context_policy.py]
  end
  subgraph services
    tool[tool.py<br/>search + order tools]
    ctx[context_manager.py]
    cache[cache.py]
    auth[auth.py]
    subgraph llm
      base[base.py LLMProvider]
      openai[openai_provider.py]
      tracing[tracing.py TracedProvider]
    end
  end
  subgraph db
    dbschema[schema.py]
    loader[data_loader.py]
    logic[database_logic.py<br/>embeddings]
  end
  prompts[prompts/*.txt]

  endpoint --> agent
  agent --> schema
  agent --> policy
  agent --> tool
  agent --> ctx
  agent --> prompts
  agent --> base
  openai -->|implements| base
  tracing -->|wraps| base
  tool --> dbschema
  tool --> cache
  loader --> logic
  logic --> dbschema
```
