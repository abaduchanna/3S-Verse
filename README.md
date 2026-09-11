# 3S Verse

**Software, systems & operations.** 3S Verse designs and builds apps, websites, AI agents, dashboards, and process automation that cut the manual work and keep your operation moving — backed by 12+ years of real operations experience.

## What's inside

This repository is a pnpm monorepo containing the 3S Verse web presence and its supporting services:

| Path | What it is |
| --- | --- |
| `artifacts/landing-page/` | The 3S Verse marketing site — React 19 + Vite + Tailwind CSS 4 + Framer Motion, with light/dark theme, contact form, and animated sections |
| `artifacts/api-server/` | Express 5 API backing the site's contact form (per-IP rate limiting + honeypot bot protection) |
| `artifacts/mockup-sandbox/` | Vite sandbox for UI mockups and design experiments |
| `lib/api-spec/` | OpenAPI source of truth for the API contract |
| `lib/api-zod/` | Zod schemas generated from the OpenAPI spec (Orval) |
| `lib/api-client-react/` | Typed React query hooks generated from the same spec |
| `lib/db/` | PostgreSQL schema + Drizzle ORM setup |

## Getting started

Requires Node.js 24 and [pnpm](https://pnpm.io).

```bash
pnpm install
pnpm --filter @workspace/landing-page run dev     # site on Vite dev server
pnpm --filter @workspace/api-server run dev       # API server on port 5000
```

## Useful commands

```bash
pnpm run typecheck                                 # typecheck across all packages
pnpm run build                                     # typecheck + build everything
pnpm --filter @workspace/api-spec run codegen      # regenerate API hooks + Zod schemas
pnpm --filter @workspace/db run push               # push DB schema changes (dev only)
```

Required environment: `DATABASE_URL` — Postgres connection string (API server + DB tooling).

## Contact

- Email: [Connect@3SVerse.com](mailto:Connect@3SVerse.com)
