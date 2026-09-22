"use client";

import { useEffect, useState } from "react";
import type { Berth } from "@/lib/types";

export default function BerthsPage() {
  const [berths, setBerths] = useState<Berth[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [lengthFt, setLengthFt] = useState("");
  const [capacity, setCapacity] = useState("1");
  const [unlimited, setUnlimited] = useState(false);

  async function load() {
    setLoading(true);
    const res = await fetch("/api/berths");
    setBerths(await res.json());
    setLoading(false);
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const res = await fetch("/api/berths", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        lengthFt: lengthFt === "" ? null : Number(lengthFt),
        capacity: unlimited ? null : Number(capacity) || 1,
      }),
    });
    if (!res.ok) {
      const data = await res.json();
      setError(data.error ?? "Could not create berth.");
      return;
    }
    setName("");
    setLengthFt("");
    setCapacity("1");
    setUnlimited(false);
    load();
  }

  async function handleDelete(berth: Berth) {
    if (
      !confirm(
        `Delete "${berth.name}"? This will also delete every reservation on this berth.`
      )
    )
      return;
    const res = await fetch(`/api/berths/${berth.id}`, { method: "DELETE" });
    if (res.ok) load();
  }

  return (
    <div className="max-w-3xl">
      <h1 className="mb-1 text-[22px] font-bold tracking-tight">Berths</h1>
      <p className="mb-6 text-[13px] text-[#6b7280]">
        Define the physical berths available at the facility. A berth with no fixed
        length (like a multi-slip finger pier) skips the vessel-length check, and a
        berth with unlimited capacity allows more than one simultaneous occupant.
      </p>

      <form
        onSubmit={handleCreate}
        className="mb-8 flex flex-wrap items-end gap-3 rounded-lg border border-[#e5e5e5] bg-white p-4"
      >
        <div>
          <label className="mb-1 block text-[11px] font-medium text-[#6b7280]">Name</label>
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-48 rounded-md border border-[#e5e5e5] px-3 py-2 text-[14px] focus:border-[#7c3aed] focus:outline-none"
            placeholder="North Pier West"
          />
        </div>
        <div>
          <label className="mb-1 block text-[11px] font-medium text-[#6b7280]">Length (ft)</label>
          <input
            type="number"
            min={1}
            value={lengthFt}
            onChange={(e) => setLengthFt(e.target.value)}
            className="w-28 rounded-md border border-[#e5e5e5] px-3 py-2 text-[14px] font-mono focus:border-[#7c3aed] focus:outline-none"
            placeholder="no fixed length"
          />
        </div>
        <div>
          <label className="mb-1 block text-[11px] font-medium text-[#6b7280]">Capacity</label>
          <input
            type="number"
            min={1}
            disabled={unlimited}
            value={capacity}
            onChange={(e) => setCapacity(e.target.value)}
            className="w-24 rounded-md border border-[#e5e5e5] px-3 py-2 text-[14px] font-mono focus:border-[#7c3aed] focus:outline-none disabled:bg-[#fafafa]"
          />
        </div>
        <label className="mb-2 flex items-center gap-1.5 text-[11px] text-[#6b7280]">
          <input type="checkbox" checked={unlimited} onChange={(e) => setUnlimited(e.target.checked)} />
          Unlimited (multi-slip)
        </label>
        <button
          type="submit"
          className="rounded-md bg-[#0a0a0a] px-4 py-2 text-[13px] font-medium text-white hover:bg-[#2a2a2a]"
        >
          Add berth
        </button>
      </form>

      {error && (
        <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-[13px] text-red-700">{error}</p>
      )}

      <div className="overflow-hidden rounded-lg border border-[#e5e5e5] bg-white">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-[#e5e5e5] bg-[#fafafa] text-left">
              <th className="px-4 py-2 font-medium">Name</th>
              <th className="px-4 py-2 font-medium">Length</th>
              <th className="px-4 py-2 font-medium">Capacity</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody>
            {berths.map((b) => (
              <tr key={b.id} className="border-b border-[#f0f0f0] last:border-0">
                <td className="px-4 py-2 font-medium">{b.name}</td>
                <td className="px-4 py-2 font-mono text-[#6b7280]">
                  {b.lengthFt ? `${b.lengthFt}ft` : "n/a"}
                </td>
                <td className="px-4 py-2 font-mono text-[#6b7280]">{b.capacity ?? "unlimited"}</td>
                <td className="px-4 py-2 text-right">
                  <button
                    onClick={() => handleDelete(b)}
                    className="text-[12px] font-medium text-red-600 hover:underline"
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {loading && <p className="p-4 text-[13px] text-[#9ca3af]">Loading...</p>}
        {!loading && berths.length === 0 && (
          <p className="p-4 text-[13px] text-[#9ca3af]">No berths yet.</p>
        )}
      </div>
    </div>
  );
}
