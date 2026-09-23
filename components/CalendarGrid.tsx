"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { format } from "date-fns";
import {
  addDaysToIso,
  assignLanes,
  buildSegments,
  daysBetween,
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

type MoveState = {
  reservation: Reservation;
  originalStart: string;
  originalEnd: string;
  durationDays: number;
  // Which day within the reservation's span was grabbed (0 = the start
  // date), so the drag keeps that same day under the pointer instead of
  // always snapping the bar's start date to wherever the pointer lands.
  grabOffsetDays: number;
  previewStart: string;
  previewEnd: string;
  // The berth currently under the pointer - a move can land on a different
  // berth than the one the reservation started on.
  previewBerthId: string;
  pointerDownX: number;
  pointerDownY: number;
  // False until the pointer has moved past a small threshold - lets a
  // plain click (no movement) still open the edit modal instead of always
  // being treated as a (zero-distance) move.
  hasMoved: boolean;
};

const DRAG_THRESHOLD_PX = 4;

type Props = {
  berths: Berth[];
  reservations: Reservation[];
  days: Date[];
  todayISO: string;
  conflictBerthIds: Set<string>;
  onEmptyClick: (berthId: string, dateISO: string) => void;
  onReservationClick: (reservation: Reservation) => void;
  onMove: (reservationId: string, newStartISO: string, newEndISO: string, newBerthId?: string) => void;
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
  const [moveState, setMoveState] = useState<MoveState | null>(null);
  const moveRef = useRef<MoveState | null>(null);

  useEffect(() => {
    resizeRef.current = resizeState;
  }, [resizeState]);

  useEffect(() => {
    moveRef.current = moveState;
  }, [moveState]);

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

  // Moving a reservation went through native HTML5 drag-and-drop originally,
  // but that gave no reliable visual feedback (dragenter/dragleave fire
  // erratically around child elements like the "+" icon, causing flicker)
  // and no control over how the bar tracked the pointer - the same class of
  // problem resize hit and fixed by switching to pointer events instead.
  // This mirrors that: track the pointer directly, and feed the live
  // preview position into the same rendering path as resize already uses,
  // so the bar itself visually slides along the row instead of a separate
  // cell lighting up.
  useEffect(() => {
    if (!moveState) return;
    document.body.style.cursor = "grabbing";

    function handlePointerMove(e: PointerEvent) {
      const current = moveRef.current;
      if (!current) return;
      if (
        !current.hasMoved &&
        Math.abs(e.clientX - current.pointerDownX) < DRAG_THRESHOLD_PX &&
        Math.abs(e.clientY - current.pointerDownY) < DRAG_THRESHOLD_PX
      ) {
        return;
      }

      const hit = dateUnderPointer(e.clientX, e.clientY);
      // Off the grid entirely (above the header, below the table) - stop
      // tracking rather than jumping somewhere meaningless.
      if (!hit) {
        if (!current.hasMoved) setMoveState({ ...current, hasMoved: true });
        return;
      }
      const newStart = addDaysToIso(hit.dateISO, -current.grabOffsetDays);
      const newEnd = addDaysToIso(newStart, current.durationDays);
      setMoveState({
        ...current,
        hasMoved: true,
        previewStart: newStart,
        previewEnd: newEnd,
        previewBerthId: hit.berthId,
      });
    }

    function handlePointerUp() {
      const current = moveRef.current;
      if (current) {
        if (current.hasMoved) {
          if (
            current.previewStart !== current.originalStart ||
            current.previewEnd !== current.originalEnd ||
            current.previewBerthId !== current.reservation.berthId
          ) {
            onMove(
              current.reservation.id,
              current.previewStart,
              current.previewEnd,
              current.previewBerthId !== current.reservation.berthId
                ? current.previewBerthId
                : undefined
            );
          }
        } else {
          // No real movement happened - treat it as a click.
          onReservationClick(current.reservation);
        }
      }
      setMoveState(null);
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      document.body.style.cursor = "";
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Boolean(moveState)]);

  function startMove(r: Reservation, e: React.PointerEvent) {
    if (resizeState) return;
    e.preventDefault();
    const startISO = r.startDate.slice(0, 10);
    const endISO = r.endDate.slice(0, 10);
    const durationDays = daysBetween(startISO, endISO);
    const hit = dateUnderPointer(e.clientX, e.clientY);
    const grabOffsetDays = hit
      ? Math.max(0, Math.min(durationDays, daysBetween(startISO, hit.dateISO)))
      : 0;
    setMoveState({
      reservation: r,
      originalStart: startISO,
      originalEnd: endISO,
      durationDays,
      grabOffsetDays,
      previewStart: startISO,
      previewEnd: endISO,
      previewBerthId: r.berthId,
      pointerDownX: e.clientX,
      pointerDownY: e.clientY,
      hasMoved: false,
    });
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
            .filter((r) => {
              // A reservation being dragged shows up only under whichever
              // berth is currently under the pointer, not its original one -
              // it visually "picks up" from its own row and "lands" in the
              // target row as the drag crosses between berths.
              if (moveState?.reservation.id === r.id) return moveState.previewBerthId === berth.id;
              return r.berthId === berth.id;
            })
            // While actively resizing or moving, feed the *preview* dates
            // into lane assignment/segments so the bar visually grows,
            // shrinks, or slides live instead of jumping only on drop.
            .map((r) => {
              if (resizeState?.reservationId === r.id) {
                return { ...r, startDate: resizeState.previewStart, endDate: resizeState.previewEnd };
              }
              if (moveState?.reservation.id === r.id) {
                return { ...r, startDate: moveState.previewStart, endDate: moveState.previewEnd };
              }
              return r;
            });
          const lanes = assignLanes(berthReservations);
          const rowCount = Math.max(1, lanes.length);
          const hasConflict = conflictBerthIds.has(berth.id);

          // The "book after" suggestion is only useful if that slot isn't
          // already taken - hide it once another reservation on the same
          // day already starts at or after this one's check-out.
          function alreadyHasFollowUp(r: Reservation): boolean {
            if (!r.checkOutTime) return false;
            const day = r.endDate.slice(0, 10);
            return berthReservations.some(
              (other) =>
                other.id !== r.id &&
                other.startDate.slice(0, 10) === day &&
                other.endDate.slice(0, 10) === day &&
                other.checkInTime != null &&
                other.checkInTime >= r.checkOutTime!
            );
          }

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
                      >
                        <span className="flex h-8 w-full items-center justify-center text-base text-[#d4d4d4] opacity-0 transition-opacity group-hover:opacity-100">
                          +
                        </span>
                      </td>
                    );
                  }
                  const r = seg.reservation;
                  const isBeingResized = resizeState?.reservationId === r.id;
                  const isBeingMoved = moveState?.reservation.id === r.id;
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
                        onPointerDown={(e) => startMove(r, e)}
                        className={`relative touch-none select-none rounded px-1.5 py-1 text-left text-xs text-white ${
                          r.occupantType === "VESSEL" ? "bg-[#7c3aed]" : "bg-[#f97316]"
                        } ${isBeingResized || isBeingMoved ? "ring-2 ring-[#0a0a0a]" : ""} ${
                          isBeingMoved ? "cursor-grabbing opacity-90 shadow-lg" : "cursor-grab"
                        } transition-opacity hover:opacity-90`}
                        title={tooltipText(r)}
                      >
                        <span className="block truncate font-medium">{r.occupantName}</span>
                        {subtext(r) && (
                          <span className="block truncate font-mono text-[10px] font-normal text-white/75">
                            {subtext(r)}
                          </span>
                        )}
                      </div>
                      {r.checkOutTime &&
                        nextCheckInAfter(r.checkOutTime) &&
                        !alreadyHasFollowUp(r) && (
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
                          className="absolute -bottom-1 left-1/2 flex h-4 w-4 -translate-x-1/2 translate-y-full items-center justify-center rounded-full border border-dashed border-[#d4d4d4] text-[10px] font-medium leading-none text-[#9ca3af] opacity-0 hover:border-[#7c3aed] hover:text-[#7c3aed] group-hover:opacity-100"
                        >
                          +
                        </button>
                      )}
                      {/* Resize handles are siblings of the bar, not
                          children of it, so their pointerDown doesn't also
                          trigger the bar's own startMove. */}
                      <span
                        data-resize-handle="start"
                        data-reservation-id={r.id}
                        onPointerDown={(e) => startResize(r, "start", e)}
                        className="absolute left-0 top-0 z-10 h-full w-2 cursor-col-resize select-none opacity-0 hover:bg-white/20 group-hover:opacity-100"
                      />
                      <span
                        data-resize-handle="end"
                        data-reservation-id={r.id}
                        onPointerDown={(e) => startResize(r, "end", e)}
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
