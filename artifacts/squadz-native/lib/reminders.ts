import { Platform } from "react-native";

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

export type ReminderResult = {
  ok: boolean;
  message?: string;
  whenLabel?: string;
};

export async function scheduleRsvpReminder(opts: {
  title: string;
  start: Date;
}): Promise<ReminderResult> {
  if (Platform.OS === "web") {
    return { ok: false, message: "RSVP reminders are available in the mobile app." };
  }

  const now = Date.now();
  const startMs = opts.start.getTime();
  if (startMs <= now) {
    return { ok: false, message: "This event has already started." };
  }

  // Remind a day before; if it's sooner than that, nudge halfway to the
  // start (capped at an hour out) so the reminder still has time to land.
  const dayBefore = startMs - DAY_MS;
  const triggerMs =
    dayBefore > now
      ? dayBefore
      : now + Math.min(HOUR_MS, Math.max(10_000, (startMs - now) / 2));
  const seconds = Math.max(5, Math.round((triggerMs - now) / 1000));

  const Notifications = await import("expo-notifications");
  let granted = false;
  const perm = await Notifications.getPermissionsAsync();
  granted = perm.granted || perm.status === "granted";
  if (!granted) {
    const req = await Notifications.requestPermissionsAsync();
    granted = req.granted || req.status === "granted";
  }
  if (!granted) {
    return { ok: false, message: "Notification access was denied." };
  }

  await Notifications.scheduleNotificationAsync({
    content: {
      title: "Don't leave them hanging 👀",
      body: `You still haven't RSVP'd to ${opts.title}. Tap to reply.`,
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
      seconds,
      repeats: false,
    },
  });

  const when = new Date(now + seconds * 1000);
  const whenLabel = when.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  return { ok: true, whenLabel };
}
