# Noobot Mac Client

Electron-based macOS WebView shell for Noobot.

## Behavior

- Checks `http://127.0.0.1:10061/health` on startup.
- If Noobot service is not running:
  - development mode starts it with `npm run -w service start` from the repository root;
  - packaged mode starts the bundled backend from the installed app resources.
- Waits until the service is healthy, then loads the Noobot UI.
- The existing `client/noobot-chat` first-run connection/configuration UI is used directly; the desktop shell does not store duplicate configuration.

## Backend packaging

The Mac package is not only a frontend WebView shell. Before packaging, the build runs:

```bash
npm run -w client/mac prepare:backend
```

This creates a generated backend runtime at:

```text
client/mac/build/backend-runtime/backend
```

The generated runtime is what gets copied into Electron resources:

```text
resources/backend
```

It contains the backend source/runtime packages needed by the desktop app, including:

- `service/`
- `agent/`
- `shared/`
- `i18n/`
- a fresh production-focused `node_modules/`
- generated backend runtime `package.json` / lockfile

The package does **not** directly copy the repository root `node_modules` anymore. This avoids putting Electron build tools, dev dependencies, caches, tests, docs, and unrelated workspace files into the installer.

In packaged mode the client starts the backend with Electron's embedded Node runtime:

```text
<Noobot.exe> <resources>/backend/service/app.js
```

with `ELECTRON_RUN_AS_NODE=1`.

Runtime data is directed to the Electron user data directory instead of the installation directory:

- `NOOBOT_USER_DATA_DIR=<app userData>`
- `NOOBOT_CONFIG_DIR=<app userData>/config`
- `NOOBOT_DATA_DIR=<app userData>/data`
- `NOOBOT_LOG_DIR=<app userData>/logs`

This keeps the installed program files read-only and lets first-run configuration continue through the existing Noobot UI.

## Development

Start the web UI separately:

```bash
npm run dev:client
```

Then start the Mac shell:

```bash
npm run -w client/mac dev
```

Optional environment variables:

- `NOOBOT_SERVICE_URL` defaults to `http://127.0.0.1:10061`
- `NOOBOT_SERVICE_PORT` defaults to `10061`
- `NOOBOT_CLIENT_URL` defaults to `http://127.0.0.1:10060`
- `NOOBOT_STARTUP_TIMEOUT_MS` defaults to `60000`

## Mac build

Install workspace dependencies before the first build:

```bash
npm install
```

Recommended verification order:

```bash
npm run -w client/mac check
npm run -w client/mac build:mac:dir
```

`build:mac:dir` creates an unpacked Windows app and verifies that `resources/backend/service/app.js` and production dependencies are laid out correctly, without creating an installer.

## Recommended distributable targets

Because NSIS internally still creates a `.nsis.7z` archive and may call 7zip with high compression flags on some machines, the more reliable distribution targets are portable or zip:

```bash
npm run -w client/mac build:mac:portable
```

or:

```bash
npm run -w client/mac build:mac:zip
```

These targets still include the bundled backend runtime, but avoid the NSIS installer compression path that can fail with:

```text
ERROR: Can't allocate required memory!
7za.exe ... -mx=9 ... *.nsis.7z
```

## NSIS installer

The NSIS installer target is still available:

```bash
npm run -w client/mac build:mac
```

If it continues to fail in the 7zip/NSIS stage, treat that as an installer packaging limitation rather than an application packaging failure. First verify `build:mac:dir`, then ship `portable` or `zip` while NSIS is optimized or replaced later.

On non-Windows systems, building the NSIS installer requires `wine`. Without `wine`, `electron-builder --win --dir` can still verify the unpacked app/resource layout, but the final installer step will fail.
