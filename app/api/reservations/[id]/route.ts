import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { checkOverlap, checkLengthFit } from "@/lib/validation";
import { parseDateOnly } from "@/lib/dates";

type RouteParams = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const body = await request.json();

  const existing = await prisma.reservation.findUnique({
    where: { id },
    include: { berth: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "Reservation not found." }, { status: 404 });
  }

  const berthId = body.berthId ?? existing.berthId;
  const berth =
    berthId === existing.berthId
      ? existing.berth
      : await prisma.berth.findUnique({ where: { id: berthId } });
  if (!berth) {
    return NextResponse.json({ error: "Berth not found." }, { status: 404 });
  }

  const occupantName = body.occupantName ?? existing.occupantName;
  const occupantType = body.occupantType ?? existing.occupantType;
  const start = body.startDate ? parseDateOnly(body.startDate) : existing.startDate;
  const end = body.endDate ? parseDateOnly(body.endDate) : existing.endDate;
  const vesselLengthFt =
    body.vesselLengthFt === "" || body.vesselLengthFt === undefined
      ? existing.vesselLengthFt
      : body.vesselLengthFt === null
      ? null
      : Number(body.vesselLengthFt);

  if (start > end) {
    return NextResponse.json({ error: "Start date must be on or before end date." }, { status: 400 });
  }

  const lengthCheck = checkLengthFit(occupantType, vesselLengthFt, berth.lengthFt);
  if (!lengthCheck.ok) {
    return NextResponse.json(
      { error: "LENGTH_MISMATCH", reason: lengthCheck.reason },
      { status: 422 }
    );
  }

  const overlapCheck = await checkOverlap(berth, start, end, id);
  if (!overlapCheck.ok) {
    return NextResponse.json(
      { error: "OVERLAP", conflicts: overlapCheck.conflicts },
      { status: 409 }
    );
  }

  const updated = await prisma.reservation.update({
    where: { id },
    data: {
      berthId,
      occupantName,
      occupantType,
      vesselLengthFt,
      startDate: start,
      endDate: end,
      notes: body.notes === undefined ? undefined : body.notes || null,
    },
    include: { berth: true },
  });

  return NextResponse.json(updated);
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const existing = await prisma.reservation.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "Reservation not found." }, { status: 404 });
  }
  await prisma.reservation.delete({ where: { id } });
  return NextResponse.json({ deleted: true });
}
