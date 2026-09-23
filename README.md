# Harborview Dock Scheduler

Harborview Dock Scheduler is a web application for managing berth reservations at a marine research facility. It replaces a 23-year spreadsheet schedule that required staff to check manually for double-bookings and vessel-to-berth length mismatches.

**Live application:** https://dock-scheduling-system-nine.vercel.app/

## Features

- View reservations in a two-week calendar organized by berth and date
- Create, edit, move, resize, and delete vessel or event reservations
- Prevent reservations that exceed a berth's capacity
- Prevent vessels from being assigned to berths that are too short
- Search the complete reservation history by vessel or event name
- Browse and filter the complete reservation history by year, berth, or type
- Manage berth names, lengths, and capacities
- Audit existing reservations for scheduling and vessel-fit conflicts
- Export reservations as CSV for a selected date range or the complete history
- Load approximately 2,100 historical reservations from the provided spreadsheet

## Technology

- **Next.js and React:** User interface and API routes
- **TypeScript:** Static type checking
- **Prisma:** Database access and schema management
- **PostgreSQL:** Data storage (used in both local development and production)
- **Tailwind CSS:** Interface styling
- **date-fns:** Calendar calculations and date formatting

## Getting Started

### Requirements

- Node.js 20 or later
- npm
- Python 3, only if you need to rerun the spreadsheet conversion

### Installation

```bash
git clone <repository-url>
cd dock-scheduling-system
npm install
cp .env.example .env
npm run db:setup
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Available Commands

```bash
npm run dev                  # Start the development server
npm run build                # Create a production build
npm run start                # Start the production server
npm run lint                 # Run ESLint
npx tsc --noEmit             # Run the TypeScript type checker
npm run db:setup             # Apply migrations and reload seed data
npm run db:seed              # Reload seed data without running migrations
npm run convert-legacy-data  # Regenerate seed data from the source workbook
```

`npm run db:setup` reloads the historical seed data. Any reservations created locally will be replaced.

## Using the Application

### Calendar

The Calendar displays two weeks of reservations, grouped by berth. From this page, users can:

- Click an empty date to create a reservation
- Click a reservation to view, edit, or delete it
- Drag a reservation to move it to new dates
- Drag either edge of a reservation to change its duration
- Search for a vessel or event across the complete reservation history
- Export the visible range, the next 4 or 12 weeks, or the complete history

All reservation changes pass through the same server-side validation. If a drag or resize operation is rejected, the calendar restores the previous dates and explains the conflict.

### History

The calendar is built for the near term; the History page is built for looking back across all 23 years of records. It lists reservations in a plain table, filterable by year, berth, or vessel/event type, and sortable oldest-first or newest-first. Clicking a row opens the same reservation form used on the Calendar, so a mistake found while reviewing old records (a typo'd vessel length, for example) can be corrected in place. Results are capped at 300 rows at a time; narrowing the filters brings the rest into view.

### Berths

The Berths page manages the facility's physical inventory. Each berth has a name, an optional length, and a capacity. A standard berth accepts one reservation at a time. A multi-slip area can allow overlapping reservations.

### Data Quality

The Data Quality page scans existing reservations for:

- Overlapping reservations that exceed berth capacity
- Vessels with recorded lengths greater than their assigned berth lengths

The Calendar also displays a warning beside any berth with a detected conflict.

## Architecture

The project separates interface components, API routes, business rules, and data import logic.

```text
app/                 Next.js pages and API routes
components/          Calendar and reservation interface components
lib/                 Validation, date handling, database client, and shared types
prisma/              Database schema, migrations, and seed script
scripts/             Historical spreadsheet conversion script
data/                Generated seed data and the source workbook
```

Important files include:

- [`lib/validation.ts`](lib/validation.ts): berth-capacity and vessel-fit rules
- [`lib/calendar.ts`](lib/calendar.ts): calendar layout and client-side date handling
- [`app/api/reservations`](app/api/reservations): reservation read and write endpoints
- [`app/api/data-quality/route.ts`](app/api/data-quality/route.ts): full-dataset audit endpoint
- [`scripts/convert_legacy_xlsx.py`](scripts/convert_legacy_xlsx.py): historical data conversion
- [`prisma/schema.prisma`](prisma/schema.prisma): database models and relationships

### Data Model

```text
Berth
  id          Int       primary key
  name        String    unique
  lengthFt    Int?      null = no single fixed length applies
  capacity    Int?      1 = one occupant; null = multi-slip area
  notes       String?

Reservation
  id              Int             primary key
  berthId         Int             foreign key -> Berth.id
  occupantName    String
  occupantType    OccupantType    VESSEL | EVENT
  vesselLengthFt  Int?            null = unknown or not applicable
  startDate       DateTime        inclusive
  endDate         DateTime        inclusive
  notes           String?
```

Reservations use whole-day, inclusive date ranges because the source schedule is organized by day.

## Validation

The two primary business rules are defined in [`lib/validation.ts`](lib/validation.ts):

1. A reservation cannot cause a berth to exceed its capacity.
2. A vessel with a known length cannot be assigned to a shorter berth.

Reservation creation, form-based editing, dragging, and resizing all use the same validation functions. The Data Quality page also uses these rules when auditing existing records. Keeping the rules in one module ensures that every entry point evaluates reservations consistently.

Validation failures return structured API responses:

- `409 Conflict` for a capacity violation, including the conflicting reservations
- `422 Unprocessable Entity` for a vessel-length violation, including a plain-language explanation

## Historical Data Import

[`scripts/convert_legacy_xlsx.py`](scripts/convert_legacy_xlsx.py) converts the original spreadsheet into normalized berth and reservation records. It:

- Reconstructs dates from the workbook's month and day headers
- Combines consecutive cells for the same occupant into one reservation
- Handles the multi-row North Finger Piers section
- Classifies occupants as vessels or events
- Removes duplicate cells repeated across yearly tabs

The script writes the results to `data/berths.json` and `data/reservations.json`. [`prisma/seed.ts`](prisma/seed.ts) loads these files into the database.

To regenerate and reload the imported data:

```bash
npm run convert-legacy-data
npm run db:seed
```

## Assumptions and Design Decisions

### Berth Capacity

Most berths accept one occupant at a time. North Finger Piers represents several small-craft slips and contains simultaneous reservations in the source data. Standard berths therefore use `capacity = 1`, while North Finger Piers uses `capacity = null` to indicate a multi-slip area where overlap is allowed.

### Unknown Berth Lengths

North Finger Piers does not have one meaningful fixed length because it represents several slips. Its `lengthFt` value is `null`, so vessel-fit validation is skipped for that area.

### Unknown Historical Vessel Lengths

The source workbook does not consistently record vessel lengths. Imported reservations therefore use `vesselLengthFt = null`, and the system does not apply a length check when the source value is unknown. New reservations can include a vessel length, which is validated when both the vessel and berth lengths are available.

### Vessel and Event Classification

The workbook does not contain an explicit occupant type. During import, names beginning with common vessel prefixes such as `R/V`, `M/V`, `S/V`, `F/V`, `M/Y`, `S/Y`, `OSV`, `Tug`, or `Barge` are classified as vessels. Other records are classified as events.

This rule follows the naming conventions in the source data, but unusual names may be classified incorrectly. New reservations use an explicit Vessel or Event field and do not depend on name parsing.

### Duplicate Historical Records

Some yearly tabs repeat dates from the end of the previous December. The importer removes exact duplicates based on berth, date, and occupant before combining consecutive days into reservations. This prevents one historical booking from appearing to conflict with itself.

### Search

Search performs a substring match against the occupant name and searches the full 23-year history, regardless of the calendar range currently displayed. It does not search notes or dates.

### Date Handling

Date-only strings can shift by one day when interpreted as UTC and displayed in local time. Client-side calendar values pass through a shared `parseLocalDate` helper so the displayed date remains stable across time zones.

### Authentication

The application assumes a trusted internal team using one shared scheduling system. It does not currently include user accounts, permissions, or an audit log.

## Testing

The following checks have been completed:

- Type checking with `npx tsc --noEmit`
- Linting with `npm run lint`
- Production build with `npm run build`
- Calendar rendering with the imported dataset
- Reservation creation, editing, deletion, dragging, and resizing
- Rejection of overlapping reservations on single-capacity berths
- Rejection of vessels that exceed a berth's recorded length
- Berth creation, listing, and deletion
- Search across historical reservations
- Vessel-name autocomplete and CSV export
- Detection of conflicts inserted directly into the database

The repository does not currently include a maintained automated test suite. The first additions should be unit tests for overlap and vessel-fit validation, followed by API integration tests for reservation operations.

## Deployment

The application runs on Postgres in every environment, including local development, so the same `DATABASE_URL` works everywhere and no separate migration step is needed between environments.

Deploying to Vercel:

1. Push the repository to GitHub and import it into Vercel.
2. Add a Postgres database from Vercel's Storage tab (or any managed Postgres provider) and copy its connection string into the `DATABASE_URL` environment variable in the Vercel project settings.
3. Deploy. Vercel runs `npm install && npm run build`, and `postinstall` regenerates the Prisma client automatically.
4. Once deployed, apply the schema and load the seed data by running `npm run db:setup` locally with `DATABASE_URL` temporarily set to the same production connection string.

### Database Persistence

The application previously used SQLite for local development. SQLite files are convenient locally but are lost on ephemeral hosts (like Vercel's serverless functions) whenever the instance restarts, so the project now uses Postgres in every environment via `prisma db push`, which keeps the schema and validation layer identical to before while making production data durable.

## Current Limitations

- No authentication or role-based access control
- No audit history for reservation changes
- No automated unit or integration test suite
- Historical vessel lengths are unavailable for many imported reservations
- Vessel and event types are inferred during import when the source data is ambiguous

## Future Improvements

- Add unit and API integration tests
- Add authentication, permissions, and change history
- Add vessel records with reusable dimensions and metadata
- Add maintenance closures and configurable turnaround time between bookings
- Add notifications or approval workflows for reservation changes
