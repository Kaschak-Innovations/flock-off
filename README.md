# Flock Off

Warns you when you are approaching a license plate reader (Flock Safety and other ALPR cameras), a fixed speed camera, a speed trap another driver reported minutes ago, a camera another driver spotted that mappers haven't tagged yet, or a point where the posted speed limit drops. Tap the alert and the spot opens in your phone's default map app with a labeled pin. No account, no map of your own movements, no server that knows where you are.

Built with Expo SDK 58 (React Native). Camera data is OpenStreetMap, where the [DeFlock](https://deflock.me) community maps readers. Live speed traps run through a tiny Cloudflare Worker in `worker/`.

Not affiliated with Flock Safety. Awareness only; the app does not interfere with any camera or system.

## How it works

Two alert modes share one engine.

Monitoring (idle mode) uses the operating system's geofences, which cost almost no battery and wake the app even when it is closed. A phone can only watch a handful of circles at once (20 on iOS, 100 on Android), so the app registers the nearest targets plus one large bubble centered on you. Leaving the bubble is the signal to re-center: refresh the data if you moved far, pick the new nearest set, re-register. See `src/engine/geofence.ts`.

Drive mode uses continuous GPS and does its own distance check, so the warning lands a few hundred meters ahead instead of on top of the camera. It costs more battery, runs as a foreground service on Android (persistent notification) and uses the Always permission on iOS. The lookahead grows with speed, things behind you are ignored, and an optional direction-aware filter skips cameras that face a cross street. See `src/engine/driveMode.ts`.

Alerts are local notifications with a per-camera cooldown (default 10 minutes). Tapping one opens `maps://?ll=LAT,LON&q=LABEL` on iOS or `geo:LAT,LON?q=LAT,LON(LABEL)` on Android, where the label names the kind (Flock camera, Speed trap, Speed limit 35...). Every alert is also kept in the Notifications screen. See `src/alerts/notify.ts`.

Data comes from Overpass (`man_made=surveillance` + `surveillance:type=ALPR`, and `highway=speed_camera`) in a 40 km box around you, cached in SQLite, refreshed when you move 15 km or after a day. See `src/data/overpass.ts`.

Reporting a camera does three things at once: saves the fix on the phone, relays it through the worker as an unverified "reported camera" that warns other drivers for two weeks (longer when confirmed, retired by three "gone" votes), and, if enabled, posts an anonymous OpenStreetMap note so mappers can verify and tag it, after which it arrives through the normal camera sync. Reporting a speed trap posts to the worker; nearby drivers get it for two hours, longer when others confirm it. See `src/data/reports.ts`, `src/data/traps.ts`, `worker/src/index.ts`.

Speed-limit drops come from OpenStreetMap too. OSM splits a road into a new way wherever the posted limit changes, so a drop is a node shared by two ways whose `maxspeed` differs. The app pulls ways with `maxspeed` on motorway-through-unclassified roads in a 15 km box, computes every join where the limit falls by 5 mph or more along with the direction of travel into the lower limit, and caches the points. Drive mode warns a few hundred meters before a drop of at least the configured minimum (default 15 mph) when your heading matches the road's direction within 60 degrees. Limit drops are drive-mode only: there are too many to spend geofence slots on, and they only matter while moving. See `src/data/limits.ts`.

## Pro

One non-consumable in-app product, `flockoff_pro` ($4.99 suggested), unlocks five driving-comfort features. Every alert, every camera type and reporting stay free; Pro never gates what the community reports depend on.

- Spoken alerts. Each alert is also read aloud ("Flock camera ahead, 1,000 feet, on Route 4") with expo-speech, using its own audio session so it ducks music. iOS needs the `audio` background mode for this (set in `app.json`); mention spoken alerts in App Review notes.
- Automatic drive mode. With Monitoring on, the geofence watcher keeps a 300 m "sentinel" circle around where the phone rests. Leaving it triggers a speed check (GPS speed, or two fixes eight seconds apart); 15 mph or more starts drive mode, anything slower re-centers the circle. Automatic sessions stop after five minutes parked and re-arm the sentinel there. Geofence exits are one of the events Android allows to start a location foreground service from the background. `src/engine/autoDrive.ts`.
- Live countdown (Android). A silent, ongoing notification on its own low-importance channel shows the next thing ahead and its distance, updated at most every 4 seconds. iOS would need a Live Activity widget extension; not built yet. `src/alerts/live.ts`.
- Trip packs. `.github/workflows/build-packs.yml` runs nightly (and on demand), queries Overpass once per state (`scripts/build-packs.mjs`), and uploads compact per-state JSON to the worker's KV namespace, one state at a time (about 90 seconds each, so a full run takes 75 to 80 minutes; states run oldest-first and a run stops starting new ones after 95 minutes). The worker serves `/packs` and `/packs/:state`; the app's Trip packs screen downloads states into the camera cache, tagged so they can be removed. Packs carry plate readers and speed cameras; speed-limit drops and live traps still need a connection.
- Alert tuning. Per alert type: warning distance (Near 0.6x, Normal, Early 1.6x of the geofence and drive radius) and sound (system default, chime, pulse, vibrate only; Android gets one channel per sound because channel sounds are fixed at creation). Quiet hours, and a quiet zone around a saved home spot. `src/alerts/tuning.ts`.

Purchases use expo-iap (Google Play Billing / StoreKit). The entitlement is cached on the device for background tasks and re-checked with the store on every launch; purchases are acknowledged immediately, since Google refunds unacknowledged ones after three days. Development builds show an "Unlock for testing" switch on the Pro page; store builds ignore it. There is no server-side receipt check, so a determined user on a rooted phone could unlock Pro locally; at this price that is an acceptable trade for keeping the app serverless.

To sell it:

1. In Play Console, set up a payments profile (Settings, Payments profile). Paid products need it.
2. Upload a build that includes expo-iap (any build from this commit on) to a testing track. Play only lets you create products after a build with the billing library is uploaded.
3. Monetize, Products, In-app products, Create product: ID `flockoff_pro`, name "Flock Off Pro", price $4.99. Activate it.
4. Add your Google account under Settings, License testing so test purchases are free.
5. On iOS, create a non-consumable with the same product ID in App Store Connect.

## Repo layout

```
app.json                 identity, permissions, icons, config plugins
eas.json                 EAS Build profiles
.env.example             the one build-time variable (report signing key)
assets/icons/            the five alert pictures (Flock, speed camera, trap, possible camera, limit)
assets/images/           app icon, adaptive icon layers, splash lockup, favicon, carbon-weave background tiles
assets/brand/            the bird mark and lockups as SVG, plus the build script
store/                   Play listing icon (512), feature graphic (1024x500), dark lockups
docs/privacy-policy.html privacy policy; the worker serves the same file at /privacy
src/app/                 Expo Router screens: (tabs) index (Status), nearby, report, settings; notifications; disclosure
src/components/          ui.tsx (Screen, Group, Row, Button...), glass.tsx, backdrop.tsx, tab-bar.tsx
src/constants/theme.ts   colors, glass tokens, type scale, spacing
src/engine/              geofence rotation, drive mode, monitoring switches, target ranking
src/alerts/              notify.ts (alert copy, firing, maps deep links), icons.ts (notification pictures)
src/data/                Overpass camera sync, speed-limit drops, OSM notes, report client, request signing
src/db/db.ts             SQLite schema and queries (cameras, traps, reports, roads, alert log)
src/store/settings.ts    user settings (AsyncStorage) and the per-install random id
src/tasks.ts             background task definitions (imported first by the root layout)
worker/                  Cloudflare Worker + D1 for live reports, KV for trip packs
scripts/build-packs.mjs  nightly per-state camera packs from Overpass (run by GitHub Actions)
src/pro/pro.ts           Pro entitlement, purchase and restore
```

## Design

Dark only. The backdrop is a tiled carbon weave with a soft top glow; panels and the tab bar are glass (native blur on iOS, Liquid Glass on iOS 26, a solid tinted fill on Android, where blur over a moving list is expensive). The tab bar is custom: four borderless keys in the tab's own color, green Status, blue Nearby, red Report, yellow Settings. Every screen opens with an icon key, a title and a one-line status; a bell in the corner opens the Notifications screen (alert history, read/unread, filters). Distances are feet under 0.3 mi and miles above, with a metric switch in Settings. Tokens live in `src/constants/theme.ts`; the building blocks in `src/components/ui.tsx`.

Alerts are built to be read at a glance from the dash: the title is the thing and the distance (`Flock camera · 1,000 ft`), the body is the road (`Ahead on Route 4`). Each kind has its own picture on iOS (attached to the notification) and its own accent color on Android. Android cannot show a per-notification picture through expo-notifications; the small status-bar icon is the app's and the color does the differentiating.

## First run

Background location is native code, so this does not run in Expo Go. You need a development build.

1. Install dependencies: `npm install` in the project root.
2. Install EAS CLI and sign in: `npm i -g eas-cli` then `eas login`.
3. Link the project to your Expo account: `eas init`. This writes the project id into `app.json`.
4. Build a development client for your phone: `eas build --profile development --platform ios` (needs an Apple Developer account and your device registered via `eas device:create`) or `eas build --profile development --platform android` (produces an APK you can sideload).
5. Install the build on the phone, then start the dev server: `npx expo start --dev-client`.
6. Optional: copy `.env.example` to `.env` and set `EXPO_PUBLIC_REPORT_KEY` if your worker has a signing key (see below). Leave it empty otherwise.
7. In the app, open Status and turn on Monitoring. A disclosure screen explains the background-location use first (Google requires this before the system prompt); Continue then asks for location (choose Always / Allow all the time) and notifications. The first sync downloads cameras within 40 km.
8. Press Test alert to verify the notification and the maps handoff without driving anywhere.

For a shareable build without the dev server use `--profile preview`; for the stores use `--profile production` and `eas submit`.

## Deploy the report worker

Live reports (speed traps and relayed camera sightings) are optional. Without a worker URL, reports stay on the reporting phone.

1. `cd worker && npm install`
2. `npm run db:create`, then paste the printed `database_id` into `wrangler.jsonc`.
3. `npm run db:init` to create the tables in D1.
4. Set the contact shown on the privacy page: edit `CONTACT` in `wrangler.jsonc` (a URL or an email address).
5. `npx wrangler secret put REPORT_KEY` and paste a long random string (`openssl rand -hex 32`). This turns on request signing. Skip it to run open.
6. `npm run deploy`. Note the `*.workers.dev` URL it prints. `GET /health` should answer `{"ok":true,"signing":true,...}`.
7. Put that URL in the app under Settings, Speed trap server. Put the same random string in `EXPO_PUBLIC_REPORT_KEY` for every build that talks to this worker (a local `.env` for `expo start`; the project's EAS environment variables for `eas build`). A build whose key does not match gets a clear "rejected this build" message instead of a silent failure.
8. Open `https://<your-worker>/privacy`, check the page, then set `REPORT_SERVER_URL` in `src/config.ts` to the worker address. That makes it the default report server, and `PRIVACY_URL` (its `/privacy` page) the link in Settings, the disclosure screen, Play Console and App Store Connect. The live worker is https://flock-off.jonathankaschak.workers.dev, deployed by `.github/workflows/deploy-worker.yml` on every push that touches `worker/`.

If you created the database before report kinds existed, apply `migrations/0002_kind.sql` instead of re-running `schema.sql`.

Local testing: `npm run db:init:local`, copy `.dev.vars.example` to `.dev.vars` (or delete the key line to run unsigned), `npm run dev`, and point the app at `http://<your-lan-ip>:8787`. Rate-limit bindings work locally too.

The worker stores only the reported spot, its kind, a timestamp, votes, and a SHA-256 hash of the app's random install id (used for the per-install limits and one-vote-per-install). Lifetimes are per kind and set in `wrangler.jsonc`: traps live 2 hours (+45 min per confirmation, 6 hours max) and merge within 150 m; camera sightings live 14 days (+7 days per confirmation, 60 days max) and merge within 60 m. An hourly cron deletes anything expired for more than a day.

Abuse controls come in three layers. First, Cloudflare rate-limit bindings per client (IPv4 address, or IPv6 /64) run before any database work: 30 writes and 300 reads a minute, sized for scripted floods rather than people because mobile carriers put thousands of phones behind one address. Second, when `REPORT_KEY` is set every POST must carry `X-Flock-Ts` and `X-Flock-Sig` (HMAC-SHA256 over timestamp, method, path and body, five-minute window), which stops anyone who has not pulled the key out of the app binary. Third, per-install limits in D1: one report every two minutes, ten an hour, one vote per report. The key ships inside the app, so a determined attacker can extract it; the real upgrade is device attestation (Play Integrity on Android, App Attest on iOS), where the phone proves to Google or Apple that a genuine, unmodified build is making the request. That needs a native module on the app side and a verification step in the worker, and is the first thing to add if spam shows up. Turnstile is the lighter middle step if it does.

## Testing without driving

iOS Simulator: Features, Location, Freeway Drive or City Run moves a fake GPS; drive mode alerts fire if you have synced cameras near the simulated route (Apple's default routes are in Cupertino, so sync there first with Download now). Geofence events also work in the simulator. Xcode can also play a GPX file through the simulated device.

Android emulator: Extended controls, Location, load a GPX/KML route and press play. Geofences in the emulator are flaky; drive mode is the reliable way to test.

Real device: Download now caches your area, then walk or drive past any mapped camera. The Nearby tab shows what is cached and how far away it is.

## Store notes

### Google Play checklist

1. Developer account. A personal account created after November 2023 must run a closed test with at least 12 testers opted in for 14 continuous days before it can apply for production access. Start that clock early: build with `eas build --profile production --platform android`, upload the AAB to a closed track, and recruit testers.
2. Target API level. Since August 31, 2026 new apps and updates must target Android 16 (API 36). Expo SDK 58 does; keep the SDK current and check `eas build` output.
3. Privacy policy. Play Console needs a public URL on the store listing and inside the app. Use the worker's `/privacy` page (step 8 above) or host `docs/privacy-policy.html` anywhere else, and keep `PRIVACY_URL` in `src/config.ts` pointing at it.
4. Data safety form. Location: collected (app functionality), processed ephemerally on device, not shared, except the spot a user chooses to report, which is sent to the report server and (optionally) OpenStreetMap as user-generated content not linked to identity. No other data. The hashed install id is not a persistent identifier tied to a person, but describe it honestly as a device-generated random id used for rate limiting.
5. Background location declaration. In App content, declare the location permission, explain that the app needs it to warn drivers about cameras while the app is closed, and upload a short screen recording that shows: the disclosure screen (`src/app/disclosure.tsx`), the system permission prompt, and an alert arriving with the app in the background. Google rejects apps whose prominent disclosure is missing or that ask for the permission before explaining it; this app shows the disclosure before the first request.
6. Foreground service declaration. Drive mode runs a `location` foreground service (set by `expo-location` in `app.json`). Declare that type in App content and attach a recording of drive mode running with its persistent notification.
7. Listing. Keep the description about license plate reader awareness and road safety. The name contains Flock Safety's trademark; DeFlock, Flock Alert, FlockHopper and FlockDetour are live on the stores today, so review is currently passing names like this, but a complaint from the mark holder could pull the listing. Have a fallback name ready.
8. Assets. `assets/images` holds the icon set and `store/` the Play listing icon and feature graphic, all generated from the vector bird in `assets/brand`. Phone screenshots are the one thing left to capture. Google's metadata policy asks for icons and listing graphics suitable for all audiences, so expect review to look closely at the bird's raised finger.

### App Store notes

Apple reviews Always location closely. The purpose strings in `app.json` explain it; the disclosure screen doubles as the in-app explanation Apple likes to see before the prompt. Fill in App Review notes describing the geofence watcher and drive mode and how to trigger a test alert. Privacy nutrition label: location is used for app functionality only, not collected, not linked to identity; the report server receives a location only when the user taps Report, disclosed as "user content, not linked to you." Notification pictures use attachments and need no extension target. Apple requires app icons and screenshots to meet a 4+ rating regardless of the app's own rating, and the App Store icon comes from the binary, so the bird's raised finger is a likely review point.

Android 10+ shows a separate "Allow all the time" step; `requestBackgroundPermissionsAsync` sends the user to system settings on Android 11+, and the disclosure screen tells people what to pick there.

## Known limits

iOS holds geofence events for roughly 20 seconds after a crossing to filter noise, which at 45 mph is about 400 m, so idle-mode alerts can arrive late. Drive mode exists for that reason.

Android kills apps aggressively on some vendors (Samsung, Xiaomi, OnePlus). A terminated app does not get geofence events on Android; drive mode's foreground service is the robust path there. See dontkillmyapp.com.

Overpass is a shared public service with rate limits. If syncs fail during peak hours the app keeps working from its cache; a nightly extract on your own storage (DeFlock serves its points from Cloudflare R2) would remove the dependency. The speed-limit query is the heavy one (way geometry for every tagged road in 15 km): a few MB in a rural area, tens of MB in a metro. It runs when drive mode starts and then at most weekly or after moving 7 km, and it is the first thing to move to your own pre-computed extract.

Limit-drop quality is only as good as the maxspeed tagging. Untagged roads produce no drops, and a road whose limit changes mid-way without a way split is missed; the direction gate means a drop is never announced to traffic going the other way.

Coverage is whatever the community has mapped. An unmapped camera is still a camera.

## Roadmap

Spoken alerts in drive mode (expo-speech). Direct OpenStreetMap editing with OAuth 2 so camera reports become tagged nodes instead of notes. CarPlay and Android Auto templates for alerts on the car screen. A bundled nationwide snapshot for first-run offline use. Route exposure preview. Apple Watch and Wear OS haptic alerts.

## Data and credits

Camera locations © OpenStreetMap contributors, ODbL. Identification guides and the tagging convention come from the DeFlock project. Overpass API by the Overpass community.
