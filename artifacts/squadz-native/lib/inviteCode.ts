import { INVITE_ORIGIN } from "./inviteLinks";

export function normalizeSquadInviteCode(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";

  if (!trimmed.includes("://")) return trimmed.toUpperCase();

  try {
    const url = new URL(trimmed);
    if (
      url.protocol !== "https:" ||
      url.origin !== INVITE_ORIGIN ||
      url.pathname !== "/squad/join"
    ) {
      return "";
    }
    return url.searchParams.get("code")?.trim().toUpperCase() ?? "";
  } catch {
    return "";
  }
}