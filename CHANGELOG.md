# Changelog

All notable changes to this integration are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[semantic versioning](https://semver.org/), bumped by the Release workflow.

## [Unreleased]

## [2.2.1] - 2026-10-08

### Fixed

- A malformed answer from a NUT server (an unterminated quote) no longer crashes the integration: the read fails and is reported like any other server error.
- With several servers and one of them down, the connection status no longer blinks between "connected" and "cannot reach": it stays connected and names the servers that do not answer, and only says disconnected when none answers. A failing server is logged once, not twice a minute.
- A UPS whose server was removed from the configuration no longer makes every other server be read each minute, nor shows "Cannot reach the NUT server": it is skipped, and the logs say once why.

### Changed

- A poll opens a single connection to its NUT server and reads only its own UPS (one login, `LIST UPS` + one `LIST VAR`), instead of one connection, and one login, per UPS of the server. A scan also reads a whole server on one connection.
- "Test NUT connections" names the servers that do not answer.
- The store cover image is pinned to the release tag, so a new cover is not hidden by caches.
- Node.js 22 or later is required (`engines`), and CI tests on Node 22 and 24 and builds the Docker image on pull requests.

### Security

- Documented that the NUT protocol is spoken without TLS (credentials in clear text) and how to keep `upsd` on a trusted network (`LISTEN`, firewall, dedicated read-only `upsd.users` account).

## [2.2.0] - 2026-10-07

### Fixed

- The UPS widget no longer dies past the core's 15 s: it shows the last read the polls made, and a loading card while a slow read completes.
- The battery gauge of the widget shows its "%" unit.
- A configuration with no host yet is reported as "not configured yet" instead of "Cannot reach the NUT server", and a refused configuration keeps the previous one.
- With several servers, one that does not answer is named in the connection status instead of a plain "connected".

### Changed

- CI runs the store admission checks on pull requests; Dependabot keeps the dependencies and actions up to date.
- A GitHub Release is published for every version.

## [2.1.0] - 2026-10-06

### Added

- `SECURITY.md`: how to report a vulnerability.
- `CHANGELOG.md`, rebuilt from the release history.
- `CLAUDE.md`: guide for contributors and coding agents (commands, architecture, invariants).

### Changed

- Development dependencies updated to their latest versions (ESLint 10.12, Prettier 3.9.9, globals 17.13).

### Fixed

- A NUT server that accepts the connection then stops answering no longer freezes the poll: every request is bounded by the configured timeout, not only the connection.
- A UPS added from the Discovery tab shows its values right away instead of up to an hour later: it is read the moment Gladys creates it, with every value republished.
- Before any server is configured, polls are ignored and "Test the connection" says what to fill in, instead of failing on an internal error.

## [2.0.1] - 2026-10-01

### Fixed

- Show the UPS load name instead of "Unknown"
- Keep the manifest in the Prettier style after a release

## [2.0.0] - 2026-09-22

### Added

- Add the Gladys 5.1 dashboard widget and scene triggers/actions

## [1.0.7] - 2026-08-16

### Changed

- Slow down the refresh and stop writing unchanged states

## [1.0.6] - 2026-08-16

### Fixed

- Shorten the descriptions the store rejects

## [1.0.5] - 2026-08-15

### Changed

- Reword the integration description

## [1.0.4] - 2026-08-15

### Fixed

- Give the load and apparent power a renderable category

## [1.0.3] - 2026-08-15

### Fixed

- Publish a discovery payload Gladys can register

## [1.0.2] - 2026-08-15

- Maintenance release, no functional change.

## [1.0.1] - 2026-08-15

First public release.

### Added

- Add Network UPS Tools integration

### Fixed

- Publish UPS polling frequency in milliseconds
- Support multiple NUT servers and safe discovery payload

[Unreleased]: https://github.com/prohand/gladys-nut/compare/v2.2.1...HEAD
[2.2.1]: https://github.com/prohand/gladys-nut/compare/v2.2.0...v2.2.1
[2.2.0]: https://github.com/prohand/gladys-nut/compare/v2.1.0...v2.2.0
[2.1.0]: https://github.com/prohand/gladys-nut/compare/v2.0.1...v2.1.0
[2.0.1]: https://github.com/prohand/gladys-nut/compare/v2.0.0...v2.0.1
[2.0.0]: https://github.com/prohand/gladys-nut/compare/v1.0.7...v2.0.0
[1.0.7]: https://github.com/prohand/gladys-nut/compare/v1.0.6...v1.0.7
[1.0.6]: https://github.com/prohand/gladys-nut/compare/v1.0.5...v1.0.6
[1.0.5]: https://github.com/prohand/gladys-nut/compare/v1.0.4...v1.0.5
[1.0.4]: https://github.com/prohand/gladys-nut/compare/v1.0.3...v1.0.4
[1.0.3]: https://github.com/prohand/gladys-nut/compare/v1.0.2...v1.0.3
[1.0.2]: https://github.com/prohand/gladys-nut/compare/v1.0.1...v1.0.2
[1.0.1]: https://github.com/prohand/gladys-nut/releases/tag/v1.0.1
