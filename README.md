# GreenZone

Driving for dollars made easier.

GreenZone is a native iOS app for real estate scouting and "driving for dollars." Start a trip, and as you drive or walk the app draws a polyline along your exact route. You stay in control of classification: tap a large color button and the route paints in that color until you switch. One trip can contain many green / yellow / red segments, so the finished map shows exactly where you felt the quality of an area changed. Afterward you can review and clean up the route on the Trip Detail screen.

- **Green** — desirable neighborhood (safe to walk, invest, or bring clients)
- **Yellow** — average or transitional neighborhood that may need more research
- **Red** — undesirable or poorly maintained neighborhood

The free version uses the fixed three-color real-estate legend above. The paid ("Pro") version lets you create custom colors with your own meanings (for example: purple = ideal customer demographic, blue = already canvassed, orange = needs a second visit, pink = strong rental potential).

## Tech stack

- **SwiftUI** (iOS 17+) with the modern `Map` + `MapPolyline` for multi-colored route segments
- **CoreLocation** with background updates for full-trip GPS tracking
- **Observation** (`@Observable`) view models
- **Codable + JSON file** local persistence (no backend); photos saved to the app's Documents directory
- **XCTest** unit tests for the geo/segment logic
- Project generated with **XcodeGen** from [`project.yml`](project.yml)

## Project layout

```
project.yml                 XcodeGen project definition (source of truth)
GreenZone/
  App/                      App entry point + root navigation
  Models/                   Codable data models (Trip, RouteSegment, ...)
  Core/                     Pure logic: GeoMath, SegmentOps, DefaultLegend
  Store/                    TripStore, PhotoStore, AppSettings (persistence)
  Location/                 LocationManager (CoreLocation wrapper)
  Recording/                TripRecorder (live-recording view model)
  Views/                    SwiftUI screens + components
  Support/                  Small helpers (Color hex, formatters)
GreenZoneTests/             XCTest unit tests for Core logic
```

## Build & run on your iPhone (Cursor + SweetPad)

This repo intentionally does **not** commit the generated `.xcodeproj`; XcodeGen creates it from `project.yml`.

1. Install tooling (once):
   ```bash
   brew install xcodegen
   ```
   Install the **SweetPad** extension in Cursor. SweetPad also offers to install its helpers (`xcode-build-server`, `xcbeautify`) the first time you build.
2. Generate the Xcode project:
   ```bash
   xcodegen generate
   ```
3. Set your signing team so it can install to a physical device: open `project.yml`, uncomment `DEVELOPMENT_TEAM` under `settings.base` and set it to your Apple Developer Team ID (or set it in the target's Signing settings in Xcode once), then re-run `xcodegen generate`.
4. In Cursor, open the Command Palette and run **SweetPad: Generate Build Server Config** (creates `buildServer.json` for code completion), then select the `GreenZone` scheme.
5. Connect your iPhone 17 Pro, pick it as the destination in SweetPad, and **Build & Run**. Approve the location permission prompts on first launch (choose "Allow While Using" / "Change to Always" for background tracking).

### Run the unit tests

From SweetPad (**SweetPad: Test**) or the terminal:

```bash
xcodegen generate
xcodebuild test -project GreenZone.xcodeproj -scheme GreenZone \
  -destination 'platform=iOS Simulator,name=iPhone 16 Pro'
```

## Notes / MVP scope

- Persistence is fully local (JSON in the app sandbox). No accounts, backend, or team sync yet.
- The paid tier is unlocked with a local **Pro** toggle for the MVP; real StoreKit in-app purchases are a future step.
- Background location requires running on a real device with location permission set to "Always" for tracking while the screen is off.
