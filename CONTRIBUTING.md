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
   npm install
   npm run check:quality
   npm test
   ./start.sh
   ```
3. Open a PR with:
   - motivation
   - scope/impact
   - test or verification steps

## Code Guidelines

- Keep changes small and focused.
- Do not commit runtime/build artifacts (follow `.gitignore`).
- If config/env behavior changes, update:
  - docs
  - examples (`*.example.*`)

## Commit Message (recommended)

- `feat: ...`
- `fix: ...`
- `docs: ...`
- `refactor: ...`
- `chore: ...`

## Before Opening PR

- [ ] Quality checks pass
- [ ] Full repository tests pass
- [ ] App starts successfully when runtime behavior changes
- [ ] Related docs are updated
- [ ] No sensitive information is committed
