"use client";

import { useEffect, useMemo, useState } from "react";
import ReservationModal from "@/components/ReservationModal";
import type { Berth, OccupantType, Reservation } from "@/lib/types";

const EARLIEST_YEAR = 1990;

export default function HistoryPage() {
  const [berths, setBerths] = useState<Berth[]>([]);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [year, setYear] = useState("");
  const [berthId, setBerthId] = useState("");
  const [occupantType, setOccupantType] = useState<"" | OccupantType>("");
  const [sort, setSort] = useState<"desc" | "asc">("desc");
  const [selected, setSelected] = useState<Reservation | null>(null);

  const RESULT_CAP = 300;

  const years = useMemo(() => {
    const currentYear = new Date().getFullYear();
    const list: number[] = [];
    for (let y = currentYear; y >= EARLIEST_YEAR; y--) list.push(y);
    return list;
  }, []);

  useEffect(() => {
    fetch("/api/berths")
      .then((r) => r.json())
      .then(setBerths);
  }, []);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (year) {
        params.set("from", `${year}-01-01`);
        params.set("to", `${year}-12-31`);
      }
      if (berthId) params.set("berthId", berthId);
      if (occupantType) params.set("occupantType", occupantType);
      params.set("sort", sort);
      params.set("take", String(RESULT_CAP));

      const res = await fetch(`/api/reservations?${params.toString()}`);
      if (!res.ok) throw new Error("Request failed.");
      setReservations(await res.json());
    } catch {
      setError("Couldn't load reservation history. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, berthId, occupantType, sort]);

  function handleSaved(saved: Reservation) {
    setReservations((prev) => prev.map((r) => (r.id === saved.id ? saved : r)));
    setSelected(null);
  }

  function handleDeleted(id: string) {
    setReservations((prev) => prev.filter((r) => r.id !== id));
    setSelected(null);
  }

  return (
    <div>
      <h1 className="mb-1 text-[22px] font-bold tracking-tight">Reservation History</h1>
      <p className="mb-6 text-[13px] text-[#6b7280]">
        Browse past bookings by year, berth, or type instead of stepping through the
        calendar two weeks at a time. Click a row to view, correct, or delete it.
      </p>

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div>
          <label className="mb-1 block text-[11px] font-medium text-[#6b7280]">Year</label>
          <select
            value={year}
            onChange={(e) => setYear(e.target.value)}
            className="rounded-md border border-[#e5e5e5] px-2 py-1.5 text-[13px] font-mono"
          >
            <option value="">All years</option>
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-[11px] font-medium text-[#6b7280]">Berth</label>
          <select
            value={berthId}
            onChange={(e) => setBerthId(e.target.value)}
            className="rounded-md border border-[#e5e5e5] px-2 py-1.5 text-[13px]"
          >
            <option value="">All berths</option>
            {berths.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-[11px] font-medium text-[#6b7280]">Type</label>
          <select
            value={occupantType}
            onChange={(e) => setOccupantType(e.target.value as "" | OccupantType)}
            className="rounded-md border border-[#e5e5e5] px-2 py-1.5 text-[13px]"
          >
            <option value="">Vessels & events</option>
            <option value="VESSEL">Vessels only</option>
            <option value="EVENT">Events only</option>
          </select>
        </div>
        <button
          onClick={() => setSort((s) => (s === "desc" ? "asc" : "desc"))}
          className="rounded-md border border-[#e5e5e5] px-3 py-1.5 text-[13px] font-medium hover:bg-[#fafafa]"
        >
          {sort === "desc" ? "Newest first" : "Oldest first"}
        </button>
      </div>

      <div className="overflow-hidden rounded-lg border border-[#e5e5e5] bg-white">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-[#e5e5e5] bg-[#fafafa] text-left">
              <th className="px-4 py-2 font-medium">Occupant</th>
              <th className="px-4 py-2 font-medium">Berth</th>
              <th className="px-4 py-2 font-medium">Length</th>
              <th className="px-4 py-2 font-medium">Start</th>
              <th className="px-4 py-2 font-medium">End</th>
            </tr>
          </thead>
          <tbody>
            {reservations.map((r) => (
              <tr
                key={r.id}
                onClick={() => setSelected(r)}
                className="cursor-pointer border-b border-[#f0f0f0] last:border-0 hover:bg-[#fafafa]"
              >
                <td className="px-4 py-2 font-medium">
                  <span className="inline-flex items-center gap-1.5">
                    <span
                      className={`inline-block h-2 w-2 rounded-full ${
                        r.occupantType === "VESSEL" ? "bg-[#7c3aed]" : "bg-[#f97316]"
                      }`}
                    />
                    {r.occupantName}
                  </span>
                </td>
                <td className="px-4 py-2 text-[#6b7280]">{r.berth?.name ?? "-"}</td>
                <td className="px-4 py-2 font-mono text-[#6b7280]">
                  {r.vesselLengthFt ? `${r.vesselLengthFt}ft` : "-"}
                </td>
                <td className="px-4 py-2 font-mono text-[#6b7280]">{r.startDate.slice(0, 10)}</td>
                <td className="px-4 py-2 font-mono text-[#6b7280]">{r.endDate.slice(0, 10)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {loading && <p className="p-4 text-[13px] text-[#9ca3af]">Loading...</p>}
        {!loading && error && (
          <div className="flex items-center gap-3 p-4 text-[13px] text-red-600">
            <span>{error}</span>
            <button
              onClick={load}
              className="rounded-md border border-red-200 px-2 py-1 text-[12px] font-medium hover:bg-red-50"
            >
              Retry
            </button>
          </div>
        )}
        {!loading && !error && reservations.length === 0 && (
          <p className="p-4 text-[13px] text-[#9ca3af]">No reservations match these filters.</p>
        )}
        {!loading && !error && reservations.length === RESULT_CAP && (
          <p className="border-t border-[#f0f0f0] p-3 text-[12px] text-[#9ca3af]">
            Showing the {sort === "desc" ? "most recent" : "earliest"} {RESULT_CAP} matches -
            narrow by year, berth, or type to see the rest.
          </p>
        )}
      </div>

      {selected && (
        <ReservationModal
          berths={berths}
          initial={{
            id: selected.id,
            berthId: selected.berthId,
            occupantName: selected.occupantName,
            occupantType: selected.occupantType,
            vesselLengthFt: selected.vesselLengthFt,
            startDate: selected.startDate.slice(0, 10),
            endDate: selected.endDate.slice(0, 10),
            notes: selected.notes,
          }}
          onClose={() => setSelected(null)}
          onSaved={handleSaved}
          onDeleted={handleDeleted}
        />
      )}
    </div>
  );
}
