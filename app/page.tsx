"use client";

import { useEffect, useMemo, useState } from "react";
import { addDays, format } from "date-fns";
import ReservationModal from "@/components/ReservationModal";
import type { Berth, Reservation } from "@/lib/types";

const DAYS_SHOWN = 14;

function toISODate(d: Date) {
  return format(d, "yyyy-MM-dd");
}

function subtext(r: Reservation) {
  const parts: string[] = [];
  if (r.occupantType === "VESSEL" && r.vesselLengthFt) parts.push(`${r.vesselLengthFt} ft`);
  const start = r.startDate.slice(0, 10);
  const end = r.endDate.slice(0, 10);
  if (start !== end) {
    parts.push(`${format(new Date(start), "M/d")}–${format(new Date(end), "M/d")}`);
  }
  return parts.join(" · ");
}

function tooltipText(r: Reservation) {
  const start = format(new Date(r.startDate), "MMM d, yyyy");
  const end = format(new Date(r.endDate), "MMM d, yyyy");
  const lines = [
    r.occupantName,
    r.occupantType === "VESSEL"
      ? `Vessel${r.vesselLengthFt ? ` · ${r.vesselLengthFt} ft` : ""}`
      : "Event",
    start === end ? start : `${start} – ${end}`,
  ];
  if (r.notes) lines.push(r.notes);
  return lines.join("\n");
}

/**
 * Greedy interval scheduling: assigns each reservation to the first "lane"
 * whose last-placed reservation ends before this one starts. Reservations
 * that overlap in time always land in different lanes, which is what lets
 * a multi-slip berth (capacity > 1) show several boats stacked as separate
 * rows instead of overlapping each other.
 */
function assignLanes(reservations: Reservation[]): Reservation[][] {
  const sorted = [...reservations].sort((a, b) => a.startDate.localeCompare(b.startDate));
  const lanes: Reservation[][] = [];
  const laneEnds: string[] = [];
  for (const r of sorted) {
    const start = r.startDate.slice(0, 10);
    let placedIn = -1;
    for (let i = 0; i < lanes.length; i++) {
      if (laneEnds[i] < start) {
        placedIn = i;
        break;
      }
    }
    if (placedIn === -1) {
      lanes.push([r]);
      laneEnds.push(r.endDate.slice(0, 10));
    } else {
      lanes[placedIn].push(r);
      laneEnds[placedIn] = r.endDate.slice(0, 10);
    }
  }
  return lanes;
}

type Segment =
  | { type: "empty"; date: Date }
  | { type: "reservation"; reservation: Reservation; span: number };

/** Turns one lane's reservations into a left-to-right list of table cells:
 * either a single empty day, or one reservation collapsed into a single
 * cell spanning every consecutive visible day it covers (a colSpan), so a
 * multi-day booking renders as one connected bar instead of repeating. */
function buildSegments(lane: Reservation[], days: Date[]): Segment[] {
  const segments: Segment[] = [];
  let i = 0;
  while (i < days.length) {
    const iso = toISODate(days[i]);
    const match = lane.find((r) => r.startDate.slice(0, 10) <= iso && r.endDate.slice(0, 10) >= iso);
    if (!match) {
      segments.push({ type: "empty", date: days[i] });
      i += 1;
      continue;
    }
    let span = 0;
    while (i + span < days.length) {
      const iso2 = toISODate(days[i + span]);
      if (match.startDate.slice(0, 10) <= iso2 && match.endDate.slice(0, 10) >= iso2) span += 1;
      else break;
    }
    segments.push({ type: "reservation", reservation: match, span });
    i += span;
  }
  return segments;
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

  const todayISO = toISODate(new Date());

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
            Hover a booking to see details, or click an empty cell to schedule a boat.
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
          {berths.length > 0 && (
            <button
              className="ml-2 rounded-md bg-slate-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-slate-700"
              onClick={() => setModalState({ berthId: berths[0].id, date: rangeStart })}
            >
              + New Reservation
            </button>
          )}
        </div>
      </div>

      <div className="mb-3 flex gap-4 text-xs text-slate-500">
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-3 w-3 rounded-sm bg-sky-200" /> Vessel
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-3 w-3 rounded-sm bg-amber-200" /> Event
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-3 w-3 rounded-sm bg-blue-100" /> Today
        </span>
        <span className="text-slate-400">
          A berth with room for more than one boat at a time (like North Finger Piers) shows each
          simultaneous booking as its own row.
        </span>
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full table-fixed border-collapse text-sm">
          <colgroup>
            <col className="w-40" />
            {days.map((d) => (
              <col key={d.toISOString()} className="w-[110px]" />
            ))}
          </colgroup>
          <thead>
            <tr>
              <th className="sticky left-0 z-10 border-b border-r border-slate-200 bg-slate-50 px-3 py-2 text-left font-medium">
                Berth
              </th>
              {days.map((d) => {
                const iso = toISODate(d);
                return (
                  <th
                    key={d.toISOString()}
                    className={`border-b border-slate-200 px-2 py-2 text-center font-medium ${
                      iso === todayISO ? "bg-blue-100 text-blue-900" : "bg-slate-50"
                    }`}
                  >
                    {format(d, "EEE M/d")}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {berths.map((berth) => {
              const berthReservations = reservations.filter((r) => r.berthId === berth.id);
              const lanes = assignLanes(berthReservations);
              const rowCount = Math.max(1, lanes.length);

              return Array.from({ length: rowCount }, (_, laneIndex) => {
                const segments = buildSegments(lanes[laneIndex] ?? [], days);
                return (
                  <tr key={`${berth.id}-${laneIndex}`}>
                    {laneIndex === 0 && (
                      <td
                        rowSpan={rowCount}
                        className="sticky left-0 z-10 border-b border-r border-slate-200 bg-white px-3 py-2 align-top font-medium"
                      >
                        {berth.name}
                        <div className="text-xs font-normal text-slate-400">
                          {berth.lengthFt ? `${berth.lengthFt} ft` : "multi-slip"}
                        </div>
                      </td>
                    )}
                    {segments.map((seg) => {
                      if (seg.type === "empty") {
                        const iso = toISODate(seg.date);
                        return (
                          <td
                            key={iso}
                            className={`group cursor-pointer border-b border-slate-100 px-1 py-1 align-top transition-colors hover:bg-slate-50 ${
                              iso === todayISO ? "bg-blue-50/60" : ""
                            }`}
                            onClick={() => setModalState({ berthId: berth.id, date: iso })}
                          >
                            <span className="flex h-8 w-full items-center justify-center text-base text-slate-300 opacity-0 transition-opacity group-hover:opacity-100">
                              +
                            </span>
                          </td>
                        );
                      }
                      const r = seg.reservation;
                      return (
                        <td
                          key={r.id}
                          colSpan={seg.span}
                          className="cursor-pointer border-b border-slate-100 px-1 py-1 align-top"
                          onClick={() => setModalState({ reservation: r })}
                        >
                          <div
                            className={`rounded px-1.5 py-1 text-left text-xs ${
                              r.occupantType === "VESSEL" ? "bg-sky-200" : "bg-amber-200"
                            } transition-opacity hover:opacity-80`}
                            title={tooltipText(r)}
                          >
                            <span className="block truncate font-medium">{r.occupantName}</span>
                            {subtext(r) && (
                              <span className="block truncate text-[10px] font-normal text-slate-600/70">
                                {subtext(r)}
                              </span>
                            )}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                );
              });
            })}
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
