# VS Code Debugging

This repo includes VS Code launch configurations in `.vscode/launch.json`.

## Prerequisites

- Install dependencies with `npm install` if `node_modules` is missing.

## Debug Next.js

Use **Run and Debug -> Next.js: Debug Server**.

This starts:

```bash
node --inspect ./node_modules/next/dist/bin/next dev -p 3000
```

The app runs at `http://localhost:3000`. Breakpoints should bind in server code such as:

- `app/api/**/route.ts`
- server components
- shared server-side modules under `lib/`

The launch config also opens a Chrome debugging session when the dev server is ready. For client-only React breakpoints, use **Next.js: Debug Browser** after the dev server is running.

If you use Google sign-in locally, add this exact redirect URI to the Google OAuth web client:

```text
http://localhost:3000/api/auth/callback/google
```

## Debug Jest

Open a test file, set a breakpoint, then run **Jest: Debug Current File**.

The config runs Jest with `--inspect-brk`, `--runTestsByPath`, and `--runInBand`, which keeps execution in a single process so breakpoints are predictable.
