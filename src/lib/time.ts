/**
 * Time zones (0.12). Every time in the app is shown in the device's time zone unless the user picks another one in
 * Settings. Charts work in "wall time": each timestamp is shifted by its zone offset, so the chart library (which draws
 * UTC) shows local hours and day boundaries, and daily candles start at local midnight.
 */
export const DEVICE_TZ = "device";

/** Common zones offered in Settings (the device zone is always the first choice). */
export const TIME_ZONES = [
  "UTC",
  "America/St_Johns",
  "America/Halifax",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Phoenix",
  "America/Los_Angeles",
  "America/Anchorage",
  "Pacific/Honolulu",
  "America/Sao_Paulo",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Europe/Moscow",
  "Asia/Tokyo",
  "Australia/Sydney",
] as const;

/** The device's IANA zone (UTC when the runtime cannot tell). */
export function deviceZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

let current = deviceZone();
/** The zone in use: the device's, or the one picked in Settings. */
export function activeZone(): string {
  return current;
}
export function setActiveZone(choice: string | undefined): void {
  const zone = !choice || choice === DEVICE_TZ ? deviceZone() : choice;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    current = zone;
  } catch {
    current = deviceZone();
  }
}

const formatters = new Map<string, Intl.DateTimeFormat>();
/** Offset of `zone` from UTC at unix second `t`, in seconds (e.g. -18000 for New York in winter). */
export function zoneOffset(t: number, zone: string = current): number {
  if (zone === "UTC") return 0;
  let f = formatters.get(zone);
  if (!f) {
    try {
      f = new Intl.DateTimeFormat("en-US", { timeZone: zone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric" });
    } catch {
      return 0;
    }
    formatters.set(zone, f);
  }
  const p: Record<string, number> = {};
  for (const part of f.formatToParts(new Date(t * 1000))) if (part.type !== "literal") p[part.type] = Number(part.value);
  const wall = Date.UTC(p.year!, p.month! - 1, p.day!, p.hour === 24 ? 0 : p.hour!, p.minute!) / 1000;
  return wall - Math.floor(t / 60) * 60;
}

/** Unix seconds → wall-clock seconds in `zone` (what the chart draws). */
export function toWall(t: number, zone: string = current): number {
  return t + zoneOffset(t, zone);
}

/** Locale for dates and numbers. */
export const localeOf = (lang: string) => (lang === "fr" ? "fr-CA" : "en-US");

/** Date in the active zone ("Nov 7, 2026"). */
export function formatDate(t: number, lang: string, zone: string = current): string {
  return new Date(t * 1000).toLocaleDateString(localeOf(lang), { dateStyle: "medium", timeZone: zone });
}

/** Date and time in the active zone. */
export function formatDateTime(t: number, lang: string, zone: string = current): string {
  return new Date(t * 1000).toLocaleString(localeOf(lang), { dateStyle: "short", timeStyle: "short", timeZone: zone });
}

/** Short name of the active zone for labels ("EST", "UTC−5"). */
export function zoneLabel(lang: string, zone: string = current): string {
  try {
    const part = new Intl.DateTimeFormat(localeOf(lang), { timeZone: zone, timeZoneName: "short" }).formatToParts(new Date()).find((x) => x.type === "timeZoneName");
    return part?.value ?? zone;
  } catch {
    return zone;
  }
}
