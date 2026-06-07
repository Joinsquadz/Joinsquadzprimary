import { Alert, Platform } from "react-native";

type AlertButton = {
  text?: string;
  onPress?: (value?: string) => void;
  style?: "default" | "cancel" | "destructive";
};

let installed = false;

/**
 * react-native-web does not implement `Alert.alert`, so every alert-driven
 * action (confirmations, prompts, info dialogs) silently does nothing in the
 * web preview. This patches `Alert.alert` on web only, mapping native alert
 * buttons onto `window.alert` / `window.confirm` so those flows are usable in
 * the browser preview. Native (iOS/Android) is untouched.
 */
export function installWebAlert() {
  if (installed) return;
  installed = true;

  if (Platform.OS !== "web") return;
  if (typeof window === "undefined") return;

  const webAlert = (
    title?: string,
    message?: string,
    buttons?: AlertButton[],
  ) => {
    const text = [title, message].filter(Boolean).join("\n\n");

    if (!buttons || buttons.length === 0) {
      window.alert(text);
      return;
    }

    if (buttons.length === 1) {
      window.alert(text);
      buttons[0].onPress?.();
      return;
    }

    const cancelBtn = buttons.find((b) => b.style === "cancel");

    if (buttons.length === 2) {
      const nonCancel = buttons.filter((b) => b !== cancelBtn);
      const primary = nonCancel[nonCancel.length - 1];
      if (window.confirm(text)) {
        primary?.onPress?.();
      } else {
        (cancelBtn ?? buttons[0])?.onPress?.();
      }
      return;
    }

    // 3+ buttons can't be represented by window.confirm. Show the message and
    // only run an explicit cancel/dismiss handler — never auto-fire an action.
    const choices = buttons
      .map((b) => b.text)
      .filter(Boolean)
      .join(" · ");
    window.alert(choices ? `${text}\n\n[${choices}]` : text);
    cancelBtn?.onPress?.();
  };

  Alert.alert = webAlert as typeof Alert.alert;
}
