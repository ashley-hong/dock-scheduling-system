import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/** Distinct vessel names already used, for autocomplete - so "R/V Example"
 * gets typed the same way every time instead of drifting into near-duplicates. */
export async function GET() {
  const rows = await prisma.reservation.findMany({
    where: { occupantType: "VESSEL" },
    distinct: ["occupantName"],
    select: { occupantName: true },
    orderBy: { occupantName: "asc" },
  });
  return NextResponse.json(rows.map((r) => r.occupantName));
}
