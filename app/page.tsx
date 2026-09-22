"use client";

import { useEffect, useMemo, useState } from "react";
import { addDays } from "date-fns";
import CalendarGrid from "@/components/CalendarGrid";
import ReservationModal from "@/components/ReservationModal";
import { parseLocalDate, toISODate } from "@/lib/calendar";
import type { Berth, DataQualityConflict, Reservation } from "@/lib/types";

const DAYS_SHOWN = 14;

export default function CalendarPage() {
  const [berths, setBerths] = useState<Berth[]>([]);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [conflicts, setConflicts] = useState<DataQualityConflict[]>([]);
  const [rangeStart, setRangeStart] = useState(() => toISODate(new Date()));
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [searchError, setSearchError] = useState<string | null>(null);
  const [exportRange, setExportRange] = useState("current");
  const [modalState, setModalState] = useState<null | {
    reservation?: Reservation;
    berthId?: string;
    date?: string;
  }>(null);

  const todayISO = toISODate(new Date());

  const days = useMemo(() => {
    const start = parseLocalDate(rangeStart);
    return Array.from({ length: DAYS_SHOWN }, (_, i) => addDays(start, i));
  }, [rangeStart]);

  const rangeEnd = toISODate(days[days.length - 1]);

  const conflictBerthIds = useMemo(() => new Set(conflicts.map((c) => c.berthId)), [conflicts]);

  async function loadData() {
    setLoading(true);
    const [berthsRes, reservationsRes, conflictsRes] = await Promise.all([
      fetch("/api/berths"),
      fetch(`/api/reservations?from=${rangeStart}&to=${rangeEnd}`),
      fetch("/api/data-quality"),
    ]);
    setBerths(await berthsRes.json());
    setReservations(await reservationsRes.json());
    setConflicts(await conflictsRes.json());
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

  // Optimistic: the modal already has the server's confirmed record by the
  // time this fires (it only calls onSaved after a successful response), so
  // we just merge it into local state instead of refetching everything.
  function handleSaved(saved: Reservation) {
    setReservations((prev) => {
      const exists = prev.some((r) => r.id === saved.id);
      return exists ? prev.map((r) => (r.id === saved.id ? saved : r)) : [...prev, saved];
    });
    closeModal();
    fetch("/api/data-quality")
      .then((r) => r.json())
      .then(setConflicts);
  }

  function handleDeleted(id: string) {
    setReservations((prev) => prev.filter((r) => r.id !== id));
    closeModal();
    fetch("/api/data-quality")
      .then((r) => r.json())
      .then(setConflicts);
  }

  // Drag-to-move and edge-resize both go through here: update the grid
  // immediately (optimistic), then confirm with the server. If the server
  // rejects it (a real overlap, since dragging can't check length/overlap
  // ahead of time the way the form does), roll the visible state back and
  // say why - rather than silently snapping back with no explanation.
  async function handleReschedule(reservationId: string, newStartISO: string, newEndISO: string) {
    const previous = reservations;
    const target = previous.find((r) => r.id === reservationId);
    if (!target) return;

    setReservations((prev) =>
      prev.map((r) => (r.id === reservationId ? { ...r, startDate: newStartISO, endDate: newEndISO } : r))
    );

    const res = await fetch(`/api/reservations/${reservationId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ startDate: newStartISO, endDate: newEndISO }),
    });

    if (!res.ok) {
      const data = await res.json();
      setReservations(previous);
      const message =
        data.error === "OVERLAP"
          ? "Can't move there - that berth is already booked during those dates."
          : data.error === "LENGTH_MISMATCH"
          ? data.reason
          : "Couldn't reschedule that booking.";
      window.alert(message);
      return;
    }

    const updated: Reservation = await res.json();
    setReservations((prev) => prev.map((r) => (r.id === reservationId ? updated : r)));
    fetch("/api/data-quality")
      .then((r) => r.json())
      .then(setConflicts);
  }

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    setSearchError(null);
    if (!searchTerm.trim()) return;
    const res = await fetch(`/api/reservations?search=${encodeURIComponent(searchTerm.trim())}`);
    const matches: Reservation[] = await res.json();
    if (matches.length === 0) {
      setSearchError(`No bookings found for "${searchTerm.trim()}".`);
      return;
    }
    setRangeStart(matches[0].startDate.slice(0, 10));
  }

  function handleExport() {
    let url: string;
    if (exportRange === "all") {
      url = "/api/export";
    } else if (exportRange === "current") {
      url = `/api/export?from=${rangeStart}&to=${rangeEnd}`;
    } else {
      const weeks = Number(exportRange);
      const from = toISODate(new Date());
      const to = toISODate(addDays(new Date(), weeks * 7 - 1));
      url = `/api/export?from=${from}&to=${to}`;
    }
    // A plain <a> click (rather than window.location) triggers the file
    // download without Next.js treating it as a client-side navigation.
    const link = document.createElement("a");
    link.href = url;
    link.click();
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-bold tracking-tight">Berth Calendar</h1>
          <p className="text-[13px] text-[#6b7280]">
            Hover a booking to see details, drag it to reschedule, or click an empty cell to
            schedule a boat.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={exportRange}
            onChange={(e) => setExportRange(e.target.value)}
            className="rounded-md border border-[#e5e5e5] px-2 py-1.5 text-[13px]"
            aria-label="Export range"
          >
            <option value="current">Currently displayed ({DAYS_SHOWN} days)</option>
            <option value="4">Next 4 weeks</option>
            <option value="12">Next 12 weeks</option>
            <option value="all">All time (23 years)</option>
          </select>
          <button
            onClick={handleExport}
            className="rounded-md border border-[#e5e5e5] px-3 py-1.5 text-[13px] font-medium hover:bg-[#fafafa]"
          >
            Export CSV
          </button>
          {berths.length > 0 && (
            <button
              className="rounded-md bg-[#0a0a0a] px-4 py-1.5 text-[13px] font-medium text-white hover:bg-[#2a2a2a]"
              onClick={() => setModalState({ berthId: berths[0].id, date: rangeStart })}
            >
              + New Reservation
            </button>
          )}
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <form onSubmit={handleSearch} className="flex items-center gap-2">
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Find a boat by name (searches all 23 years)"
            className="w-72 rounded-md border border-[#e5e5e5] px-3 py-1.5 text-[13px]"
          />
          <button
            type="submit"
            className="rounded-md border border-[#e5e5e5] px-3 py-1.5 text-[13px] font-medium hover:bg-[#fafafa]"
          >
            Search
          </button>
          {searchError && <span className="text-[13px] text-red-600">{searchError}</span>}
        </form>

        <div className="flex items-center gap-2">
          <button
            className="rounded-md border border-[#e5e5e5] px-3 py-1.5 text-[13px] font-medium hover:bg-[#fafafa]"
            onClick={() => setRangeStart(toISODate(addDays(parseLocalDate(rangeStart), -DAYS_SHOWN)))}
          >
            ← Prev {DAYS_SHOWN}
          </button>
          <button
            className="rounded-md border border-[#e5e5e5] px-3 py-1.5 text-[13px] font-medium hover:bg-[#fafafa]"
            onClick={() => setRangeStart(toISODate(new Date()))}
          >
            Today
          </button>
          <input
            type="date"
            value={rangeStart}
            onChange={(e) => setRangeStart(e.target.value)}
            className="rounded-md border border-[#e5e5e5] px-2 py-1.5 text-[13px] font-mono"
          />
          <button
            className="rounded-md border border-[#e5e5e5] px-3 py-1.5 text-[13px] font-medium hover:bg-[#fafafa]"
            onClick={() => setRangeStart(toISODate(addDays(parseLocalDate(rangeStart), DAYS_SHOWN)))}
          >
            Next {DAYS_SHOWN} →
          </button>
        </div>
      </div>

      <div className="mb-3 flex gap-4 text-[12px] font-mono uppercase tracking-wide text-[#6b7280]">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-full bg-[#7c3aed]" /> Vessel
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-full bg-[#f97316]" /> Event
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-full bg-[#e5e5e5] ring-1 ring-[#0a0a0a]" /> Today
        </span>
        <span className="normal-case tracking-normal text-[#9ca3af]">
          Drag a booking to move it, or drag its edges to resize. A berth with room for more than
          one boat at a time shows each simultaneous booking as its own row.
        </span>
      </div>

      <div className="overflow-x-auto rounded-lg border border-[#e5e5e5] bg-white">
        <CalendarGrid
          berths={berths}
          reservations={reservations}
          days={days}
          todayISO={todayISO}
          conflictBerthIds={conflictBerthIds}
          onEmptyClick={(berthId, date) => setModalState({ berthId, date })}
          onReservationClick={(reservation) => setModalState({ reservation })}
          onMove={handleReschedule}
          onResize={handleReschedule}
        />
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
          onDeleted={handleDeleted}
        />
      )}
    </div>
  );
}
