# Frontend

The storefront is a Next.js 15 application with a responsive product catalog, product detail view, cart, AI chat sidebar, checkout, theming, and mobile keyboard handling.

## Development

```bash
pnpm install
pnpm dev
pnpm build
```

Set `NEXT_PUBLIC_API_URL` in `.env.local` to the FastAPI base URL.

## Structure

- `app/` — catalog, product detail, global tokens, and API routes.
- `components/ui/` — reusable UI, sidebars, checkout, and dialogs.
- `context/` — store, cart, chat, user, and theme state.
- `types/product.ts` — the shared product contract used by catalog, detail, and chat.

The content surface uses tokenized editorial styling but preserves the top bar, theme/accent selector, and push-sidebar behavior. Mobile inputs use at least 16px type and visual-viewport-aware layouts to avoid iOS focus zoom and keyboard obstruction.
