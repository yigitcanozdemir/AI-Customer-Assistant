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
- `lib/chat-suggestions.ts` — the quick-reply chips, defined once. Every chip must map to a real backend capability; they were previously copy-pasted across four call sites and had drifted.
- `lib/session-lifecycle.ts` — tab-close cleanup: beacons `POST /session/{id}/end` and wipes local storage.
- `types/product.ts` — the shared product contract used by catalog, detail, and chat.

The content surface uses tokenized editorial styling but preserves the top bar, theme/accent selector, and push-sidebar behavior. Mobile inputs use at least 16px type and visual-viewport-aware layouts to avoid iOS focus zoom and keyboard obstruction; modals use `dvh` heights and `env(safe-area-inset-bottom)` so browser chrome and the iOS home indicator cannot cover controls.

## Chat features surfaced in the UI

Text search, image search (the image button on the composer), per-variant stock,
order tracking on a map, returns and cancellations with in-chat confirmation, and
replies that follow the visitor's language. Session data is deleted on tab close
— see [data retention](../docs/API_REFERENCE.md#data-retention).
