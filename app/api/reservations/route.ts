import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { checkOverlap, checkLengthFit } from "@/lib/validation";
import { parseDateOnly } from "@/lib/dates";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const berthId = searchParams.get("berthId") ?? undefined;
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const search = searchParams.get("search")?.trim();

  // A search ignores the visible date window on purpose - it's meant to
  // find a booking anywhere across the 23 years of history, not just the
  // two weeks currently on screen.
  const reservations = await prisma.reservation.findMany({
    where: {
      berthId,
      ...(search
        ? { occupantName: { contains: search } }
        : {
            ...(from ? { endDate: { gte: parseDateOnly(from) } } : {}),
            ...(to ? { startDate: { lte: parseDateOnly(to) } } : {}),
          }),
    },
    include: { berth: true },
    orderBy: { startDate: "asc" },
    take: search ? 25 : undefined,
  });

  return NextResponse.json(reservations);
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { berthId, occupantName, occupantType, vesselLengthFt, startDate, endDate, notes } = body;

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

  const lengthCheck = checkLengthFit(occupantType, parsedVesselLength, berth.lengthFt);
  if (!lengthCheck.ok) {
    return NextResponse.json(
      { error: "LENGTH_MISMATCH", reason: lengthCheck.reason },
      { status: 422 }
    );
  }

  const overlapCheck = await checkOverlap(berth, start, end);
  if (!overlapCheck.ok) {
    return NextResponse.json(
      { error: "OVERLAP", conflicts: overlapCheck.conflicts },
      { status: 409 }
    );
  }

  const reservation = await prisma.reservation.create({
    data: {
      berthId,
      occupantName,
      occupantType,
      vesselLengthFt: parsedVesselLength,
      startDate: start,
      endDate: end,
      notes: notes || null,
    },
    include: { berth: true },
  });

  return NextResponse.json(reservation, { status: 201 });
}
