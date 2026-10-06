# Changelog

All notable changes to this integration are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[semantic versioning](https://semver.org/), bumped by the Release workflow.

## [Unreleased]

### Added

- `SECURITY.md`: how to report a vulnerability.
- `CHANGELOG.md`, rebuilt from the release history.
- `CLAUDE.md`: guide for contributors and coding agents (commands, architecture, invariants).

### Changed

- Development dependencies updated to their latest versions (ESLint 10.12, Prettier 3.9.9, globals 17.13).

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

[Unreleased]: https://github.com/prohand/gladys-nut/compare/v2.0.1...HEAD
[2.0.1]: https://github.com/prohand/gladys-nut/compare/v2.0.0...v2.0.1
[2.0.0]: https://github.com/prohand/gladys-nut/compare/v1.0.7...v2.0.0
[1.0.7]: https://github.com/prohand/gladys-nut/compare/v1.0.6...v1.0.7
[1.0.6]: https://github.com/prohand/gladys-nut/compare/v1.0.5...v1.0.6
[1.0.5]: https://github.com/prohand/gladys-nut/compare/v1.0.4...v1.0.5
[1.0.4]: https://github.com/prohand/gladys-nut/compare/v1.0.3...v1.0.4
[1.0.3]: https://github.com/prohand/gladys-nut/compare/v1.0.2...v1.0.3
[1.0.2]: https://github.com/prohand/gladys-nut/compare/v1.0.1...v1.0.2
[1.0.1]: https://github.com/prohand/gladys-nut/releases/tag/v1.0.1
