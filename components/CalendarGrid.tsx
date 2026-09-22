"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { format } from "date-fns";
import { assignLanes, buildSegments, subtext, toISODate, tooltipText } from "@/lib/calendar";
import type { Berth, Reservation } from "@/lib/types";

type ResizeState = {
  reservationId: string;
  berthId: string;
  edge: "start" | "end";
  originalStart: string;
  originalEnd: string;
  previewStart: string;
  previewEnd: string;
};

type Props = {
  berths: Berth[];
  reservations: Reservation[];
  days: Date[];
  todayISO: string;
  conflictBerthIds: Set<string>;
  onEmptyClick: (berthId: string, dateISO: string) => void;
  onReservationClick: (reservation: Reservation) => void;
  onMove: (reservationId: string, newStartISO: string, newEndISO: string) => void;
  onResize: (reservationId: string, newStartISO: string, newEndISO: string) => void;
};

/** Reads the day a pointer is currently over, even mid-drag across a
 * colSpan'd multi-day bar: finds the table cell under the cursor via
 * elementFromPoint, then interpolates which day within that cell's span
 * the x-coordinate falls in. */
function dateUnderPointer(clientX: number, clientY: number): { berthId: string; dateISO: string } | null {
  const el = document
    .elementFromPoint(clientX, clientY)
    ?.closest<HTMLElement>("[data-cell]");
  if (!el) return null;
  const berthId = el.dataset.berthId;
  const firstDate = el.dataset.firstDate;
  const span = Number(el.dataset.span ?? "1");
  if (!berthId || !firstDate) return null;
  const rect = el.getBoundingClientRect();
  const dayOffset = Math.min(span - 1, Math.max(0, Math.floor(((clientX - rect.left) / rect.width) * span)));
  const d = new Date(firstDate);
  d.setDate(d.getDate() + dayOffset);
  return { berthId, dateISO: toISODate(d) };
}

export default function CalendarGrid({
  berths,
  reservations,
  days,
  todayISO,
  conflictBerthIds,
  onEmptyClick,
  onReservationClick,
  onMove,
  onResize,
}: Props) {
  const [resizeState, setResizeState] = useState<ResizeState | null>(null);
  const resizeRef = useRef<ResizeState | null>(null);

  useEffect(() => {
    resizeRef.current = resizeState;
  }, [resizeState]);

  useEffect(() => {
    if (!resizeState) return;

    function handlePointerMove(e: PointerEvent) {
      const current = resizeRef.current;
      if (!current) return;
      const hit = dateUnderPointer(e.clientX, e.clientY);
      if (!hit || hit.berthId !== current.berthId) return;
      if (current.edge === "start") {
        if (hit.dateISO <= current.originalEnd) {
          setResizeState({ ...current, previewStart: hit.dateISO });
        }
      } else {
        if (hit.dateISO >= current.originalStart) {
          setResizeState({ ...current, previewEnd: hit.dateISO });
        }
      }
    }

    function handlePointerUp() {
      const current = resizeRef.current;
      if (current && (current.previewStart !== current.originalStart || current.previewEnd !== current.originalEnd)) {
        onResize(current.reservationId, current.previewStart, current.previewEnd);
      }
      setResizeState(null);
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Boolean(resizeState)]);

  function startResize(r: Reservation, edge: "start" | "end", e: React.PointerEvent) {
    e.stopPropagation();
    e.preventDefault();
    setResizeState({
      reservationId: r.id,
      berthId: r.berthId,
      edge,
      originalStart: r.startDate.slice(0, 10),
      originalEnd: r.endDate.slice(0, 10),
      previewStart: r.startDate.slice(0, 10),
      previewEnd: r.endDate.slice(0, 10),
    });
  }

  function displayDates(r: Reservation): { start: string; end: string } {
    if (resizeState?.reservationId === r.id) {
      return { start: resizeState.previewStart, end: resizeState.previewEnd };
    }
    return { start: r.startDate.slice(0, 10), end: r.endDate.slice(0, 10) };
  }

  return (
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
          const berthReservations = reservations
            .filter((r) => r.berthId === berth.id)
            // While actively resizing, feed the *preview* dates into lane
            // assignment/segments so the bar visually grows/shrinks live.
            .map((r) => (resizeState?.reservationId === r.id
              ? { ...r, startDate: resizeState.previewStart, endDate: resizeState.previewEnd }
              : r));
          const lanes = assignLanes(berthReservations);
          const rowCount = Math.max(1, lanes.length);
          const hasConflict = conflictBerthIds.has(berth.id);

          return Array.from({ length: rowCount }, (_, laneIndex) => {
            const segments = buildSegments(lanes[laneIndex] ?? [], days);
            return (
              <tr key={`${berth.id}-${laneIndex}`}>
                {laneIndex === 0 && (
                  <td
                    rowSpan={rowCount}
                    className="sticky left-0 z-10 border-b border-r border-slate-200 bg-white px-3 py-2 align-top font-medium"
                  >
                    <div className="flex items-center gap-1.5">
                      {berth.name}
                      {hasConflict && (
                        <Link
                          href="/data-quality"
                          title="This berth has a scheduling conflict - see Data Quality"
                          className="text-amber-500 hover:text-amber-600"
                        >
                          ⚠
                        </Link>
                      )}
                    </div>
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
                        data-cell
                        data-berth-id={berth.id}
                        data-first-date={iso}
                        data-span={1}
                        className={`group cursor-pointer border-b border-slate-100 px-1 py-1 align-top transition-colors hover:bg-slate-50 ${
                          iso === todayISO ? "bg-blue-50/60" : ""
                        }`}
                        onClick={() => onEmptyClick(berth.id, iso)}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={(e) => {
                          e.preventDefault();
                          const data = e.dataTransfer.getData("text/plain");
                          if (!data) return;
                          const { id, berthId, durationDays } = JSON.parse(data);
                          if (berthId !== berth.id) return;
                          const newStart = new Date(iso);
                          const newEnd = new Date(iso);
                          newEnd.setDate(newEnd.getDate() + durationDays);
                          onMove(id, toISODate(newStart), toISODate(newEnd));
                        }}
                      >
                        <span className="flex h-8 w-full items-center justify-center text-base text-slate-300 opacity-0 transition-opacity group-hover:opacity-100">
                          +
                        </span>
                      </td>
                    );
                  }
                  const r = seg.reservation;
                  const { start, end } = displayDates(r);
                  const durationDays = Math.round(
                    (new Date(end).getTime() - new Date(start).getTime()) / 86_400_000
                  );
                  const isBeingResized = resizeState?.reservationId === r.id;
                  return (
                    <td
                      key={r.id}
                      colSpan={seg.span}
                      data-cell
                      data-berth-id={berth.id}
                      data-first-date={toISODate(seg.date)}
                      data-span={seg.span}
                      className="group relative cursor-pointer border-b border-slate-100 px-1 py-1 align-top"
                    >
                      <div
                        draggable={!resizeState}
                        onDragStart={(e) => {
                          e.dataTransfer.setData(
                            "text/plain",
                            JSON.stringify({ id: r.id, berthId: r.berthId, durationDays })
                          );
                        }}
                        onClick={() => !isBeingResized && onReservationClick(r)}
                        className={`relative select-none rounded px-1.5 py-1 text-left text-xs ${
                          r.occupantType === "VESSEL" ? "bg-sky-200" : "bg-amber-200"
                        } ${isBeingResized ? "ring-2 ring-slate-500" : ""} transition-opacity hover:opacity-90`}
                        title={tooltipText(r)}
                      >
                        <span className="block truncate font-medium">{r.occupantName}</span>
                        {subtext(r) && (
                          <span className="block truncate text-[10px] font-normal text-slate-600/70">
                            {subtext(r)}
                          </span>
                        )}
                      </div>
                      {/* Resize handles are siblings of the draggable bar, not
                          children of it - nesting them inside a draggable
                          element lets the browser's native drag gesture hijack
                          the mousedown before our pointer-based resize logic
                          ever sees it. */}
                      <span
                        data-resize-handle="start"
                        data-reservation-id={r.id}
                        onPointerDown={(e) => startResize(r, "start", e)}
                        onDragStart={(e) => e.preventDefault()}
                        className="absolute left-0 top-0 z-10 h-full w-2 cursor-col-resize select-none opacity-0 hover:bg-slate-900/20 group-hover:opacity-100"
                      />
                      <span
                        data-resize-handle="end"
                        data-reservation-id={r.id}
                        onPointerDown={(e) => startResize(r, "end", e)}
                        onDragStart={(e) => e.preventDefault()}
                        className="absolute right-0 top-0 z-10 h-full w-2 cursor-col-resize select-none opacity-0 hover:bg-slate-900/20 group-hover:opacity-100"
                      />
                    </td>
                  );
                })}
              </tr>
            );
          });
        })}
      </tbody>
    </table>
  );
}
