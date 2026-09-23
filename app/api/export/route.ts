import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { parseDateOnly } from "@/lib/dates";

function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/** Exports reservations as CSV - the old system was a spreadsheet, so being
 * able to get a spreadsheet back out (for printing, sharing, or just a
 * comfort blanket during the transition) is a real bridge, not a gimmick.
 * Optional `from`/`to` (YYYY-MM-DD) limit it to a date range - a full,
 * unfiltered 23-year export is rarely what someone actually wants to open. */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const from = searchParams.get("from");
  const to = searchParams.get("to");

  const reservations = await prisma.reservation.findMany({
    where: {
      ...(from ? { endDate: { gte: parseDateOnly(from) } } : {}),
      ...(to ? { startDate: { lte: parseDateOnly(to) } } : {}),
    },
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
    "Check-In Time",
    "Check-Out Time",
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
      r.checkInTime ?? "",
      r.checkOutTime ?? "",
      r.notes ?? "",
    ]
      .map(csvEscape)
      .join(",")
  );

  const csv = [header.join(","), ...rows].join("\n");
  const filename =
    from && to
      ? `dock-reservations_${from}_to_${to}.csv`
      : "dock-reservations_all-time.csv";

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
