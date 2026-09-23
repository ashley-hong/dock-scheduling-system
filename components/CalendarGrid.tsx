"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { format } from "date-fns";
import {
  assignLanes,
  buildSegments,
  formatTimeLabel,
  nextCheckInAfter,
  subtext,
  toISODate,
  tooltipText,
} from "@/lib/calendar";
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
  onAddFollowUp: (berthId: string, dateISO: string, suggestedCheckInTime: string) => void;
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
  onAddFollowUp,
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
          <th className="sticky left-0 z-10 border-b border-r border-[#e5e5e5] bg-[#fafafa] px-3 py-2 text-left text-[13px] font-medium">
            Berth
          </th>
          {days.map((d) => {
            const iso = toISODate(d);
            return (
              <th
                key={d.toISOString()}
                className={`border-b border-[#e5e5e5] px-2 py-2 text-center font-mono text-[12px] font-medium ${
                  iso === todayISO ? "bg-[#f3ebfe] text-[#7c3aed]" : "bg-[#fafafa] text-[#6b7280]"
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
                    className="sticky left-0 z-10 border-b border-r border-[#e5e5e5] bg-white px-3 py-2 align-top text-[13px] font-medium"
                  >
                    <div className="flex items-center gap-1.5">
                      {berth.name}
                      {hasConflict && (
                        <Link
                          href="/data-quality"
                          title="This berth has a scheduling conflict - see Data Quality"
                          className="text-[#f97316] hover:text-[#ea580c]"
                        >
                          ⚠
                        </Link>
                      )}
                      {berth.allowsLengthBasedSharing && (
                        <span
                          title="Multiple vessels may share this berth if their lengths fit together"
                          className="rounded-full bg-[#f3ebfe] px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-[#7c3aed]"
                        >
                          shared
                        </span>
                      )}
                    </div>
                    <div className="font-mono text-[11px] font-normal text-[#9ca3af]">
                      {berth.lengthFt ? `${berth.lengthFt}ft` : "multi-slip"}
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
                        className={`group cursor-pointer border-b border-[#f0f0f0] px-1 py-1 align-top transition-colors hover:bg-[#fafafa] ${
                          iso === todayISO ? "bg-[#f9f5ff]" : ""
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
                        <span className="flex h-8 w-full items-center justify-center text-base text-[#d4d4d4] opacity-0 transition-opacity group-hover:opacity-100">
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
                      className="group relative cursor-pointer border-b border-[#f0f0f0] px-1 py-1 align-top"
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
                        className={`relative select-none rounded px-1.5 py-1 text-left text-xs text-white ${
                          r.occupantType === "VESSEL" ? "bg-[#7c3aed]" : "bg-[#f97316]"
                        } ${isBeingResized ? "ring-2 ring-[#0a0a0a]" : ""} transition-opacity hover:opacity-90`}
                        title={tooltipText(r)}
                      >
                        <span className="block truncate font-medium">{r.occupantName}</span>
                        {subtext(r) && (
                          <span className="block truncate font-mono text-[10px] font-normal text-white/75">
                            {subtext(r)}
                          </span>
                        )}
                      </div>
                      {r.checkOutTime && nextCheckInAfter(r.checkOutTime) && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onAddFollowUp(
                              r.berthId,
                              r.endDate.slice(0, 10),
                              nextCheckInAfter(r.checkOutTime!)!
                            );
                          }}
                          title={`Book a new reservation on this berth starting ${formatTimeLabel(
                            nextCheckInAfter(r.checkOutTime!)!
                          )}`}
                          className="mt-1 block w-full truncate rounded border border-dashed border-[#d4d4d4] px-1.5 py-0.5 text-left text-[10px] font-medium text-[#9ca3af] hover:border-[#7c3aed] hover:text-[#7c3aed]"
                        >
                          + Book after {formatTimeLabel(nextCheckInAfter(r.checkOutTime!)!)}
                        </button>
                      )}
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
                        className="absolute left-0 top-0 z-10 h-full w-2 cursor-col-resize select-none opacity-0 hover:bg-white/20 group-hover:opacity-100"
                      />
                      <span
                        data-resize-handle="end"
                        data-reservation-id={r.id}
                        onPointerDown={(e) => startResize(r, "end", e)}
                        onDragStart={(e) => e.preventDefault()}
                        className="absolute right-0 top-0 z-10 h-full w-2 cursor-col-resize select-none opacity-0 hover:bg-white/20 group-hover:opacity-100"
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
