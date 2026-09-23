import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  checkOverlap,
  checkLengthFit,
  checkTimeWindow,
  OverlapError,
  isTransactionConflict,
} from "@/lib/validation";
import { parseDateOnly } from "@/lib/dates";
import type { OccupantType } from "@prisma/client";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const berthId = searchParams.get("berthId") ?? undefined;
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const search = searchParams.get("search")?.trim();
  const occupantTypeParam = searchParams.get("occupantType");
  const occupantType =
    occupantTypeParam === "VESSEL" || occupantTypeParam === "EVENT"
      ? (occupantTypeParam as OccupantType)
      : undefined;
  const sort = searchParams.get("sort") === "desc" ? "desc" : "asc";
  const takeParam = searchParams.get("take");

  // A search ignores the visible date window on purpose - it's meant to
  // find a booking anywhere across the 23 years of history, not just the
  // two weeks currently on screen.
  const reservations = await prisma.reservation.findMany({
    where: {
      berthId,
      ...(occupantType ? { occupantType } : {}),
      ...(search
        ? { occupantName: { contains: search } }
        : {
            ...(from ? { endDate: { gte: parseDateOnly(from) } } : {}),
            ...(to ? { startDate: { lte: parseDateOnly(to) } } : {}),
          }),
    },
    include: { berth: true },
    orderBy: { startDate: sort },
    take: search ? 25 : takeParam ? Number(takeParam) : undefined,
  });

  return NextResponse.json(reservations);
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { berthId, occupantName, occupantType, vesselLengthFt, startDate, endDate, notes } = body;
  const checkInTime = body.checkInTime || null;
  const checkOutTime = body.checkOutTime || null;

  if (!berthId || !occupantName || !occupantType || !startDate || !endDate) {
    return NextResponse.json(
      { error: "berthId, occupantName, occupantType, startDate, and endDate are required." },
      { status: 400 }
    );
  }
  if (!["VESSEL", "EVENT"].includes(occupantType)) {
    return NextResponse.json({ error: "occupantType must be VESSEL or EVENT." }, { status: 400 });
  }

  const berth = await prisma.berth.findUnique({ where: { id: berthId } });
  if (!berth) {
    return NextResponse.json({ error: "Berth not found." }, { status: 404 });
  }

  const start = parseDateOnly(startDate);
  const end = parseDateOnly(endDate);
  if (start > end) {
    return NextResponse.json({ error: "Start date must be on or before end date." }, { status: 400 });
  }

  const parsedVesselLength =
    vesselLengthFt === "" || vesselLengthFt == null ? null : Number(vesselLengthFt);
  if (parsedVesselLength !== null && (!Number.isInteger(parsedVesselLength) || parsedVesselLength <= 0)) {
    return NextResponse.json(
      { error: "Vessel length must be a whole number of feet." },
      { status: 400 }
    );
  }

  const lengthCheck = checkLengthFit(occupantType, parsedVesselLength, berth.lengthFt);
  if (!lengthCheck.ok) {
    return NextResponse.json(
      { error: "LENGTH_MISMATCH", reason: lengthCheck.reason },
      { status: 422 }
    );
  }

  const timeCheck = checkTimeWindow(checkInTime, checkOutTime);
  if (!timeCheck.ok) {
    return NextResponse.json({ error: "INVALID_TIME", reason: timeCheck.reason }, { status: 400 });
  }

  try {
    // Serializable so the overlap check and the write are atomic together:
    // without this, two nearly-simultaneous bookings for the same dates
    // could each pass checkOverlap before either one commits, producing a
    // real double-booking despite the check.
    const reservation = await prisma.$transaction(
      async (tx) => {
        const overlapCheck = await checkOverlap(berth, start, end, undefined, tx, {
          occupantType,
          vesselLengthFt: parsedVesselLength,
        });
        if (!overlapCheck.ok) {
          throw new OverlapError(overlapCheck.conflicts);
        }
        return tx.reservation.create({
          data: {
            berthId,
            occupantName,
            occupantType,
            vesselLengthFt: parsedVesselLength,
            startDate: start,
            endDate: end,
            checkInTime,
            checkOutTime,
            notes: notes || null,
          },
          include: { berth: true },
        });
      },
      { isolationLevel: "Serializable" }
    );

    return NextResponse.json(reservation, { status: 201 });
  } catch (err) {
    if (err instanceof OverlapError) {
      return NextResponse.json({ error: "OVERLAP", conflicts: err.conflicts }, { status: 409 });
    }
    if (isTransactionConflict(err)) {
      return NextResponse.json(
        { error: "OVERLAP", conflicts: [], reason: "Someone else just booked this berth - please try again." },
        { status: 409 }
      );
    }
    throw err;
  }
}
