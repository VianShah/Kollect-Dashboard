// All business time is India Standard Time, independent of the server's timezone.
export const DAY = 86_400_000;
export const IST = 330 * 60_000;

const ms = (t: number | string) => (typeof t === "string" ? Date.parse(t) : t);
const shifted = (t: number | string) => new Date(ms(t) + IST);

export const istDay = (t: number | string) => shifted(t).toISOString().slice(0, 10);
export const istMidnight = (t: number) => Math.floor((t + IST) / DAY) * DAY - IST;
export const istHour = (t: number | string) => { const d = shifted(t); return d.getUTCHours() + d.getUTCMinutes() / 60; };
export const istWeekday = (t: number | string) => shifted(t).getUTCDay(); // 0 = Sunday
export const istMonthStart = (t: number) => { const d = shifted(t); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) - IST; };
export const istMonthEnd = (t: number) => { const d = shifted(t); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) - IST - 1; };
export const istDate = (day: string, hour = 0) => Date.parse(`${day}T00:00:00+05:30`) + hour * 3_600_000;

export function dayList(from: number, to: number) {
  const out: string[] = [];
  for (let t = istMidnight(from); t <= to; t += DAY) out.push(istDay(t));
  return out;
}

// Calling-time bands used for answer-pattern analysis.
export const BANDS: { label: string; from: number; to: number }[] = [
  { label: "08–11", from: 8, to: 11 },
  { label: "11–13", from: 11, to: 13 },
  { label: "13–15", from: 13, to: 15 },
  { label: "15–17", from: 15, to: 17 },
  { label: "17–19", from: 17, to: 19 },
];
export const bandOf = (hour: number) => BANDS.findIndex((b) => hour >= b.from && hour < b.to);
