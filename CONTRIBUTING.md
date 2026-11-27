# Contributing

[中文](./CONTRIBUTING.zh-CN.md) | English

Thanks for contributing to Noobot 🎉

## Workflow

1. Fork this repository and create a branch:
   - `feat/...`
   - `fix/...`
   - `docs/...`
2. Install, verify, and run locally:
   ```bash
   npm ci
   npm run install:mcp-test-service
   npm run check:quality
   npm test
   npm run build
   ./start.sh
   ```
3. Open a PR with:
   - motivation
   - scope/impact
   - test or verification steps

## Performance tests

Mark Node.js performance measurements and load tests with `@performance` in the test name.
GitHub Actions excludes them using `NODE_OPTIONS=--test-skip-pattern=@performance`, including tests launched by nested npm scripts.
Functional tests and deterministic tests of performance-gate logic remain enabled.
Local `npm test` includes performance tests; run benchmarks on controlled hardware.
To reproduce GitHub's selection locally: `NODE_OPTIONS=--test-skip-pattern=@performance npm test`.

## Code Guidelines

`npm run check:quality` includes the [dead-code check](./docs/dead-code-quality.md).
Run `npm run check:dead-code` on its own to check unused production files, exports and dependencies.

Use the Node.js and npm versions declared in the root `package.json`. The
[CI workflow](./.github/workflows/quality-checks.yml) runs quality checks, repository
regressions, and client builds on Node.js 24.21.0 and 26.9.0. Browser protocol tests
run separately against started services; see the [E2E guide](./client/noobot-chat/tests/e2e/protocol/README.md).

- Keep changes small and focused.
- Do not commit runtime/build artifacts (follow `.gitignore`).
- If config/env behavior changes, update:
  - docs
  - examples (`*.example.*`)

## Documentation

Start from the [documentation index](./docs/README.md). Keep usage and architecture
guides aligned with code, and update both languages when a translated guide exists.
Link to protocol definitions for schemas and to executable specs for acceptance
conditions. Keep task lists, temporary audits, dated measurements, and implementation
progress out of maintained guides; use issues and pull requests for work tracking,
and Git history for superseded documents. Preserve release notes and license notices.

## Commit Message (recommended)

- `feat: ...`
- `fix: ...`
- `docs: ...`
- `refactor: ...`
- `chore: ...`

## Before Opening PR

- [ ] Quality checks pass
- [ ] Full repository tests pass
- [ ] Production clients build successfully
- [ ] App starts successfully when runtime behavior changes
- [ ] Related docs are updated
- [ ] No sensitive information is committed
