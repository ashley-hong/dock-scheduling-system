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
      <h1 className="mb-1 text-xl font-semibold">Berths</h1>
      <p className="mb-6 text-sm text-slate-500">
        Define the physical berths available at the facility. A berth with no fixed
        length (like a multi-slip finger pier) skips the vessel-length check, and a
        berth with unlimited capacity allows more than one simultaneous occupant.
      </p>

      <form
        onSubmit={handleCreate}
        className="mb-8 flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-white p-4"
      >
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-700">Name</label>
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-48 rounded-md border border-slate-300 px-3 py-2 text-sm"
            placeholder="North Pier West"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-700">Length (ft)</label>
          <input
            type="number"
            min={1}
            value={lengthFt}
            onChange={(e) => setLengthFt(e.target.value)}
            className="w-28 rounded-md border border-slate-300 px-3 py-2 text-sm"
            placeholder="no fixed length"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-700">Capacity</label>
          <input
            type="number"
            min={1}
            disabled={unlimited}
            value={capacity}
            onChange={(e) => setCapacity(e.target.value)}
            className="w-24 rounded-md border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-100"
          />
        </div>
        <label className="mb-2 flex items-center gap-1.5 text-xs text-slate-600">
          <input type="checkbox" checked={unlimited} onChange={(e) => setUnlimited(e.target.checked)} />
          Unlimited (multi-slip)
        </label>
        <button
          type="submit"
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
        >
          Add berth
        </button>
      </form>

      {error && (
        <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      )}

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-left">
              <th className="px-4 py-2 font-medium">Name</th>
              <th className="px-4 py-2 font-medium">Length</th>
              <th className="px-4 py-2 font-medium">Capacity</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody>
            {berths.map((b) => (
              <tr key={b.id} className="border-b border-slate-100 last:border-0">
                <td className="px-4 py-2 font-medium">{b.name}</td>
                <td className="px-4 py-2 text-slate-600">
                  {b.lengthFt ? `${b.lengthFt} ft` : "n/a"}
                </td>
                <td className="px-4 py-2 text-slate-600">{b.capacity ?? "unlimited"}</td>
                <td className="px-4 py-2 text-right">
                  <button
                    onClick={() => handleDelete(b)}
                    className="text-xs font-medium text-red-600 hover:underline"
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {loading && <p className="p-4 text-sm text-slate-400">Loading...</p>}
        {!loading && berths.length === 0 && (
          <p className="p-4 text-sm text-slate-400">No berths yet.</p>
        )}
      </div>
    </div>
  );
}
