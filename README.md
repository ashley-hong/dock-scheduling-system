# Harborview Dock Scheduler

A berth reservation system for a marine research facility, built to replace a
23-year-old spreadsheet grid that had to be checked by eye for double-bookings
and vessel/berth-length mismatches.

**Live demo:** _add your deployed URL here_
**Repo:** this repository

This document is organized around the six phases of the development
lifecycle, so the reasoning behind the project — not just the code — is easy
to follow.

---

## 1. Planning & Feasibility

**Problem.** A waterfront facility assigns berths of varying length to
vessels and to non-vessel events (e.g. community sail days) for date ranges.
The existing process is a spreadsheet grid (one tab per year, berths as rows,
days as columns) that a person has to scan visually to answer two questions
before approving a booking: *"is this berth free on these dates?"* and *"does
this vessel actually fit?"* Both are easy to get wrong by eye, especially
across 20+ years of data.

**Goal.** Build a small web application that answers both questions
automatically at the moment a reservation is made, replacing manual
grid-checking, and prove it against the facility's own 23 years of historical
bookings rather than toy data.

**Scope.**
- In scope: berth management, reservation CRUD, automatic double-booking and
  length-fit checks, a calendar view of the schedule, an on-demand audit of
  existing data, and importing the provided historical spreadsheet.
- Out of scope (explicitly, to fit a focused build): user accounts/auth
  (single trusted internal tool), notifications/emails, billing, multi-facility
  support. These are natural "next steps," not gaps I missed — see
  Section 3 for why each was left out.

**Feasibility.** Everything used is free and needs no paid accounts: Next.js
+ SQLite run entirely within the app itself (no external database service to
provision), and the whole thing deploys to a free hosting tier. That made a
working, publicly-accessible system achievable without any infrastructure
cost or setup overhead.

---

## 2. Requirements Analysis

**Functional requirements**

| # | Requirement |
|---|---|
| FR1 | Create, edit, and delete berths, each with a name and (optionally) a fixed length. |
| FR2 | Create, edit, and delete reservations: a berth, an occupant (vessel or event), a date range, and — for vessels — a length. |
| FR3 | Reject a reservation that would double-book a berth (more simultaneous occupants than the berth allows). |
| FR4 | Reject a vessel reservation if the vessel is longer than its assigned berth. |
| FR5 | Show a calendar-style grid of berths × days so the schedule can be read at a glance. |
| FR6 | Provide an on-demand report of any double-bookings or length mismatches that exist in the current data, without requiring a manual scan. |
| FR7 | Import the 23 years of historical bookings from the provided spreadsheet as a working dataset, not just a handful of fixtures. |

**Non-functional requirements**

| # | Requirement |
|---|---|
| NFR1 | Runs as a public web app reachable by URL — no local setup required to review it. |
| NFR2 | Built on mainstream, well-documented technology so it's realistic to keep extending with AI pair-programming (Claude Code) by someone without a software background. |
| NFR3 | No authentication — a single shared internal tool is assumed; see Section 3. |
| NFR4 | Comfortably handles the actual data volume involved (~2,100 historical reservations, 7 berths) without needing pagination or caching. |

---

## 3. Design

### Data model

```
Berth
  id, name (unique)
  lengthFt   Int?     // null = no single fixed length applies
  capacity   Int?     // null = unlimited/multi-slip; default 1 = one occupant at a time

Reservation
  id, berthId -> Berth
  occupantName, occupantType (VESSEL | EVENT)
  vesselLengthFt Int?
  startDate, endDate  // whole-day granularity
  notes
```

The two business rules — capacity and length-fit — both live in
[`lib/validation.ts`](lib/validation.ts) and are reused in two places: the
API rejects a write that breaks either rule, and the **Data Quality** page
runs the same checks read-only across everything already in the database.
That's the direct replacement for "look at the grid and check by eye."

### Key design decisions and assumptions

These came from actually parsing the provided 23-year spreadsheet
([`scripts/convert_legacy_xlsx.py`](scripts/convert_legacy_xlsx.py)), not
from guessing at the domain:

- **`capacity` instead of a one-off "allow rafting" flag.** The source data
  has a "North Finger Piers" area that's laid out as 2–3 simultaneous rows of
  small-craft slips rather than one berth with one occupant, and a separate
  contact sheet notes a yacht that "will raft alongside if needed." Rather
  than special-case rafting, a berth's `capacity` says how many reservations
  may legitimately overlap: `1` (the default) for a normal single-vessel
  berth, `null` for a multi-slot area. This is a general mechanism, not a
  patch for one berth.
- **No single length for the finger piers.** That same area doesn't have one
  fixed length in the source data (it's a bank of small-craft slips), so it's
  imported with `lengthFt = null`, which skips the length-fit check for it.
- **Vessel vs. event classification is prefix-based.** The historical
  occupant strings follow a real naming convention (`R/V`, `M/V`, `S/V`,
  `F/V`, `M/Y`, `S/Y`, `OSV`, `Tug`, `Barge`), so the importer classifies
  anything starting with one of those as a vessel and everything else
  (`Community sail day`, `Bollard replacement, west face`, `ETA 1400`, …) as
  an event. A few edge cases like "Bunker barge" may be misclassified since
  the source never tagged type explicitly — a real system would want an
  explicit type field at data-entry time, which the app now provides going
  forward.
- **Historical vessel lengths are unknown.** The legacy spreadsheet didn't
  reliably record a vessel's length next to each booking, so imported
  reservations have `vesselLengthFt = null` and are exempt from the length
  check. New reservations entered through the app require a length when the
  occupant is a vessel, so the check is fully active going forward — it just
  can't be retroactively applied to bookings where the source data never
  captured it.
- **Found and fixed a real data artifact.** A few year-tabs in the source
  workbook duplicate the tail end of the previous year's December block
  (a copy-paste leftover from when each new year's tab was created). Without
  deduplicating identical `(berth, date, occupant)` entries, the importer
  would have reported the same historical booking as double-booked against
  itself. This is exactly the kind of manual-spreadsheet error the project
  is meant to prevent, and it's worth calling out that it was caught during
  import, not shipped as bad data.
- **No authentication.** Treated as a single-user/trusted-staff internal
  tool, matching how the original spreadsheet was used (one shared file,
  one dock coordinator). This is the most obvious next feature for a
  multi-user deployment, not an oversight.

### API & UI shape

REST-style routes under `/api/berths` and `/api/reservations` (standard
CRUD), plus `/api/data-quality` for the audit. Validation failures return a
structured error (`409` for an overlap with the conflicting reservations
attached, `422` for a length mismatch with a human-readable reason) that the
UI turns directly into an inline message — the goal is that a bad booking is
rejected with an explanation, not a generic failure.

Three pages, matching the three things the prompt actually asks for: a
**Calendar** to see and make bookings, **Berths** to manage the physical
inventory (name, length, capacity), and **Data Quality** to audit what's
already booked.

---

## 4. Development

**Stack:** Next.js (App Router, TypeScript), Prisma ORM + SQLite, Tailwind
CSS, `date-fns`. Chosen for being mainstream and thoroughly documented —
important both for a 3–5 hour build and for being realistic to keep editing
with an AI assistant afterward (see `AGENTS.md`).

**Legacy data pipeline** (a first-class part of this project, not a
one-off script): [`scripts/convert_legacy_xlsx.py`](scripts/convert_legacy_xlsx.py)
parses the original grid workbook — reconstructing calendar dates from the
month-block headers, collapsing consecutive same-occupant days into date
ranges, and handling the finger-piers multi-row section — into
`data/berths.json` and `data/reservations.json`. `prisma/seed.ts` loads those
into the database. Re-run the whole pipeline with:

```
npm run convert-legacy-data   # regenerate data/*.json from the source .xlsx
npm run db:seed               # load it into the database
```

**Repo layout**

```
app/                 # Next.js App Router pages + API routes
components/          # shared client components (e.g. the reservation form modal)
lib/                 # prisma client, validation rules, shared types
prisma/              # schema, migrations, seed script
scripts/             # the legacy-spreadsheet conversion script
data/                # generated seed JSON + the original source spreadsheet
```

---

## 5. Testing

What was actually verified before calling this done:

- `npx tsc --noEmit` — clean, no type errors.
- `npm run lint` — clean.
- `npm run build` — production build succeeds.
- Manual + scripted browser testing (Playwright) of the real user flow:
  calendar loads and renders seeded berths, creating a reservation through
  the UI persists and re-renders correctly, an overlapping reservation is
  rejected with a `409` and the conflicting booking named in the error, an
  oversized vessel is rejected with a `422` and a plain-language reason, the
  Berths page adds/lists/deletes correctly, and the Data Quality page
  correctly reports zero conflicts against the (deduplicated) historical
  dataset.

**Known gap:** there's no automated test suite (unit or integration) checked
into the repo — given the scoped time budget, verification was manual/scripted
rather than a maintained suite. If this were going further, `lib/validation.ts`
(the overlap and length-fit logic) is exactly where I'd start, since it's the
part correctness most depends on.

---

## 6. Deployment

The app is a standard Next.js app and deploys anywhere that runs Node. Steps
for [Render](https://render.com) (free, no credit card required):

1. Push this repo to GitHub (already done if you're reading this there).
2. In Render, **New → Web Service**, connect the GitHub repo.
3. Build command: `npm install && npm run build`
   Start command: `npm run db:setup && npm start`
4. Add an environment variable `DATABASE_URL` = `file:./dev.db`.
5. Deploy. The first boot runs migrations and seeds the 23 years of
   historical data automatically.

**Known limitation, stated plainly:** Render's free tier has no persistent
disk, so the SQLite file resets to the seeded historical dataset whenever the
instance restarts after a period of inactivity — any reservations added
during a demo session won't survive a cold start. For a real deployment, the
fix is a managed database instead of a local file: swap `provider = "sqlite"`
for `provider = "postgresql"` in `prisma/schema.prisma`, point `DATABASE_URL`
at a hosted Postgres instance (e.g. a free one from
[Neon](https://neon.tech) or Render's own Postgres), and everything else —
schema, validation, API, UI — is unchanged, since Prisma abstracts the
database engine. This is a deliberate scope call for a take-home exercise,
not something I didn't notice.
