import { Redirect, useLocalSearchParams } from "expo-router";

/** Canonical web fallback links use /api/add/friend/:code; normalize them to
 * the native friend-invite screen rather than leaving an installed app at a
 * nonexistent Expo Router path. */
export default function CanonicalFriendInviteRedirect() {
  const { code } = useLocalSearchParams<{ code?: string }>();
  return <Redirect href={{ pathname: "/add/friend/[code]", params: { code: code ?? "" } } as never} />;
}