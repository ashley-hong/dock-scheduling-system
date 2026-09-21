<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Project notes for future AI-assisted edits

This is a dock/berth reservation system (Next.js App Router + TypeScript +
Prisma/SQLite + Tailwind). See `README.md` for the full write-up (problem,
requirements, design decisions, and deployment). Quick orientation:

- `prisma/schema.prisma` — the two models: `Berth` (name, lengthFt, capacity)
  and `Reservation` (berthId, occupantName, occupantType, vesselLengthFt,
  startDate, endDate). `capacity: null` on a berth means "unlimited/multi-slip",
  not "no rule" — it's how the multi-vessel finger-piers area is modeled.
- `lib/validation.ts` — the two business rules (no double-booking beyond
  capacity, vessel must fit berth length) live here and are shared by the API
  routes (enforced on write) and `/data-quality` (audited on read). If you
  add a new business rule, put it here too rather than in a route handler.
- `app/api/**` — REST-ish route handlers. Overlap conflicts return 409,
  length mismatches return 422, both with a body the UI turns into a message.
- `app/page.tsx`, `app/berths/page.tsx`, `app/data-quality/page.tsx` — the
  three pages, all client components that call the API routes directly with
  `fetch` (no server actions, no client-side data-fetching library — kept
  deliberately simple).
- `scripts/convert_legacy_xlsx.py` + `data/*.json` + `prisma/seed.ts` — the
  pipeline that turned the original 23-year spreadsheet into seed data. Only
  worth touching if you need to re-import from `data/source/dock-schedule-sample.xlsx`.

Common commands:

```
npm run dev          # start the dev server (http://localhost:3000)
npm run db:setup      # apply migrations + reseed (destructive to local data)
npm run db:seed       # reseed without migrating
npx prisma studio     # browse/edit the SQLite DB in a GUI
npm run lint          # eslint
npx tsc --noEmit      # type-check
```

Local DB lives at `prisma/dev.db` and is git-ignored — safe to delete and
rerun `npm run db:setup` to get back to a clean state.

