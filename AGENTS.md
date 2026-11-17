# AGENTS.md — turtle-sketch

Collaborative whiteboard in the browser. No accounts/auth — meant for private networks only.
Node 22, ESM. Vite client (`client/`) + plain Node server with WebSocket (`server/index.js`), Yjs for state. State persists as compacted Yjs snapshots under the data dir (`/data/<workspace>/<board>.bin`, rolling backups in `/data/backups/...`).

## Commands

```sh
npm install
npm run build        # build client into client/dist
npm test             # build + e2e suite (tests/run.mjs, headless Chrome via playwright-core)
npm run dev:server   # API + WS on :3000 (serves client/dist)
npm run dev:client   # Vite dev server with /ws proxy
docker compose up --build   # full app on http://localhost:3000
```

`npm test` needs a Chrome binary: it uses `CHROME_PATH` if set, else puppeteer/playwright cache dirs. The text tests assert exact pixel positions — the app bundles its font (`client/public/fonts/`, Inter under SIL OFL 1.1, license in `OFL.txt` next to the files) so rendering is identical on every OS. Do not switch back to `system-ui` and do not remove the OFL.txt; update the hardcoded expectations in `tests/text.test.mjs` if the font ever changes.

## Conventions

- **Style**: minimal diffs, no reformatting of code you didn't touch. ESM everywhere (`"type": "module"`). Server is plain Node (no framework); client is TypeScript built by Vite. Sparse comments — comment behavior, not deliberation.
- **Tests**: e2e tests live in `tests/` (`node tests/run.mjs`, driven by `tests/harness.mjs`) and run via `npm test`. Always run them before pushing; they launch headless Chrome (`CHROME_PATH` or a cache dir) against the real server. Add new tests there for any behavior you change.
- **Font**: the UI uses bundled Inter (`client/public/fonts/`, SIL OFL 1.1 — keep `OFL.txt` next to the files and the README license note). Never switch back to `system-ui`: the text tests assert exact pixel positions and only pass with the bundled font. If the font ever changes, update the hardcoded expectations in `tests/text.test.mjs`.
- **Versioning**: main carries `<last-released>-snapshot`. The next release number is chosen by hand at release time (semver: `0.1.8` patch, `0.2.0` minor)
- **Security posture**: no auth by design, private networks only — don't "fix" that by adding accounts.
- **Docs**: user-facing behavior goes in `README.md` (controls, run instructions, backups, license). Keep it in sync when behavior changes.
