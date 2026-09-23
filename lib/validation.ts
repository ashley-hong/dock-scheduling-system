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
  newOccupant?: Pick<Reservation, "occupantType" | "vesselLengthFt">
): Promise<OverlapCheckResult> {
  if (berth.capacity === null) {
    return { ok: true, conflicts: [] };
  }

  const candidates = await db.reservation.findMany({
    where: {
      berthId: berth.id,
      id: excludeReservationId ? { not: excludeReservationId } : undefined,
      startDate: { lte: endDate },
      endDate: { gte: startDate },
    },
    orderBy: { startDate: "asc" },
  });

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
 * Either or both may be left out entirely, in which case the reservation
 * behaves exactly as it always has - a whole-day booking with no time
 * component. This only validates the values; it does not (yet) factor
 * into overlap detection, which still operates on whole days.
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
