"use client";

import { useEffect, useState } from "react";
import { format } from "date-fns";
import { toISODate } from "@/lib/calendar";
import type { Berth, Reservation } from "@/lib/types";

export default function RosterPage() {
  const [berths, setBerths] = useState<Berth[]>([]);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const today = new Date();
  const todayISO = toISODate(today);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [berthsRes, reservationsRes] = await Promise.all([
        fetch("/api/berths"),
        fetch(`/api/reservations?from=${todayISO}&to=${todayISO}`),
      ]);
      if (!berthsRes.ok || !reservationsRes.ok) throw new Error("Request failed.");
      setBerths(await berthsRes.json());
      setReservations(await reservationsRes.json());
    } catch {
      setError("Couldn't load today's roster. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const occupantsByBerth = new Map<string, Reservation[]>();
  for (const r of reservations) {
    const list = occupantsByBerth.get(r.berthId) ?? [];
    list.push(r);
    occupantsByBerth.set(r.berthId, list);
  }

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3 print:mb-4">
        <div>
          <h1 className="text-[22px] font-bold tracking-tight">Today&apos;s Roster</h1>
          <p className="text-[13px] text-[#6b7280]">{format(today, "EEEE, MMMM d, yyyy")}</p>
        </div>
        <button
          onClick={() => window.print()}
          className="rounded-md border border-[#e5e5e5] px-3 py-1.5 text-[13px] font-medium hover:bg-[#fafafa] print:hidden"
        >
          Print
        </button>
      </div>

      <div className="overflow-hidden rounded-lg border border-[#e5e5e5] bg-white print:border-0">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-[#e5e5e5] bg-[#fafafa] text-left print:bg-white">
              <th className="px-4 py-2 font-medium">Berth</th>
              <th className="px-4 py-2 font-medium">Length</th>
              <th className="px-4 py-2 font-medium">Occupant(s)</th>
            </tr>
          </thead>
          <tbody>
            {berths.map((b) => {
              const occupants = occupantsByBerth.get(b.id) ?? [];
              return (
                <tr key={b.id} className="border-b border-[#f0f0f0] align-top last:border-0">
                  <td className="px-4 py-2 font-medium">{b.name}</td>
                  <td className="px-4 py-2 font-mono text-[#6b7280]">
                    {b.lengthFt ? `${b.lengthFt}ft` : "n/a"}
                  </td>
                  <td className="px-4 py-2">
                    {occupants.length === 0 ? (
                      <span className="text-[#9ca3af]">Available</span>
                    ) : (
                      <ul className="space-y-1">
                        {occupants.map((r) => (
                          <li key={r.id} className="flex items-center gap-1.5">
                            <span
                              className={`inline-block h-2 w-2 rounded-full ${
                                r.occupantType === "VESSEL" ? "bg-[#7c3aed]" : "bg-[#f97316]"
                              }`}
                            />
                            {r.occupantName}
                            {r.vesselLengthFt ? (
                              <span className="font-mono text-[#9ca3af]">
                                ({r.vesselLengthFt}ft)
                              </span>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {loading && <p className="p-4 text-[13px] text-[#9ca3af]">Loading...</p>}
        {!loading && error && (
          <div className="flex items-center gap-3 p-4 text-[13px] text-red-600 print:hidden">
            <span>{error}</span>
            <button
              onClick={load}
              className="rounded-md border border-red-200 px-2 py-1 text-[12px] font-medium hover:bg-red-50"
            >
              Retry
            </button>
          </div>
        )}
        {!loading && !error && berths.length === 0 && (
          <p className="p-4 text-[13px] text-[#9ca3af]">No berths yet.</p>
        )}
      </div>
    </div>
  );
}
