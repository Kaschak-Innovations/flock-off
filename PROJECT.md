# Flock Off: project overview

Status as of November 3, 2026. The README covers how the code works; this file covers where the project stands, what runs where, and what is left before launch.

## What it is

Flock Off is a phone app that warns drivers before they reach a Flock or other license plate reader (ALPR), a fixed speed camera, a speed trap another driver reported, a camera another driver spotted that is not mapped yet, or a point where the speed limit drops. An alert is a notification; tapping it opens the spot in the phone's own map app with a labeled pin. There is no account, and the app never sends your location anywhere unless you report something.

- Owner: Jonathan Kaschak (Glitch'd)
- App ID: `com.glitchd.flockoff` (Android and iOS), version 0.1.0
- Stack: Expo SDK 58 / React Native 0.88, TypeScript, SQLite on the phone, a Cloudflare Worker for shared reports
- Camera data: OpenStreetMap, mapped by the DeFlock community
- Target: Google Play first, App Store after

## Status at a glance

| Area | Status |
|---|---|
| App code | Built: all screens, alerts, reporting, Pro features. Typecheck and lint pass. Not yet run on a phone. |
| Design | Done: carbon-weave background, glass panels, custom tab bar, five alert icons, bird logo |
| Source code | Live on GitHub: `Kaschak-Innovations/flock-off` |
| Report server | Live: `https://flock-off.jonathankaschak.workers.dev` (health, privacy page, request signing on) |
| Trip packs | First nightly build in progress; refreshes every night |
| Privacy policy | Live: `https://flock-off.jonathankaschak.workers.dev/privacy` |
| Expo / EAS | Not linked yet (`eas init`) |
| Play developer account | Not created yet |
| Store listing | Graphics ready in `store/`; text, screenshots and forms to do |
| Pro purchase | Code done; product `flockoff_pro` not created in Play Console yet |

## Features

### Free

- Alerts for plate readers, fixed speed cameras, live speed traps, possible cameras and speed-limit drops, each switchable
- Two alert modes: Monitoring (low-battery geofences that work with the app closed) and Drive mode (continuous GPS that warns ahead of time and ignores things behind you)
- Tap an alert to open the spot in the phone's map app
- Nearby list, Notifications history with unread badge and filters
- Report a speed trap or a camera; camera reports can also post an OpenStreetMap note for mappers
- Vote reports "still there" or "gone"
- Feet and miles (or meters), direction filter, cooldown, alert radii

### Pro ($4.99, one time)

- Spoken alerts read aloud through the car speakers
- Automatic drive mode: starts when you start driving, stops after five minutes parked
- Live countdown to the next camera during drive mode (Android)
- Trip packs: download whole states for offline use on road trips
- Alert tuning: distance and sound per alert type, quiet hours, quiet zone around home

Every alert and all reporting stay free, so the community features work for everyone.

## How it fits together

- Phone: camera data is downloaded from OpenStreetMap (Overpass) in a 40 km box around you and cached in SQLite. Alerts are computed on the phone, so they work without a connection once data is cached.
- Report server: a Cloudflare Worker with a D1 database holds anonymous speed-trap and camera reports, merges duplicates, expires them, and counts votes. It also serves the privacy policy and trip packs.
- Abuse protection on the server: per-client rate limits, signed requests from the app, and per-install limits.
- Trip packs: a GitHub Actions job queries OpenStreetMap once per state every night and stores the results in Cloudflare KV for the worker to serve.

## Infrastructure and accounts

| Thing | Where | Notes |
|---|---|---|
| Code | github.com/Kaschak-Innovations/flock-off | Public. Main branch is the source of truth. |
| Report worker | Cloudflare account `aeb94d6d…8a49`, worker `flock-off` | Deployed automatically by `.github/workflows/deploy-worker.yml` on every push that touches `worker/` |
| Database | Cloudflare D1 `flock-off-traps` | Created and kept up to date by the deploy workflow |
| Trip packs | Cloudflare KV `flock-off-packs` | Rebuilt nightly at 07:23 UTC by `.github/workflows/build-packs.yml`; can be run by hand from the Actions tab |
| GitHub secrets | `CLOUDFLARE_API_TOKEN`, `REPORT_KEY` | Values live only in GitHub's secret storage and Cloudflare; never commit them |
| App signing key | `EXPO_PUBLIC_REPORT_KEY` | Same value as `REPORT_KEY`. Goes in a local `.env` (git-ignored) and in the EAS project's environment variables |
| Expo / EAS | Not set up | Run `eas init` to link |
| Google Play | Not set up | $25 developer account |
| Apple | Not set up | Developer Program, later |

The Cloudflare API token is named "flock-off GitHub deploy" in the Cloudflare dashboard. If it ever leaks, delete it there, create a new one with the same permissions, and update the GitHub secret.

## Brand

- Logo: green bird in flight with a camera-aperture eye; its raised wing feathers form a middle finger. Vector sources in `assets/brand/`, rebuilt with `assets/brand/tools/build_bird.py`.
- Wordmark: "FLOCK" in white, "OFF" in green, Orbitron Bold, converted to outlines.
- Colors: green `#22C55E`, red `#EF4444`, blue `#0EA5E9`, yellow `#EAB308`, background `#0A0B0E`.
- Tab colors: Status green, Nearby blue, Report red, Settings yellow.
- Store graphics: `store/play-icon-512.png`, `store/feature-graphic-1024x500.png`, `store/lockup-dark.png`.

## Money

- Model: free download, no ads, Pro as a one-time $4.99 in-app purchase.
- Why not a paid download: the competing ALPR apps (DeFlock.me, Flock Alert, FlockHopper) are free, the reporting features need lots of users, and on Google Play a free app can never become paid later, while in-app purchases can be added at any time.
- Google's cut on a one-time purchase in the US: 15% (10% service fee plus 5% billing fee) on the first $1M a year, so about $4.24 per Pro sale.
- Running costs: Cloudflare's free tier covers the worker, database and packs at launch scale; the $5 a month Workers plan is the next step if usage grows.

## Launch checklist

- [x] App feature-complete for v1, plus Pro
- [x] Design, alert icons and logo
- [x] Background-location disclosure screen (Google requires it)
- [x] Privacy policy, live
- [x] Code on GitHub
- [x] Report worker live, with bot protection
- [x] Trip pack pipeline running
- [ ] Create the Google Play developer account and finish identity verification
- [ ] `eas init`, add `EXPO_PUBLIC_REPORT_KEY` to EAS environment variables
- [ ] Development build on a phone; test everything, including Pro, in a real car
- [ ] Record screen videos for the background location and foreground service declarations
- [ ] Production build to a closed testing track; 12 testers opted in for 14 days
- [ ] Play Console: payments profile, `flockoff_pro` product, license testers
- [ ] Store listing text, screenshots, data safety form, content rating
- [ ] Apply for production access (day 15 of the closed test)
- [ ] App Store: Developer Program, App Store Connect listing, review notes

## Risks and open questions

- App icon: the bird's raised finger. Apple requires icons and screenshots to suit a 4+ rating, and Google's metadata policy asks for listing graphics suitable for all audiences. Expect review to look at it.
- Name: "Flock Off" contains Flock Safety's trademark. Similar apps are live today, but a complaint could pull the listing. Keep the description about plate reader awareness and have a fallback name ready.
- Background location: both stores review it closely. The disclosure screen, the declaration videos and clear review notes are the defense.
- Untested on hardware: automatic drive mode, spoken alerts in the background and the live countdown depend on phone behavior and need real-device testing, especially on Samsung, Xiaomi and OnePlus phones that kill background apps.
- Pro is checked on the phone only, with no server-side receipt check. A rooted phone could unlock it; accepted at this price.
- The request-signing key ships inside the app, so it stops scripts, not determined attackers. Device attestation (Play Integrity, App Attest) is the upgrade if spam appears.
- OpenStreetMap's Overpass is a shared public service; the nightly pack build takes 75 to 80 minutes and depends on it.
- iPhone has no live countdown yet (needs a Live Activity widget).

## Decisions log

| Date | Decision |
|---|---|
| Nov 2026 | Name "Flock Off", bundle `com.glitchd.flockoff`, store release |
| Nov 2026 | Notification-first design: no in-app map; alerts open the phone's map app |
| Nov 2026 | Added speed traps, possible-camera relay and speed-limit drops |
| Nov 2026 | Design: Rich tab colors, glass panels, carbon weave background, feet and miles |
| Nov 3, 2026 | Contact link is the GitHub project, not a personal email |
| Nov 3, 2026 | New GitHub account `Kaschak-Innovations` (old `NET-ERROR-404` locked out) |
| Nov 3, 2026 | Report worker deployed by GitHub Actions so the Cloudflare token never passes through chat |
| Nov 3, 2026 | Logo: the green bird with the raised-finger feathers, used everywhere |
| Nov 3, 2026 | Free app with a $4.99 one-time Pro unlock; no subscription, no ads |
| Nov 3, 2026 | Pro: spoken alerts, automatic drive mode, live countdown, trip packs, alert tuning |

## Where to look next

- `README.md`: how the app and worker work, setup, deploy, testing, store notes
- `assets/brand/README.md`: logo sources and how to rebuild the icons
- `worker/`: the report server
- `scripts/build-packs.mjs`: the trip pack builder
