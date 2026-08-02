import { Platform, Share } from "react-native";

let installed = false;

/** Sync hidden-textarea copy — works inside cross-origin iframes where
 * navigator.clipboard is blocked (must run within the user gesture). */
function webCopy(text: string): boolean {
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

/** Minimal self-contained DOM toast so the fallback gives visible feedback
 * without depending on any React context. */
function showWebToast(message: string) {
  try {
    const el = document.createElement("div");
    el.textContent = message;
    el.setAttribute("role", "status");
    Object.assign(el.style, {
      position: "fixed",
      left: "50%",
      bottom: "104px", // clear the 84px web tab bar
      transform: "translateX(-50%)",
      background: "rgba(20,20,24,0.92)",
      color: "#fff",
      padding: "10px 16px",
      borderRadius: "10px",
      fontFamily: "system-ui, sans-serif",
      fontSize: "14px",
      zIndex: "99999",
      maxWidth: "90vw",
      textAlign: "center",
      transition: "opacity 0.3s",
    } as CSSStyleDeclaration);
    document.body.appendChild(el);
    setTimeout(() => {
      el.style.opacity = "0";
      setTimeout(() => el.remove(), 350);
    }, 2200);
  } catch {
    // Feedback is best-effort; the copy itself already happened.
  }
}

/**
 * react-native-web's Share.share rejects with "Share is not supported in this
 * browser" whenever navigator.share is unavailable (all desktop Linux/Chromium,
 * many desktop browsers), which surfaces as a red error overlay in dev and an
 * unhandled rejection in prod web. This patches Share.share on web only:
 * native Web Share API when available, otherwise copy-to-clipboard with a
 * small confirmation toast. Native (iOS/Android) is untouched.
 */
export function installWebShare() {
  if (installed) return;
  installed = true;

  if (Platform.OS !== "web") return;
  if (typeof window === "undefined") return;

  type ShareContent = { title?: string; message?: string; url?: string };

  const webShare = async (content: ShareContent) => {
    const url = content.url;
    const message = content.message ?? "";

    if (typeof navigator.share === "function") {
      try {
        await navigator.share({
          title: content.title,
          text: message || undefined,
          url,
        });
        return { action: "sharedAction" as const, activityType: null };
      } catch (err) {
        if ((err as { name?: string })?.name === "AbortError") {
          // User dismissed the native share sheet.
          return { action: "dismissedAction" as const };
        }
        // Fall through to the clipboard fallback on any other failure.
      }
    }

    // Message usually already embeds the link; fall back to the URL alone.
    const textToCopy = message || url || "";
    if (!textToCopy) return { action: "dismissedAction" as const };

    let copied = false;
    // Sync path first: inside the preview iframe navigator.clipboard throws,
    // and the async attempt would burn the user-gesture window.
    copied = webCopy(textToCopy);
    if (!copied) {
      try {
        await navigator.clipboard.writeText(textToCopy);
        copied = true;
      } catch {
        copied = false;
      }
    }
    showWebToast(copied ? "Copied to clipboard — paste it anywhere to share" : textToCopy);
    return { action: "sharedAction" as const, activityType: null };
  };

  (Share as { share: unknown }).share = webShare;
}
