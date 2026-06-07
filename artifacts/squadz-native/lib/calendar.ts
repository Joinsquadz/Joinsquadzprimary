import { Platform, Linking } from "react-native";

const MONTHS: Record<string, number> = {
  Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
  Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
};

const EVENT_DURATION_MS = 2 * 60 * 60 * 1000;

export function parseEventStart(
  dateStr: string,
  year = new Date().getFullYear(),
): Date | null {
  const dm = dateStr.match(/([A-Z][a-z]{2})\s+(\d{1,2})/);
  if (!dm || !(dm[1] in MONTHS)) return null;
  const month = MONTHS[dm[1]];
  const day = parseInt(dm[2], 10);

  let hours = 18;
  let minutes = 0;
  const tm = dateStr.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if (tm) {
    hours = parseInt(tm[1], 10) % 12;
    if (/PM/i.test(tm[3])) hours += 12;
    minutes = parseInt(tm[2], 10);
  }

  let result = new Date(year, month, day, hours, minutes, 0, 0);
  // The display string has no year. If the parsed date already rolled well
  // into the past (e.g. a "Jan" event read in December), assume next year.
  const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;
  if (result.getTime() < Date.now() - THIRTY_DAYS) {
    result = new Date(year + 1, month, day, hours, minutes, 0, 0);
  }
  return result;
}

export type CalendarTarget = {
  title: string;
  start: Date;
  location?: string;
  notes?: string;
};

export type AddResult = {
  ok: boolean;
  method: "calendar" | "web" | "none";
  message?: string;
};

function googleCalendarUrl({ title, start, location, notes }: CalendarTarget): string {
  const end = new Date(start.getTime() + EVENT_DURATION_MS);
  const fmt = (d: Date) =>
    d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: title,
    dates: `${fmt(start)}/${fmt(end)}`,
  });
  if (location) params.set("location", location);
  if (notes) params.set("details", notes);
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

export async function addEventToCalendar(target: CalendarTarget): Promise<AddResult> {
  if (Platform.OS === "web") {
    try {
      await Linking.openURL(googleCalendarUrl(target));
      return { ok: true, method: "web" };
    } catch {
      return { ok: false, method: "none", message: "Couldn't open your calendar." };
    }
  }

  const Calendar = await import("expo-calendar");
  const { status } = await Calendar.requestCalendarPermissionsAsync();
  if (status !== "granted") {
    return { ok: false, method: "none", message: "Calendar access was denied." };
  }

  let calendarId: string | undefined;
  try {
    const def = await Calendar.getDefaultCalendarAsync();
    calendarId = def?.id;
  } catch {
    // Android has no default calendar — fall through to picking a writable one.
  }
  if (!calendarId) {
    const cals = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
    calendarId = cals.find((c) => c.allowsModifications)?.id;
  }
  if (!calendarId) {
    return { ok: false, method: "none", message: "No writable calendar found." };
  }

  await Calendar.createEventAsync(calendarId, {
    title: target.title,
    startDate: target.start,
    endDate: new Date(target.start.getTime() + EVENT_DURATION_MS),
    location: target.location,
    notes: target.notes,
  });
  return { ok: true, method: "calendar" };
}
