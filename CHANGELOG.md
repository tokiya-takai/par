# Changelog

## [0.2.0](https://github.com/tokiya-takai/par/compare/par-v0.1.4...par-v0.2.0) (2026-07-14)


### ⚠ BREAKING CHANGES

* run git/gh through a shared runner with a default timeout and readable errors ([#10](https://github.com/tokiya-takai/par/issues/10))

### Features

* `par serve` command + typed Core errors + graceful shutdown ([#14](https://github.com/tokiya-takai/par/issues/14)) ([20f91fe](https://github.com/tokiya-takai/par/commit/20f91fe275269423f98b8648dfdaa133cc30d55c))
* add Core orchestrator (review-session wiring) ([#12](https://github.com/tokiya-takai/par/issues/12)) ([5ca6abf](https://github.com/tokiya-takai/par/commit/5ca6abf8d8b498207ce9836a893327a222890dd1))
* local HTTP server (Hono transport) ([#13](https://github.com/tokiya-takai/par/issues/13)) ([93e56e7](https://github.com/tokiya-takai/par/commit/93e56e7715544ec1e967e9a213e6b97282c4df06))
* local-branch diff for non-PR review targets ([#15](https://github.com/tokiya-takai/par/issues/15)) ([499a42e](https://github.com/tokiya-takai/par/commit/499a42e9e4efb8c93bac364e963b8c930c1c1cf1))
* review cockpit UI (3-pane diff + Q&A) ([#17](https://github.com/tokiya-takai/par/issues/17)) ([2c9d7f8](https://github.com/tokiya-takai/par/commit/2c9d7f835210ff4c5fc10f245b2bd7209e9bfa19))
* web UI walking skeleton (React + Vite) + static serving ([#16](https://github.com/tokiya-takai/par/issues/16)) ([3ecd746](https://github.com/tokiya-takai/par/commit/3ecd746f924c4e688b136e79478a1e80efa65a17))


### Bug Fixes

* run git/gh through a shared runner with a default timeout and readable errors ([#10](https://github.com/tokiya-takai/par/issues/10)) ([d90f9c4](https://github.com/tokiya-takai/par/commit/d90f9c4d39ae73b1dffaa621569ee3cc50952682))

## [0.1.4](https://github.com/tokiya-takai/par/compare/par-v0.1.3...par-v0.1.4) (2026-07-12)


### Features

* add gh client (pr list + diff) ([#8](https://github.com/tokiya-takai/par/issues/8)) ([24b5af6](https://github.com/tokiya-takai/par/commit/24b5af6ae31af2ea755c27c4fb095d2a1855610f))

## [0.1.3](https://github.com/tokiya-takai/par/compare/par-v0.1.2...par-v0.1.3) (2026-07-12)


### Features

* add git worktree manager ([#6](https://github.com/tokiya-takai/par/issues/6)) ([72ee27d](https://github.com/tokiya-takai/par/commit/72ee27dcfff323c51285446f7f331850235d71f8))

## [0.1.2](https://github.com/tokiya-takai/par/compare/par-v0.1.1...par-v0.1.2) (2026-07-12)


### Features

* add clean-environment spawn harness for agent processes ([#4](https://github.com/tokiya-takai/par/issues/4)) ([0bf4939](https://github.com/tokiya-takai/par/commit/0bf49397d3baee8701ae3379295e37a13a5e8ee9))

## [0.1.1](https://github.com/tokiya-takai/par/compare/par-v0.1.0...par-v0.1.1) (2026-07-11)


### Features

* add core domain model and agent-adapter interface ([#1](https://github.com/tokiya-takai/par/issues/1)) ([0c92fb9](https://github.com/tokiya-takai/par/commit/0c92fb943fa8fdea41bece1967ce91f803687f9d))


### Build System

* add package.json and release-please configuration ([c331a4a](https://github.com/tokiya-takai/par/commit/c331a4a84e7816fc37b511d02ed0508039216e29))
* drop forced provenance from publishConfig ([82387d1](https://github.com/tokiya-takai/par/commit/82387d117377ffb3780730da58ac2ecc996a9157))
