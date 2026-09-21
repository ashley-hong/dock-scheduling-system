/**
 * Reservations are whole-day, so dates are handled as plain "YYYY-MM-DD"
 * strings on the wire. Per the ECMAScript spec, `new Date("YYYY-MM-DD")`
 * parses as UTC midnight, which keeps comparisons stable regardless of the
 * server's local timezone.
 */
export function parseDateOnly(value: string): Date {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid date: ${value}`);
  }
  return date;
}

export function formatDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}
