import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import type { Berth, Reservation } from "@prisma/client";

export type OverlapCheckResult = {
  ok: boolean;
  conflicts: Reservation[];
};

/** Thrown from inside a `$transaction` callback to carry the conflicting
 * reservations back out to the route handler's catch block. */
export class OverlapError extends Error {
  conflicts: Reservation[];
  constructor(conflicts: Reservation[]) {
    super("OVERLAP");
    this.conflicts = conflicts;
  }
}

/** True when a Serializable transaction lost a race to another concurrent
 * write - Postgres's way of refusing to silently allow a double-booking
 * that a check-then-write race would otherwise let through. */
export function isTransactionConflict(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2034";
}

/**
 * Two date ranges [aStart,aEnd] and [bStart,bEnd] (inclusive, whole days)
 * overlap when neither ends before the other starts.
 */
export function rangesOverlap(
  aStart: Date,
  aEnd: Date,
  bStart: Date,
  bEnd: Date
): boolean {
  return aStart <= bEnd && bStart <= aEnd;
}

/** A reservation whose vessel length is known, so it can be counted toward
 * a length-based sharing total. An event, or a vessel with no recorded
 * length, is never measurable - there's no way to know whether it fits
 * alongside others, so it's always treated as taking the whole berth. */
function isMeasurableVessel(
  r: Pick<Reservation, "occupantType" | "vesselLengthFt">
): r is Pick<Reservation, "occupantType" | "vesselLengthFt"> & { vesselLengthFt: number } {
  return r.occupantType === "VESSEL" && r.vesselLengthFt != null;
}

type DateTimeRange = {
  startDate: Date;
  endDate: Date;
  checkInTime?: string | null;
  checkOutTime?: string | null;
};

/** Minimum gap required between one boat's check-out and the next boat's
 * check-in on the same berth, same day - time for the dock to be cleared
 * (cleaning, etc.) before the next arrival. */
export const MIN_TURNAROUND_MINUTES = 60;

function timeToMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

/**
 * True when two bookings only ever *look* like a conflict because they
 * share a calendar day, but couldn't actually have been on the berth at
 * the same time - both are exactly one day, on the same day, with a known
 * check-in and check-out, and whichever one finishes first leaves at least
 * MIN_TURNAROUND_MINUTES before the other one's check-in. Missing time
 * info on either side, a multi-day booking, or a gap shorter than the
 * turnaround minimum can't be proven safe, so it falls back to treating
 * same-day as a real conflict, same as before this existed.
 */
function definitelyDontOverlapByTime(a: DateTimeRange, b: DateTimeRange): boolean {
  if (a.startDate.getTime() !== a.endDate.getTime()) return false;
  if (b.startDate.getTime() !== b.endDate.getTime()) return false;
  if (a.startDate.getTime() !== b.startDate.getTime()) return false;
  if (!a.checkInTime || !a.checkOutTime || !b.checkInTime || !b.checkOutTime) return false;
  const aOut = timeToMinutes(a.checkOutTime);
  const aIn = timeToMinutes(a.checkInTime);
  const bOut = timeToMinutes(b.checkOutTime);
  const bIn = timeToMinutes(b.checkInTime);
  return aOut + MIN_TURNAROUND_MINUTES <= bIn || bOut + MIN_TURNAROUND_MINUTES <= aIn;
}

/**
 * Checks whether assigning [startDate,endDate] to a berth would push the
 * number of simultaneous occupants past that berth's capacity.
 * `capacity: null` means the berth is a multi-slot area (e.g. small-craft
 * finger piers) where overlap is expected, so it's never flagged.
 * `excludeReservationId` lets an edit ignore the reservation being edited.
 *
 * A berth with `allowsLengthBasedSharing` uses a different rule instead of
 * the `capacity` count: any number of vessels may overlap as long as their
 * lengths add up to no more than the berth's length, with no gap/clearance
 * required between them. It only applies when the new occupant and every
 * already-overlapping occupant are vessels with a known length; otherwise
 * it falls back to the ordinary one-at-a-time rule, since fit can't be
 * determined for an event or a vessel of unknown length.
 *
 * Before either rule is applied, same-day bookings whose check-in/check-out
 * times are both known and don't actually overlap are dropped from
 * consideration entirely - e.g. a boat checking out at 9:30 AM doesn't
 * conflict with the next one checking in at 10:30 AM, even though both
 * are dated the same day.
 */
export async function checkOverlap(
  berth: Pick<Berth, "id" | "capacity" | "lengthFt" | "allowsLengthBasedSharing">,
  startDate: Date,
  endDate: Date,
  excludeReservationId?: string,
  // Accepts either the module-level client or a `$transaction` callback's
  // client, so a check-then-write can run inside one transaction instead of
  // as two separate round trips (which left a window for two concurrent
  // bookings to each pass the check before either one committed).
  db: Pick<typeof prisma, "reservation"> = prisma,
  newOccupant?: Pick<Reservation, "occupantType" | "vesselLengthFt" | "checkInTime" | "checkOutTime">
): Promise<OverlapCheckResult> {
  if (berth.capacity === null) {
    return { ok: true, conflicts: [] };
  }

  const dateOverlapping = await db.reservation.findMany({
    where: {
      berthId: berth.id,
      id: excludeReservationId ? { not: excludeReservationId } : undefined,
      startDate: { lte: endDate },
      endDate: { gte: startDate },
    },
    orderBy: { startDate: "asc" },
  });

  const newRange: DateTimeRange = {
    startDate,
    endDate,
    checkInTime: newOccupant?.checkInTime,
    checkOutTime: newOccupant?.checkOutTime,
  };
  const candidates = dateOverlapping.filter((c) => !definitelyDontOverlapByTime(newRange, c));

  if (
    berth.allowsLengthBasedSharing &&
    berth.lengthFt != null &&
    newOccupant &&
    isMeasurableVessel(newOccupant) &&
    candidates.every(isMeasurableVessel)
  ) {
    const usedLength = candidates.reduce((sum, c) => sum + c.vesselLengthFt!, 0);
    const ok = usedLength + newOccupant.vesselLengthFt <= berth.lengthFt;
    return { ok, conflicts: ok ? [] : candidates };
  }

  const capacity = berth.capacity ?? 1;
  // The new reservation counts as one occupant, so it fits only if fewer
  // than `capacity` existing reservations already overlap it.
  const ok = candidates.length < capacity;
  return { ok, conflicts: ok ? [] : candidates };
}

/**
 * True when a rejected booking could plausibly have succeeded if the
 * berth's "sharing by length" option were turned on - i.e. it's currently
 * off, the berth has a fixed length to share, and the occupant is a vessel
 * with a known length. Used to surface a one-line pointer to the Berths
 * page right when someone hits this, rather than leaving it undiscoverable
 * behind a generic "already booked" message.
 */
export function sharingByLengthWouldHaveHelped(
  berth: Pick<Berth, "allowsLengthBasedSharing" | "lengthFt">,
  occupantType: string,
  vesselLengthFt: number | null | undefined
): boolean {
  return (
    !berth.allowsLengthBasedSharing &&
    berth.lengthFt != null &&
    occupantType === "VESSEL" &&
    vesselLengthFt != null
  );
}

export type LengthCheckResult = {
  ok: boolean;
  reason?: string;
};

/**
 * A vessel must fit the berth it's assigned to. Skipped when either length
 * is unknown (historical imports, or berths like the finger piers that
 * don't have a single fixed length) or the occupant isn't a vessel.
 */
export function checkLengthFit(
  occupantType: string,
  vesselLengthFt: number | null | undefined,
  berthLengthFt: number | null | undefined
): LengthCheckResult {
  if (occupantType !== "VESSEL") return { ok: true };
  if (vesselLengthFt == null || berthLengthFt == null) return { ok: true };
  if (vesselLengthFt > berthLengthFt) {
    return {
      ok: false,
      reason: `Vessel is ${vesselLengthFt}ft, which is longer than the ${berthLengthFt}ft berth.`,
    };
  }
  return { ok: true };
}

export const OPERATING_HOURS_START = "08:00";
export const OPERATING_HOURS_END = "17:00";

function isValidTimeSlot(t: string): boolean {
  if (!/^\d{2}:\d{2}$/.test(t)) return false;
  const [h, m] = t.split(":").map(Number);
  const minutes = h * 60 + m;
  return minutes >= 8 * 60 && minutes <= 17 * 60 && minutes % 30 === 0;
}

export type TimeWindowCheckResult = LengthCheckResult;

/**
 * Optional check-in/check-out times must fall within operating hours
 * (8:00-17:00) in 30-minute increments, with check-in before check-out.
 * They must be set as a pair - both present or both left out - since a
 * reservation with only one of the two can't be compared against another
 * booking's times (checkOverlap requires both sides to have both times
 * before treating a same-day pair as sequential rather than whole-day),
 * and would otherwise silently fall back to blocking the whole day with
 * no indication why.
 */
export function checkTimeWindow(
  checkInTime: string | null | undefined,
  checkOutTime: string | null | undefined
): TimeWindowCheckResult {
  for (const t of [checkInTime, checkOutTime]) {
    if (t != null && !isValidTimeSlot(t)) {
      return {
        ok: false,
        reason: `"${t}" isn't a valid time - use 30-minute increments between ${OPERATING_HOURS_START} and ${OPERATING_HOURS_END}.`,
      };
    }
  }
  if ((checkInTime != null) !== (checkOutTime != null)) {
    return {
      ok: false,
      reason: "Set both a check-in and a check-out time, or leave both blank.",
    };
  }
  if (checkInTime != null && checkOutTime != null && checkInTime >= checkOutTime) {
    return { ok: false, reason: "Check-in time must be before check-out time." };
  }
  return { ok: true };
}

export type DataQualityConflict = {
  berthId: string;
  berthName: string;
  type: "OVERLAP" | "LENGTH_MISMATCH";
  reservations: Reservation[];
  detail: string;
};

/**
 * Live audit of everything currently in the database - the automated
 * replacement for manually scanning the grid for double-bookings and
 * eyeballing whether a vessel fits its berth.
 */
export async function findDataQualityConflicts(): Promise<DataQualityConflict[]> {
  const berths = await prisma.berth.findMany({
    include: { reservations: { orderBy: { startDate: "asc" } } },
  });

  const conflicts: DataQualityConflict[] = [];

  for (const berth of berths) {
    if (berth.capacity !== null) {
      const reservations = berth.reservations;
      const sharingByLength = berth.allowsLengthBasedSharing && berth.lengthFt != null;
      for (let i = 0; i < reservations.length; i++) {
        for (let j = i + 1; j < reservations.length; j++) {
          if (
            !rangesOverlap(
              reservations[i].startDate,
              reservations[i].endDate,
              reservations[j].startDate,
              reservations[j].endDate
            )
          ) {
            continue;
          }

          // Same-day bookings with known, non-overlapping check-in/check-out
          // times were never actually simultaneous, whatever the berth's
          // sharing setting.
          if (definitelyDontOverlapByTime(reservations[i], reservations[j])) {
            continue;
          }

          // A length-sharing berth only has a real conflict when the two
          // don't both have a known vessel length, or their lengths don't
          // add up. (Checked pairwise - a rare three-or-more-way overlap
          // whose total exceeds the berth's length even though every pair
          // fits is not caught here; see the README's Future Improvements.)
          if (
            sharingByLength &&
            isMeasurableVessel(reservations[i]) &&
            isMeasurableVessel(reservations[j]) &&
            reservations[i].vesselLengthFt! + reservations[j].vesselLengthFt! <= berth.lengthFt!
          ) {
            continue;
          }

          conflicts.push({
            berthId: berth.id,
            berthName: berth.name,
            type: "OVERLAP",
            reservations: [reservations[i], reservations[j]],
            detail: sharingByLength
              ? `"${reservations[i].occupantName}" and "${reservations[j].occupantName}" overlap on a length-sharing berth but don't both have a known length that fits within ${berth.lengthFt}ft.`
              : `"${reservations[i].occupantName}" and "${reservations[j].occupantName}" are both booked on a single-occupant berth with overlapping dates.`,
          });
        }
      }
    }

    for (const reservation of berth.reservations) {
      const lengthCheck = checkLengthFit(
        reservation.occupantType,
        reservation.vesselLengthFt,
        berth.lengthFt
      );
      if (!lengthCheck.ok) {
        conflicts.push({
          berthId: berth.id,
          berthName: berth.name,
          type: "LENGTH_MISMATCH",
          reservations: [reservation],
          detail: lengthCheck.reason ?? "Vessel does not fit the berth.",
        });
      }
    }
  }

  return conflicts;
}
