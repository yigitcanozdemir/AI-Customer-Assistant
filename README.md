# AI Customer Assistant

An end-to-end portfolio project for an AI customer-support agent that mirrors a multi-store shopping experience. It combines a Next.js storefront, a FastAPI two-pass agent, product/FAQ retrieval, order workflows, and production-oriented observability.

## Architecture

```mermaid
flowchart LR
  UI[Next.js storefront] -->|REST + WebSocket| API[FastAPI]
  API --> Agent[Two-pass agent]
  Agent --> LLM[Selected LLM provider]
  Agent --> DB[(Postgres + pgvector)]
  API --> Cache[(Redis)]
  API --> OpenObserve[OpenObserve: traces, metrics, logs]
  LLM --> Langfuse[Langfuse: LLM traces and evals]
```

## Quick start

1. Copy `.env.example` to `.env` and fill in the required values. At minimum:
   `LLM_PROVIDER`, `OPENAI_API_KEY` (also used for embeddings), `DATABASE_URL`,
   `REDIS_URL`, `FRONTEND_URL`, and `AUTH_SECRET`.
2. Start the app: `./scripts/dev.sh` (equivalent to `docker compose up --build`).
3. Run migrations: `uv run alembic upgrade head`.
4. Load the catalog: `uv run python backend/db/data_loader.py`.
5. In `frontend`, run `pnpm install` then `pnpm dev`.

### Observability (optional)

Observability is opt-in behind a compose profile, so the normal dev loop stays
light. Start the app with observability:

```bash
docker compose --profile obs up --build   # or: ./scripts/dev.sh obs
```

- **OpenObserve** → http://localhost:5080 (`admin@example.com` / `Complexpass#123`)
  — a single lightweight container for infra/app traces, metrics, and logs.
  Traces land automatically.
- **Langfuse** → http://localhost:3030 — LLM traces, token/cost, prompt versions, evals.

First run: open the Langfuse UI, create a project, copy its public/secret keys
into `.env` (`LANGFUSE_PUBLIC_KEY` / `LANGFUSE_SECRET_KEY`), and restart the
`fastapi` container. Without these keys the app still runs — LLM tracing is
simply skipped.

Stop everything with `./scripts/dev.sh down`.

For a production-like Docker setup, copy `.env.prod.example` to `.env.prod` and run `./scripts/setup.sh`.

## Key capabilities

- Provider-selected chat with OpenAI, Anthropic, or Gemini (`LLM_PROVIDER`).
- Two-pass agent: intent planning, parallel tool execution, fail-closed policy validation, and explicit confirmation for order changes.
- **Hybrid retrieval** — pgvector semantic search fused with a trigram keyword pass (reciprocal-rank fusion) over composite product embeddings.
- **Image search** — upload a garment or point at a shop item to find visually similar products (vision → text → search), the source item excluded from its own results.
- Store-scoped product search, FAQ retrieval, order tracking, returns, and cancellation workflows.
- Signed REST/WebSocket sessions, structured JSON Redis data, and a configurable demo-data expiry job.
- OpenObserve for application telemetry and Langfuse for per-turn LLM traces, prompt versions, costs, and evaluations.
- Bring-your-own-store loader: add a pair of catalog and FAQ JSON files—no source code changes required.

## Documentation

| Doc | What's inside |
| --- | --- |
| [Architecture](docs/ARCHITECTURE.md) | System context, two-pass agent, provider boundary, data & infra |
| [Diagrams](docs/DIAGRAMS.md) | ERD, sequence diagrams, context state machine, module map |
| [API reference](docs/API_REFERENCE.md) | REST endpoints + WebSocket chat protocol schema |
| [RAG pipeline](docs/RAG.md) | Embedding, hybrid search, RRF, image/similar-item search |
| [Observability](docs/OBSERVABILITY.md) | OpenObserve + Langfuse setup and rationale |
| [Data loader](docs/DATA_LOADER.md) | Bring-your-own-store catalog/FAQ ingestion |

Backend and frontend setup details live in their respective READMEs
([backend](backend/README.md) · [frontend](frontend/README.md)).
