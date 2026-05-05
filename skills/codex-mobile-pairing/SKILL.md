---
name: codex-mobile-pairing
version: 1.0.0
description: "CodexMobile reboot pairing helper. Use when the user wants to quickly start or restart the local CodexMobile bridge after a computer reboot, verify the phone-facing service, and get the pairing code plus private-network access URLs."
metadata:
  requires:
    bins: ["node", "npm"]
---

# CodexMobile Pairing

Use this skill when the user asks to start CodexMobile, restart the phone bridge, pair the phone again, show the pairing code, or recover after a computer reboot.

## Fast path

Run from the repository root:

```bash
npm run pair
```

This helper:

- loads `.env` if present, without overriding already-set environment variables;
- starts or restarts the background CodexMobile server via `npm run start:bg`;
- waits for `http://127.0.0.1:<PORT>/api/status`;
- reads the latest pairing code from `.codexmobile/server.out.log`;
- prints local, LAN, Tailscale, and configured public URLs when available.

## If the user needs a fresh build

Use:

```bash
npm run pair -- --build
```

Only use `--build` when assets may be stale or `client/dist/index.html` is missing. For an ordinary reboot, the fast path is enough.

## Response style

Reply in concise Chinese with:

- whether the service is running;
- the pairing code;
- the best phone URL to open;
- the log path if something failed.

Do not expose auth tokens, API keys, `.env` contents, or full private config values.
