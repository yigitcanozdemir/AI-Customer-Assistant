# Bring your own store data

The loader discovers stores by filename. Put these two files in one directory:

```text
my_store_products.json
my_store_faq.json
```

It derives the display name (`My Store`), pairs the files, and skips loading when products already exist.

Run it inside the container, so it resolves the `db`/`redis` service hostnames
from `.env`. Mount your folder and point `DATA_DIR` at the mounted path:

```bash
# simplest: replace the JSON files in backend/db/jsons/, then
docker compose exec fastapi uv run python -m backend.db.data_loader --reset

# or keep your catalogue elsewhere and mount it (path must be inside a directory
# Docker is allowed to share, e.g. within the repo or your home dir)
docker compose run --rm --no-deps \
  -v /absolute/path/to/catalog:/data \
  -e DATA_DIR=/data \
  fastapi uv run python -m backend.db.data_loader --reset
```

`--no-deps` matters on the second form: without it `run --rm` stops `db` and
`redis` when the loader exits, taking the running app down with it.

`--reset` wipes catalog data (products, variants, images, embeddings, FAQs) and
reloads. Without it the loader is a no-op once products exist, so **you need
`--reset` when swapping in new data**. Orders and chat sessions are untouched.

Embedding every product costs a little OpenAI usage (`text-embedding-3-small`),
so expect a small charge proportional to catalogue size.

From the host instead? `.env` uses Docker service names, so override the host
part: `DATABASE_URL=postgresql+asyncpg://user:password@localhost:5432/ecommerce
REDIS_URL=redis://localhost:6379 uv run python -m backend.db.data_loader`.

## Also update the storefront's store list

The loader is data-only. The switcher in the UI is a hardcoded list, so a new
store loads into the database but will not appear until you add its display name
(exactly as derived from the filename) to:

- [`frontend/app/page.tsx`](../frontend/app/page.tsx) — the `stores` array
- [`frontend/context/StoreContext.tsx`](../frontend/context/StoreContext.tsx) — the default store
- [`frontend/components/ui/flagged-sessions.tsx`](../frontend/components/ui/flagged-sessions.tsx) — the admin filter

## Product schema

```json
[
  {
    "id": "my-store-001",
    "name": "LINEN OVERSHIRT",
    "price": 89.0,
    "currency": "USD",
    "description": "Lightweight overshirt.",
    "tags": ["linen", "summer"],
    "colors": [{
      "name": "Sand",
      "images": ["https://images.example.com/overshirt.jpg"],
      "variants": [{"size": "M", "stock": 12}]
    }]
  }
]
```

`name` is required. `price`, `currency`, `description`, `tags`, and `colors` are supported. Each color may include image URLs and variants with `size` and `stock`.

## FAQ schema

```json
[
  {
    "store": "My Store",
    "policies": [
      {"question": "What is your return window?", "answer": "Returns are accepted within 30 days."}
    ]
  }
]
```

The full JSON is transformed into searchable FAQ text. Keep each policy direct and store-specific so order validation can cite the correct rule.
