import { Platform } from "react-native";

export type ShareIcsResult = { ok: boolean; message?: string };

/**
 * Hand a generated .ics file to the OS.
 *
 * - Web: triggers a plain file download (the browser/OS then opens it into
 *   whatever calendar the user prefers).
 * - Native: writes the file to the cache directory and opens the system share
 *   sheet so the user can send it to Apple Calendar, Google Calendar, Outlook, …
 *
 * Native modules are dynamically imported behind the platform guard so the
 * web preview never loads them.
 */
export async function shareIcsFile(filename: string, content: string): Promise<ShareIcsResult> {
  if (Platform.OS === "web") {
    try {
      const blob = new Blob([content], { type: "text/calendar;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      return { ok: true };
    } catch {
      return { ok: false, message: "Couldn't download the calendar file." };
    }
  }

  try {
    const [{ File, Paths }, Sharing] = await Promise.all([
      import("expo-file-system"),
      import("expo-sharing"),
    ]);
    if (!(await Sharing.isAvailableAsync())) {
      return { ok: false, message: "Sharing isn't available on this device." };
    }
    const file = new File(Paths.cache, filename);
    try {
      if (file.exists) file.delete();
    } catch {
      // A stale file we can't delete shouldn't block the share — write() overwrites.
    }
    file.write(content);
    await Sharing.shareAsync(file.uri, {
      mimeType: "text/calendar",
      UTI: "com.apple.ical.ics",
      dialogTitle: "Add to calendar",
    });
    return { ok: true };
  } catch {
    return { ok: false, message: "Couldn't share the calendar file." };
  }
}
