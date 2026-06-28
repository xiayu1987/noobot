# Noobot Windows Client

Electron-based Windows WebView shell for Noobot.

## Behavior

- Checks `http://127.0.0.1:10061/health` on startup.
- If Noobot service is not running:
  - development mode starts it with `npm run -w service start` from the repository root;
  - packaged mode starts the bundled backend from the installed app resources.
- Waits until the service is healthy, then loads the Noobot UI.
- The existing `client/noobot-chat` first-run connection/configuration UI is used directly; the desktop shell does not store duplicate configuration.

## Backend packaging

The Windows installer is not only a frontend WebView package. It also includes the Noobot backend runtime files under Electron's `resources/backend` directory:

- `service/`
- `agent/`
- `shared/`
- `i18n/`
- root `node_modules/`
- root `package.json` and `package-lock.json`

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

Then start the Windows shell:

```bash
npm run -w client/windows dev
```

Optional environment variables:

- `NOOBOT_SERVICE_URL` defaults to `http://127.0.0.1:10061`
- `NOOBOT_SERVICE_PORT` defaults to `10061`
- `NOOBOT_CLIENT_URL` defaults to `http://127.0.0.1:10060`
- `NOOBOT_STARTUP_TIMEOUT_MS` defaults to `60000`

## Windows build

```bash
npm run -w client/windows build:win
```

The installer output is written to `client/windows/dist`.

On non-Windows systems, building the NSIS installer requires `wine`. Without `wine`, `electron-builder --win --dir` can still verify the unpacked app/resource layout, but the final installer step will fail.
