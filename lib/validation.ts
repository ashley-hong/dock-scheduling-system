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

/**
 * Checks whether assigning [startDate,endDate] to a berth would push the
 * number of simultaneous occupants past that berth's capacity.
 * `capacity: null` means the berth is a multi-slot area (e.g. small-craft
 * finger piers) where overlap is expected, so it's never flagged.
 * `excludeReservationId` lets an edit ignore the reservation being edited.
 */
export async function checkOverlap(
  berth: Pick<Berth, "id" | "capacity">,
  startDate: Date,
  endDate: Date,
  excludeReservationId?: string,
  // Accepts either the module-level client or a `$transaction` callback's
  // client, so a check-then-write can run inside one transaction instead of
  // as two separate round trips (which left a window for two concurrent
  // bookings to each pass the check before either one committed).
  db: Pick<typeof prisma, "reservation"> = prisma
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
      // capacity is always 1 in this model (the only other option is
      // "unlimited"/null), so any overlapping pair is a genuine conflict.
      const reservations = berth.reservations;
      for (let i = 0; i < reservations.length; i++) {
        for (let j = i + 1; j < reservations.length; j++) {
          if (
            rangesOverlap(
              reservations[i].startDate,
              reservations[i].endDate,
              reservations[j].startDate,
              reservations[j].endDate
            )
          ) {
            conflicts.push({
              berthId: berth.id,
              berthName: berth.name,
              type: "OVERLAP",
              reservations: [reservations[i], reservations[j]],
              detail: `"${reservations[i].occupantName}" and "${reservations[j].occupantName}" are both booked on a single-occupant berth with overlapping dates.`,
            });
          }
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
