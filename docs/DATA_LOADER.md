# Bring your own store data

The loader discovers stores by filename. Put these two files in one directory:

```text
my_store_products.json
my_store_faq.json
```

It derives the display name (`My Store`), pairs the files, and skips loading when products already exist. Use the built-in directory by default, or point the loader at a custom folder:

```bash
DATA_DIR=/absolute/path/to/catalog uv run python backend/db/data_loader.py
# or
uv run python backend/db/data_loader.py --data-dir /absolute/path/to/catalog
```

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
