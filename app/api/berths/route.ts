import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const berths = await prisma.berth.findMany({ orderBy: { name: "asc" } });
  return NextResponse.json(berths);
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { name, lengthFt, capacity, allowsLengthBasedSharing, notes } = body;

  if (!name || typeof name !== "string") {
    return NextResponse.json({ error: "Name is required." }, { status: 400 });
  }

  const existing = await prisma.berth.findUnique({ where: { name } });
  if (existing) {
    return NextResponse.json(
      { error: `A berth named "${name}" already exists.` },
      { status: 409 }
    );
  }

  const berth = await prisma.berth.create({
    data: {
      name,
      lengthFt: lengthFt === "" || lengthFt == null ? null : Number(lengthFt),
      capacity: capacity === "" || capacity == null ? 1 : Number(capacity),
      allowsLengthBasedSharing: Boolean(allowsLengthBasedSharing),
      notes: notes || null,
    },
  });

  return NextResponse.json(berth, { status: 201 });
}
