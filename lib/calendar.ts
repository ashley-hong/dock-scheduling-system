import { format } from "date-fns";
import type { Reservation } from "@/lib/types";

/**
 * Calendar-grid-only date handling: these treat "YYYY-MM-DD" as a plain
 * calendar day in the *viewer's* local timezone, unlike lib/dates.ts (which
 * parses the same string as UTC for server-side storage/comparison, so it's
 * timezone-independent there). Mixing the two - e.g. `new Date("2026-09-22")`
 * (parsed as UTC midnight) followed by a local-time `format()` - silently
 * shows the wrong day for anyone west of UTC. Always go through
 * `parseLocalDate` on the client before formatting or doing date math.
 */
export function parseLocalDate(iso: string): Date {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function toISODate(d: Date): string {
  return format(d, "yyyy-MM-dd");
}

export function addDaysToIso(iso: string, amount: number): string {
  const d = parseLocalDate(iso);
  d.setDate(d.getDate() + amount);
  return toISODate(d);
}

/** Whole-day difference between two "YYYY-MM-DD" strings (timezone-safe
 * since both sides go through the same UTC parse and the offset cancels). */
export function daysBetween(startIso: string, endIso: string): number {
  const start = new Date(startIso.slice(0, 10));
  const end = new Date(endIso.slice(0, 10));
  return Math.round((end.getTime() - start.getTime()) / 86_400_000);
}

/** Formats a "HH:MM" 24-hour time (as stored/validated in
 * lib/validation.ts's checkTimeWindow) as a 12-hour label, e.g. "8:30 AM". */
export function formatTimeLabel(time: string): string {
  const [h, m] = time.split(":").map(Number);
  const period = h < 12 ? "AM" : "PM";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m).padStart(2, "0")} ${period}`;
}

/** The next 30-minute slot at least an hour after `checkOutTime`, or null
 * if that would fall after operating hours (5:00 PM) - matching
 * lib/validation.ts's checkTimeWindow bounds. Used to suggest a same-day
 * follow-up booking's check-in time right after a berth frees up. */
export function nextCheckInAfter(checkOutTime: string): string | null {
  const [h, m] = checkOutTime.split(":").map(Number);
  const minutes = h * 60 + m + 60;
  if (minutes > 17 * 60) return null;
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

export function subtext(r: Reservation): string {
  const parts: string[] = [];
  if (r.occupantType === "VESSEL" && r.vesselLengthFt) parts.push(`${r.vesselLengthFt} ft`);
  const start = r.startDate.slice(0, 10);
  const end = r.endDate.slice(0, 10);
  if (start !== end) {
    parts.push(`${format(parseLocalDate(start), "M/d")}–${format(parseLocalDate(end), "M/d")}`);
  } else if (r.checkInTime || r.checkOutTime) {
    parts.push(
      [r.checkInTime, r.checkOutTime].filter(Boolean).map((t) => formatTimeLabel(t!)).join("–")
    );
  }
  return parts.join(" · ");
}

export function tooltipText(r: Reservation): string {
  const start = format(parseLocalDate(r.startDate), "MMM d, yyyy");
  const end = format(parseLocalDate(r.endDate), "MMM d, yyyy");
  const lines = [
    r.occupantName,
    r.occupantType === "VESSEL"
      ? `Vessel${r.vesselLengthFt ? ` · ${r.vesselLengthFt} ft` : ""}`
      : "Event",
    start === end ? start : `${start} – ${end}`,
  ];
  if (r.checkInTime || r.checkOutTime) {
    const inLabel = r.checkInTime ? formatTimeLabel(r.checkInTime) : "?";
    const outLabel = r.checkOutTime ? formatTimeLabel(r.checkOutTime) : "?";
    lines.push(`Check-in ${inLabel} · Check-out ${outLabel}`);
  }
  if (r.notes) lines.push(r.notes);
  return lines.join("\n");
}

/**
 * Greedy interval scheduling: assigns each reservation to the first "lane"
 * whose last-placed reservation ends before this one starts. Reservations
 * that overlap in time always land in different lanes, which is what lets
 * a multi-slip berth (capacity > 1) show several boats stacked as separate
 * rows instead of overlapping each other.
 */
export function assignLanes(reservations: Reservation[]): Reservation[][] {
  const sorted = [...reservations].sort((a, b) => a.startDate.localeCompare(b.startDate));
  const lanes: Reservation[][] = [];
  const laneEnds: string[] = [];
  for (const r of sorted) {
    const start = r.startDate.slice(0, 10);
    let placedIn = -1;
    for (let i = 0; i < lanes.length; i++) {
      if (laneEnds[i] < start) {
        placedIn = i;
        break;
      }
    }
    if (placedIn === -1) {
      lanes.push([r]);
      laneEnds.push(r.endDate.slice(0, 10));
    } else {
      lanes[placedIn].push(r);
      laneEnds[placedIn] = r.endDate.slice(0, 10);
    }
  }
  return lanes;
}

export type Segment =
  | { type: "empty"; date: Date }
  | { type: "reservation"; reservation: Reservation; span: number; date: Date };

/** Turns one lane's reservations into a left-to-right list of table cells:
 * either a single empty day, or one reservation collapsed into a single
 * cell spanning every consecutive visible day it covers (a colSpan), so a
 * multi-day booking renders as one connected bar instead of repeating. */
export function buildSegments(lane: Reservation[], days: Date[]): Segment[] {
  const segments: Segment[] = [];
  let i = 0;
  while (i < days.length) {
    const iso = toISODate(days[i]);
    const match = lane.find((r) => r.startDate.slice(0, 10) <= iso && r.endDate.slice(0, 10) >= iso);
    if (!match) {
      segments.push({ type: "empty", date: days[i] });
      i += 1;
      continue;
    }
    let span = 0;
    while (i + span < days.length) {
      const iso2 = toISODate(days[i + span]);
      if (match.startDate.slice(0, 10) <= iso2 && match.endDate.slice(0, 10) >= iso2) span += 1;
      else break;
    }
    segments.push({ type: "reservation", reservation: match, span, date: days[i] });
    i += span;
  }
  return segments;
}
