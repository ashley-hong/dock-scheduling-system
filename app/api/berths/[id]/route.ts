import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

type RouteParams = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const body = await request.json();
  const { name, lengthFt, capacity, allowsLengthBasedSharing, notes } = body;

  const berth = await prisma.berth.findUnique({ where: { id } });
  if (!berth) {
    return NextResponse.json({ error: "Berth not found." }, { status: 404 });
  }

  if (name && name !== berth.name) {
    const existing = await prisma.berth.findUnique({ where: { name } });
    if (existing) {
      return NextResponse.json(
        { error: `A berth named "${name}" already exists.` },
        { status: 409 }
      );
    }
  }

  const updated = await prisma.berth.update({
    where: { id },
    data: {
      name: name ?? undefined,
      lengthFt:
        lengthFt === "" || lengthFt === undefined
          ? undefined
          : lengthFt === null
          ? null
          : Number(lengthFt),
      capacity:
        capacity === "" || capacity === undefined
          ? undefined
          : capacity === null
          ? null
          : Number(capacity),
      allowsLengthBasedSharing:
        allowsLengthBasedSharing === undefined ? undefined : Boolean(allowsLengthBasedSharing),
      notes: notes === undefined ? undefined : notes || null,
    },
  });

  return NextResponse.json(updated);
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const berth = await prisma.berth.findUnique({
    where: { id },
    include: { _count: { select: { reservations: true } } },
  });
  if (!berth) {
    return NextResponse.json({ error: "Berth not found." }, { status: 404 });
  }

  await prisma.berth.delete({ where: { id } });
  return NextResponse.json({
    deleted: true,
    reservationsRemoved: berth._count.reservations,
  });
}
