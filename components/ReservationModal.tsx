"use client";

import { useEffect, useState } from "react";
import Modal from "@/components/Modal";
import type { Berth, OccupantType, Reservation } from "@/lib/types";

type Props = {
  berths: Berth[];
  initial: {
    id?: string;
    berthId: string;
    occupantName?: string;
    occupantType?: OccupantType;
    vesselLengthFt?: number | null;
    startDate: string;
    endDate: string;
    notes?: string | null;
  };
  onClose: () => void;
  onSaved: (reservation: Reservation) => void;
  onDeleted: (id: string) => void;
};

export default function ReservationModal({
  berths,
  initial,
  onClose,
  onSaved,
  onDeleted,
}: Props) {
  const isEditing = Boolean(initial.id);
  const [berthId, setBerthId] = useState(initial.berthId);
  const [occupantName, setOccupantName] = useState(initial.occupantName ?? "");
  const [occupantType, setOccupantType] = useState<OccupantType>(initial.occupantType ?? "VESSEL");
  const [vesselLengthFt, setVesselLengthFt] = useState(
    initial.vesselLengthFt != null ? String(initial.vesselLengthFt) : ""
  );
  const [startDate, setStartDate] = useState(initial.startDate);
  const [endDate, setEndDate] = useState(initial.endDate);
  const [notes, setNotes] = useState(initial.notes ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [vesselNames, setVesselNames] = useState<string[]>([]);

  const selectedBerth = berths.find((b) => b.id === berthId);

  useEffect(() => {
    fetch("/api/vessel-names")
      .then((r) => r.json())
      .then(setVesselNames)
      .catch(() => {});
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);

    const payload = {
      berthId,
      occupantName,
      occupantType,
      vesselLengthFt: occupantType === "VESSEL" && vesselLengthFt !== "" ? Number(vesselLengthFt) : null,
      startDate,
      endDate,
      notes: notes || null,
    };

    const url = isEditing ? `/api/reservations/${initial.id}` : "/api/reservations";
    const method = isEditing ? "PATCH" : "POST";

    try {
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const data = await res.json();
        if (data.error === "OVERLAP") {
          const names = (data.conflicts as Reservation[])
            .map((c) => `${c.occupantName} (${c.startDate.slice(0, 10)} to ${c.endDate.slice(0, 10)})`)
            .join(", ");
          setError(`This berth is already booked during that range by: ${names}`);
        } else if (data.error === "LENGTH_MISMATCH") {
          setError(data.reason ?? "Vessel does not fit this berth.");
        } else {
          setError(data.error ?? "Something went wrong.");
        }
        setSaving(false);
        return;
      }

      const saved: Reservation = await res.json();
      onSaved(saved);
    } catch {
      setError("Network error - please try again.");
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!initial.id) return;
    if (!confirm(`Delete the reservation for "${occupantName}"?`)) return;
    setSaving(true);
    const res = await fetch(`/api/reservations/${initial.id}`, { method: "DELETE" });
    if (res.ok) {
      onDeleted(initial.id);
    } else {
      setError("Could not delete this reservation.");
      setSaving(false);
    }
  }

  return (
    <Modal onClose={onClose}>
      <h2 className="mb-4 text-[17px] font-bold tracking-tight">
        {isEditing ? "Edit Reservation" : "New Reservation"}
      </h2>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="mb-1 block text-[12px] font-medium text-[#6b7280]">Berth</label>
          <select
            className="w-full rounded-md border border-[#e5e5e5] px-3 py-2 text-[14px] focus:border-[#7c3aed] focus:outline-none"
            value={berthId}
            onChange={(e) => setBerthId(e.target.value)}
            required
          >
            {berths.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name} {b.lengthFt ? `(${b.lengthFt}ft)` : "(no fixed length)"}
              </option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-[12px] font-medium text-[#6b7280]">Type</label>
            <select
              className="w-full rounded-md border border-[#e5e5e5] px-3 py-2 text-[14px] focus:border-[#7c3aed] focus:outline-none"
              value={occupantType}
              onChange={(e) => setOccupantType(e.target.value as OccupantType)}
            >
              <option value="VESSEL">Vessel</option>
              <option value="EVENT">Event</option>
            </select>
          </div>
          {occupantType === "VESSEL" && (
            <div>
              <label className="mb-1 block text-[12px] font-medium text-[#6b7280]">
                Vessel length (ft)
              </label>
              <input
                type="number"
                min={1}
                className="w-full rounded-md border border-[#e5e5e5] px-3 py-2 text-[14px] font-mono focus:border-[#7c3aed] focus:outline-none"
                value={vesselLengthFt}
                onChange={(e) => setVesselLengthFt(e.target.value)}
                placeholder={selectedBerth?.lengthFt ? `max ${selectedBerth.lengthFt}` : undefined}
                required
              />
            </div>
          )}
        </div>

        <div>
          <label className="mb-1 block text-[12px] font-medium text-[#6b7280]">
            {occupantType === "VESSEL" ? "Vessel name" : "Event name"}
          </label>
          <input
            type="text"
            list={occupantType === "VESSEL" ? "vessel-name-options" : undefined}
            className="w-full rounded-md border border-[#e5e5e5] px-3 py-2 text-[14px] focus:border-[#7c3aed] focus:outline-none"
            value={occupantName}
            onChange={(e) => setOccupantName(e.target.value)}
            placeholder={occupantType === "VESSEL" ? "R/V Example" : "Community sail day"}
            required
          />
          {occupantType === "VESSEL" && (
            <datalist id="vessel-name-options">
              {vesselNames.map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-[12px] font-medium text-[#6b7280]">Start date</label>
            <input
              type="date"
              className="w-full rounded-md border border-[#e5e5e5] px-3 py-2 text-[14px] font-mono focus:border-[#7c3aed] focus:outline-none"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              required
            />
          </div>
          <div>
            <label className="mb-1 block text-[12px] font-medium text-[#6b7280]">End date</label>
            <input
              type="date"
              className="w-full rounded-md border border-[#e5e5e5] px-3 py-2 text-[14px] font-mono focus:border-[#7c3aed] focus:outline-none"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              required
            />
          </div>
        </div>

        <div>
          <label className="mb-1 block text-[12px] font-medium text-[#6b7280]">Notes</label>
          <textarea
            className="w-full rounded-md border border-[#e5e5e5] px-3 py-2 text-[14px] focus:border-[#7c3aed] focus:outline-none"
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>

        {error && (
          <p className="rounded-md bg-red-50 px-3 py-2 text-[13px] text-red-700">{error}</p>
        )}

        <div className="flex items-center justify-between pt-2">
          <div>
            {isEditing && (
              <button
                type="button"
                onClick={handleDelete}
                disabled={saving}
                className="rounded-md px-3 py-2 text-[13px] font-medium text-red-600 hover:bg-red-50"
              >
                Delete
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md px-3 py-2 text-[13px] font-medium text-[#6b7280] hover:bg-[#f5f5f5]"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded-md bg-[#0a0a0a] px-4 py-2 text-[13px] font-medium text-white hover:bg-[#2a2a2a] disabled:opacity-50"
            >
              {saving ? "Saving..." : "Save"}
            </button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
