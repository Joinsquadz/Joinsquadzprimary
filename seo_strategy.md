# SEO Strategy

## In scope
- Public marketing website in `artifacts/squadz`
- Public legal/privacy page at `/privacy`
- Public crawler-facing and deep-link support files/routes that affect the website surface:
  - `artifacts/squadz/public/robots.txt`
  - `artifacts/squadz/public/favicon.svg`
  - `artifacts/squadz/public/opengraph.jpg`
  - `artifacts/api-server/src/routes/wellKnown.ts`

## Out of scope
- Authenticated or in-app mobile flows in `artifacts/squadz-native`
- Private API endpoints and dashboard-like product screens
- Email-only/token-only pages unless they directly affect public crawlability of the website

## Target audience
- Friend groups, roommates, clubs, and social circles who need to plan hangouts and events.

## Primary keywords
- friend group app
- group planning app
- event planning app for friends
- group scheduling app
- shared photo vault app
- split bills with friends app

## Notes
- The public website is a Vite + React SPA with Wouter routing.
- `/` and `/privacy` are the only intentional web routes; all other web routes currently fall back to `Landing`.
- Social bots and AI crawlers will only see the static HTML shell in `artifacts/squadz/index.html`.

## Dismissed categories
- None yet.
