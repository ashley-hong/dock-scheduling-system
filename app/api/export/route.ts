import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/** Exports every reservation as CSV - the old system was a spreadsheet, so
 * being able to get a spreadsheet back out (for printing, sharing, or just
 * a comfort blanket during the transition) is a real bridge, not a gimmick. */
export async function GET() {
  const reservations = await prisma.reservation.findMany({
    include: { berth: true },
    orderBy: [{ berth: { name: "asc" } }, { startDate: "asc" }],
  });

  const header = [
    "Berth",
    "Berth Length (ft)",
    "Occupant",
    "Type",
    "Vessel Length (ft)",
    "Start Date",
    "End Date",
    "Notes",
  ];

  const rows = reservations.map((r) =>
    [
      r.berth.name,
      r.berth.lengthFt != null ? String(r.berth.lengthFt) : "",
      r.occupantName,
      r.occupantType,
      r.vesselLengthFt != null ? String(r.vesselLengthFt) : "",
      r.startDate.toISOString().slice(0, 10),
      r.endDate.toISOString().slice(0, 10),
      r.notes ?? "",
    ]
      .map(csvEscape)
      .join(",")
  );

  const csv = [header.join(","), ...rows].join("\n");

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="dock-reservations.csv"`,
    },
  });
}
