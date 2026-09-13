# Fast invite deep-link test matrix

Run the automated checks before a release:

- `pnpm --filter @workspace/squadz run build` — prerenders the landing page and representative squad/plan fallback routes, and fails if invite copy or the code is missing from the HTML.
- `pnpm --filter @workspace/api-server exec vitest run src/__tests__/wellKnown.test.ts src/__tests__/events.preview.test.ts --reporter=verbose`
- `pnpm --filter @workspace/squadz-native exec vitest run lib/__tests__/pendingInvite.test.ts lib/__tests__/acceptedInviteRoute.test.ts --reporter=verbose`
- `pnpm --filter @workspace/scripts run smoke-test-deeplinks -- --base-url https://joinsquadz.com`

Set `VITE_ANDROID_APP_URL` to the final Google Play listing URL before the Android launch and redeploy the web artifact. Until it is set, landing and invite pages intentionally show Android as “Coming soon.”

## Physical iPhone Safari matrix

Use a real iPhone with the current production build and Safari. Test each row from a fresh Safari tab, then repeat after deleting the app:

| URL | App installed | Expected result |
| --- | --- | --- |
| `https://joinsquadz.com/squad/join?code=...` | Yes | Universal link opens the squad join screen with the code already present. |
| `https://joinsquadz.com/join/...` for a normal event | Yes | Universal link opens the event invite screen; accepting opens the event detail. |
| `https://joinsquadz.com/join/...` for a trip | Yes | Universal link opens the invite; accepting opens the trip itinerary, not the event screen. |
| `https://joinsquadz.com/squad/join-public?id=...` | Yes | Universal link opens the public squad join screen. |
| Legacy `https://joinsquadz.com/squad/<id>` | Yes | Members open squad detail; logged-out recipients preserve the ID through auth; nonmembers open the public join screen. |
| Any row above | No | Safari paints the dedicated fallback immediately, shows the invite context/code when available, and offers the App Store link. |
| Any no-app row | No, then install | After installing and creating an account, onboarding resumes the original invite without re-entering a code. |
| Any row above on Android | No | The fallback shows “Coming soon” before launch, then a working Google Play button after `VITE_ANDROID_APP_URL` is configured. |
| Any row after tapping “Open in SquadZ” | Yes | The installed app receives the same invite destination and does not fall back to a blank or generic home screen. |

Also verify Safari back navigation, a cold app launch, a signed-out recipient, and an already-authenticated recipient. The production smoke check must report configured Apple and Android identities; placeholder association values are a deployment failure.