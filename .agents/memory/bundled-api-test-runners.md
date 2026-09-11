---
name: Bundled API test runners
description: Node worker behavior to remember when testing bundled API servers locally
---

When testing a bundled Node API that starts worker-based logging, launch it with a normal `node -e` script and dynamic import rather than `--input-type=module`.

**Why:** Node passes `--input-type=module` to worker threads, where Node 24 rejects it for file-based worker entry points before the application can start.

**How to apply:** Keep the application unchanged; use `node -e '... import("./dist/index.mjs")'` for isolated delivery-path checks.