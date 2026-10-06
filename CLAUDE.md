# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Gladys Assistant **external integration** (Node 20+, ESM, no build step, one runtime
dependency: `@gladysassistant/integration-sdk`) that reads UPS data from one to five
[Network UPS Tools](https://networkupstools.org/) servers (`upsd`, TCP 3493) and publishes one
Gladys device per UPS. It is **read-only**: only `LIST UPS` and `LIST VAR` are ever sent, never an
instant command or a `SET`.

```text
Gladys ── SDK WebSocket ── this container ── TCP 3493 ── upsd ── UPS
```

## Commands

```bash
npm ci
npm test                                     # node --test (built-in runner)
node --test test/ups.test.js                 # one file
node --test --test-name-pattern "heartbeat"  # one test by name
npm run lint                                 # eslint .
npm run format:check                         # prettier --check . (CI gate)
npm run format                               # prettier --write .
npx github:GladysAssistant/integration-store .   # store admission checks
```

CI runs `format:check`, `lint`, `test` on Node 24. Releases: **Actions → Release** only (bumps
`package.json`, manifest `version` + `docker_image`, re-runs Prettier on the manifest, tags,
builds). Never bump versions by hand.

## Architecture

```
index.js               SDK wiring only (handlers registered before connect())
src/config.js          5 server slots (server_N_host/port/username/password) -> config.servers
src/nut/client.js      minimal NUT TCP client: one short connection per request, quoting, auth
src/devices/ups.js     variables -> features, discovery, refresh schedule, state dedupe
src/devices/status.js  parse `ups.status` flags (OL, OB, LB, RB...) into a readable state
src/poll.js            one core poll: read UPS, fire scene events, publish readings when due
src/scenes.js          scene triggers (power_lost, power_restored, battery_low, battery_replace)
                       and scene action get_ups_status
src/widget.js          dashboard widget "Onduleur" (Gladys 5.1)
```

### Invariants worth knowing

- **Features follow what the server reports.** A device only gets the features whose NUT
  variable exists on that UPS (`NUMERIC_VARIABLES` in `src/devices/ups.js`): no permanently
  empty sensor. Only numeric variables are published.
- **Identity = server + UPS name**, so two `ups` names on two servers stay separate devices.
  Changing the id shape orphans existing devices.
- **Polling**: devices declare `should_poll: true` and `poll_frequency: 60000` (the slowest value
  Gladys accepts — any other value rejects the whole discovery). Every poll reads `ups.status`
  for the scene triggers; readings are only published once per configured interval
  (`isRefreshDue`, 60–86 400 s, default 300 s).
- **History volume is a feature.** Unchanged states are skipped (`isStatePublishable`) but
  republished at least once an hour (`STATE_HEARTBEAT`) so Gladys does not show them as stale.
  Do not remove either mechanism.
- **Every feature declares `min`/`max`** (NOT NULL in Gladys, HTTP 422 otherwise). They are
  descriptive only: values outside are never clamped.
- **Category choices are deliberate** (comments in `ups.js`): `ups.load` uses
  `counter-sensor/integer` so the front shows its name instead of "Unknown"; apparent power is
  `energy-sensor/power` with a VA unit.
- **Scene triggers fire on transitions** of the `ups.status` flags (`statusEvents`), never on a
  state and never on the first read. Trigger and action keys are stored in users' scenes: never
  rename them.
- User-facing messages (connection status, action results) are bilingual `{ en, fr }`.

### Manifest

`gladys-assistant-integration.json` declares the 5 server slots, `poll_frequency`, `timeout`, the
`test_connection` action and the 5.1 capabilities (`gladys_version >=5.1.0`).
`test/manifest.test.js` keeps it in sync with `DEFAULT_CONFIG`, the bounds and the handlers.

## Testing

`test/helpers/fakeNut.js` is a real TCP server speaking the NUT protocol on an ephemeral port;
`test/helpers/fakeGladys.js` stands in for the SDK. Module-level maps (`lastRefreshAt`,
`lastPublishedStates`, the last status flags) leak between tests: reset them
(`resetRefreshSchedule()` and the scene helpers) in `beforeEach`.

## Conventions

Prettier formats, ESLint catches mistakes. Comments explain **why**. User docs live in
`docs/fr.md` and `docs/en.md` (re-hosted by Gladys) and the README is French: keep them in sync
with behaviour changes. The container rootfs is read-only: write nothing.
