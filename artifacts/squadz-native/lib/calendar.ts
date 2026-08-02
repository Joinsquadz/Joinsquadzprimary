const MONTHS: Record<string, number> = {
  Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
  Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
};

export function parseEventStart(
  dateStr: string | null | undefined,
  year = new Date().getFullYear(),
): Date | null {
  if (!dateStr) return null;
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
