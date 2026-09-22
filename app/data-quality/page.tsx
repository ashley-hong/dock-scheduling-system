"use client";

import { useEffect, useState } from "react";
import type { DataQualityConflict } from "@/lib/types";

export default function DataQualityPage() {
  const [conflicts, setConflicts] = useState<DataQualityConflict[] | null>(null);

  useEffect(() => {
    fetch("/api/data-quality")
      .then((r) => r.json())
      .then(setConflicts);
  }, []);

  return (
    <div className="max-w-3xl">
      <h1 className="mb-1 text-[22px] font-bold tracking-tight">Data Quality</h1>
      <p className="mb-6 text-[13px] text-[#6b7280]">
        This is the automated replacement for manually scanning the schedule grid: it
        checks every reservation currently in the system for double-bookings (more
        occupants than a berth&apos;s capacity allows) and vessels assigned to a berth
        they don&apos;t fit.
      </p>

      {conflicts === null && <p className="text-[13px] text-[#9ca3af]">Checking...</p>}

      {conflicts && conflicts.length === 0 && (
        <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-[14px] text-emerald-800">
          No conflicts found. Every berth is within capacity and every vessel fits its
          assigned berth.
        </p>
      )}

      {conflicts && conflicts.length > 0 && (
        <ul className="space-y-3">
          {conflicts.map((c, i) => (
            <li
              key={i}
              className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-[14px] text-red-800"
            >
              <div className="mb-1 flex items-center gap-2 font-medium">
                <span className="rounded bg-red-200 px-1.5 py-0.5 font-mono text-[11px] uppercase tracking-wide">
                  {c.type === "OVERLAP" ? "Double booking" : "Length mismatch"}
                </span>
                {c.berthName}
              </div>
              <p>{c.detail}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
