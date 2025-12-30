# Deploying to Netlify

This guide explains how to deploy the Next.js app and its API routes to Netlify, and how to handle any Python backend services.

Prerequisites
- A Netlify account with repository access (GitHub/GitLab/Bitbucket).
- Node 18+ locally for builds.
- The repo connected to Netlify.

Recommended approach
- Use the official Netlify Next.js plugin to support App Router/API routes: `@netlify/plugin-nextjs`.

1) Add Netlify config
- Create a `netlify.toml` in the repo root (example provided in this repo).

2) Install the plugin (locally / CI)
```bash
npm install -D @netlify/plugin-nextjs
# or
yarn add -D @netlify/plugin-nextjs
```

3) Netlify build settings
- Build command: `npm run build` (or `yarn build`)
- Publish directory: the plugin writes to `.netlify/next` — `netlify.toml` below sets that.
- Set the Node version in Netlify if needed via the UI or with `engines` in `package.json`.

4) Environment variables (secrets)
Set these in the Netlify dashboard under Site settings → Build & deploy → Environment → Environment variables.
- `OPENAI_API_KEY` (server-only) — used by ephemeral API route.
- `ELEVENLABS_API_KEY` (server-only) — used by TTS and STT token routes.
- `ELEVENLABS_VOICE_ID` (server-only / optional) — voice id used by TTS route.
- `NEXT_PUBLIC_LOG_LEVEL` (public / optional) — controls client logging level.

Notes about public vs private envs
- Any variable starting with `NEXT_PUBLIC_` will be exposed to client-side code. Do not prefix server-only secrets with `NEXT_PUBLIC_`.

5) Backend API notes
- The App Router API routes under `src/app/api/*` will be deployed by the Netlify Next plugin as serverless functions.
- If you have Python backends in the `python/` folder (for example `python/ai.py` or `python/audio.py`) they must be deployed separately — recommended providers: Render, Railway, Fly, or a VPS. Deploy the Python service and set an env var (for example `PY_BACKEND_URL`) that the Next app can call.

6) Example testing after deploy
Use `curl` or Postman to test endpoints once the site is published. Example:
```bash
curl -i https://<your-site>.netlify.app/api/ephemeral
curl -i https://<your-site>.netlify.app/api/tts
```

7) Troubleshooting
- Build failures: check Netlify build logs — missing env vars are a common cause.
- Increase function timeout: Serverless functions have limits; if an API call needs more time, consider moving it to an external service.

Files added
- `netlify.toml` (root) — contains recommended plugin config and publish directory.

If you'd like, I can: add CI scripts, or prepare a minimal service wrapper for the Python backend.
