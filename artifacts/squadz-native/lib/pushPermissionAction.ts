/**
 * What to do about notification permission, given the OS state and whether the
 * user asked for it.
 *
 * The distinction that matters: iOS stops showing the system prompt after a
 * permanent denial (`canAskAgain: false`). Re-requesting in that state is a
 * silent no-op, which is why the banner's "Fix" button appeared to do nothing.
 * Settings is the only real remedy — but sending someone there unprompted on
 * app launch is hostile, so only a user-initiated tap may do it.
 */
export type PushPermissionState = {
  granted: boolean;
  canAskAgain: boolean;
};

export type PushPermissionAction =
  /** Permission is already granted — go straight to token registration. */
  | "register"
  /** The OS will still show the prompt; ask. */
  | "request"
  /** Permanently denied and the user asked to fix it — open system Settings. */
  | "open-settings"
  /** Permanently denied on an automatic check — just surface the banner. */
  | "show-banner";

export function decidePushPermissionAction(
  state: PushPermissionState,
  userInitiated: boolean,
): PushPermissionAction {
  if (state.granted) return "register";
  if (state.canAskAgain) return "request";
  return userInitiated ? "open-settings" : "show-banner";
}
