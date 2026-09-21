"use client";

import { useEffect, useMemo, useState } from "react";
import { addDays, format } from "date-fns";
import ReservationModal from "@/components/ReservationModal";
import type { Berth, Reservation } from "@/lib/types";

const DAYS_SHOWN = 14;

function toISODate(d: Date) {
  return format(d, "yyyy-MM-dd");
}

export default function CalendarPage() {
  const [berths, setBerths] = useState<Berth[]>([]);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [rangeStart, setRangeStart] = useState(() => toISODate(new Date()));
  const [loading, setLoading] = useState(true);
  const [modalState, setModalState] = useState<null | {
    reservation?: Reservation;
    berthId?: string;
    date?: string;
  }>(null);

  const days = useMemo(() => {
    const start = new Date(rangeStart);
    return Array.from({ length: DAYS_SHOWN }, (_, i) => addDays(start, i));
  }, [rangeStart]);

  const rangeEnd = toISODate(days[days.length - 1]);

  async function loadData() {
    setLoading(true);
    const [berthsRes, reservationsRes] = await Promise.all([
      fetch("/api/berths"),
      fetch(`/api/reservations?from=${rangeStart}&to=${rangeEnd}`),
    ]);
    setBerths(await berthsRes.json());
    setReservations(await reservationsRes.json());
    setLoading(false);
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rangeStart]);

  function reservationsFor(berthId: string, date: Date) {
    const iso = toISODate(date);
    return reservations.filter(
      (r) => r.berthId === berthId && r.startDate.slice(0, 10) <= iso && r.endDate.slice(0, 10) >= iso
    );
  }

  function closeModal() {
    setModalState(null);
  }

  function handleSaved() {
    closeModal();
    loadData();
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Berth Calendar</h1>
          <p className="text-sm text-slate-500">
            Click any cell to book a berth, or an existing reservation to edit it.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100"
            onClick={() => setRangeStart(toISODate(addDays(new Date(rangeStart), -DAYS_SHOWN)))}
          >
            ← Prev {DAYS_SHOWN}
          </button>
          <button
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100"
            onClick={() => setRangeStart(toISODate(new Date()))}
          >
            Today
          </button>
          <input
            type="date"
            value={rangeStart}
            onChange={(e) => setRangeStart(e.target.value)}
            className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          />
          <button
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100"
            onClick={() => setRangeStart(toISODate(addDays(new Date(rangeStart), DAYS_SHOWN)))}
          >
            Next {DAYS_SHOWN} →
          </button>
        </div>
      </div>

      <div className="mb-3 flex gap-4 text-xs text-slate-500">
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-3 w-3 rounded-sm bg-sky-200" /> Vessel
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-3 w-3 rounded-sm bg-amber-200" /> Event
        </span>
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 min-w-[160px] border-b border-r border-slate-200 bg-slate-50 px-3 py-2 text-left font-medium">
                Berth
              </th>
              {days.map((d) => (
                <th
                  key={d.toISOString()}
                  className="min-w-[110px] border-b border-slate-200 bg-slate-50 px-2 py-2 text-center font-medium"
                >
                  {format(d, "EEE M/d")}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {berths.map((berth) => (
              <tr key={berth.id}>
                <td className="sticky left-0 z-10 border-b border-r border-slate-200 bg-white px-3 py-2 font-medium">
                  {berth.name}
                  <div className="text-xs font-normal text-slate-400">
                    {berth.lengthFt ? `${berth.lengthFt} ft` : "multi-slip"}
                  </div>
                </td>
                {days.map((d) => {
                  const cellReservations = reservationsFor(berth.id, d);
                  return (
                    <td
                      key={d.toISOString()}
                      className="cursor-pointer border-b border-slate-100 px-1 py-1 align-top hover:bg-slate-50"
                      onClick={() => {
                        if (cellReservations.length === 0) {
                          setModalState({ berthId: berth.id, date: toISODate(d) });
                        }
                      }}
                    >
                      {cellReservations.map((r) => (
                        <button
                          key={r.id}
                          onClick={(e) => {
                            e.stopPropagation();
                            setModalState({ reservation: r });
                          }}
                          className={`mb-0.5 block w-full truncate rounded px-1.5 py-1 text-left text-xs ${
                            r.occupantType === "VESSEL" ? "bg-sky-200" : "bg-amber-200"
                          } hover:opacity-80`}
                          title={r.occupantName}
                        >
                          {r.occupantName}
                        </button>
                      ))}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        {loading && <p className="p-4 text-sm text-slate-400">Loading...</p>}
        {!loading && berths.length === 0 && (
          <p className="p-4 text-sm text-slate-400">
            No berths yet. Add one on the Berths page.
          </p>
        )}
      </div>

      {modalState && berths.length > 0 && (
        <ReservationModal
          berths={berths}
          initial={
            modalState.reservation
              ? {
                  id: modalState.reservation.id,
                  berthId: modalState.reservation.berthId,
                  occupantName: modalState.reservation.occupantName,
                  occupantType: modalState.reservation.occupantType,
                  vesselLengthFt: modalState.reservation.vesselLengthFt,
                  startDate: modalState.reservation.startDate.slice(0, 10),
                  endDate: modalState.reservation.endDate.slice(0, 10),
                  notes: modalState.reservation.notes,
                }
              : {
                  berthId: modalState.berthId ?? berths[0].id,
                  startDate: modalState.date ?? toISODate(new Date()),
                  endDate: modalState.date ?? toISODate(new Date()),
                }
          }
          onClose={closeModal}
          onSaved={handleSaved}
        />
      )}
    </div>
  );
}
