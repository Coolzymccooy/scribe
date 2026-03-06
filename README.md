## Session TODO (February 26, 2026)

- Reliability Timeline + Smart Retry UX (impact: very high, effort: low-medium)
- Battery-Aware Capture Mode (impact: very high, effort: medium)
- Auto-Deliverables Pack: minutes, decisions, actions, follow-up email (impact: high, effort: medium)
- Action-to-Execution Pipeline: Jira/Asana/Notion/Slack (impact: high, effort: medium)
- Cross-Meeting Semantic Memory + search (impact: very high, effort: high)
- Live Caption Mode with post-call correction (impact: high, effort: high)
- Speaker Intelligence analytics (impact: medium-high, effort: medium-high)
- Multilingual transcription + translation (impact: medium-high, effort: medium)
- AI Meeting Copilot prompts (impact: medium-high, effort: high)
- Enterprise security layer: SSO/RBAC/audit/retention (impact: high enterprise, effort: high)

Top 3 delivery roadmap:
1. Reliability Timeline + Smart Retry UX (2 weeks) - KPI: 10-90 min completion rate >99%; stuck-processing tickets down >70%.
2. Battery-Aware Capture Mode (2-3 weeks) - KPI: mobile battery drain <8-10% per hour on target devices.
3. Auto-Deliverables Pack (3 weeks) - KPI: meeting-to-shareable output under 2 minutes.

## Session Log (February 16, 2026)

- Fixed top-right header overlap by moving account/sign-out controls into the app top bar layout (removed floating auth chip conflict).
- Increased sidebar brand visibility with moderately larger ScribeAI logo and label sizing.
- Tuned header spacing so theme toggle, Studio Live, and account controls no longer collide across viewports.
- Added permanent runtime state hygiene:
  - stopped tracking `server/state.json`
  - added `server/state.example.json` as the tracked template
  - updated `.gitignore` to keep runtime state local-only.
- Merged and pushed stable branch updates to `master` and `dev`.

## Session Log (February 15, 2026)

- Added Firebase authentication integration with Google sign-in plus email/password sign-in, sign-up, and reset-password.
- Added a full auth gate and redesigned login interface.
- Upgraded recording to mix microphone + shared meeting/system audio for two-way meeting capture.
- Added wake lock and visibility handling to reduce sleep/background recording loss.
- Added recording diagnostics panel with live mic/system levels and confidence badges.
- Fixed transcription mime normalization for recorder compatibility.
- Added microphone device picker + persistence so recording uses the intended mic.
- Added auto-save chunk recovery support for interrupted sessions.
- Tightened transcription anti-hallucination guidance to reduce fabricated speaker content.
- Standardized UI toward a machine-grade design system (technical typography, unified shell/panels/controls, compact spacing).

---
<!-- README for the refactored ScribeAI project -->

# ScribeAI – Offline‑First Meeting Assistant

This repository has been refactored into a clear **frontend** and **backend** so that your API key stays safely on the server. The frontend is built with Vite/React and the backend is an Express server that wraps the Google Gemini SDK. When deployed the client talks only to your own API – no Gemini calls leave the server.

## 📁 Project Structure

- `frontend/` – Vite/React app that runs in the browser. Calls the backend via `/api/*` endpoints. Contains the UI (App.tsx), TypeScript types, icons and services. Uses `import.meta.env.VITE_BACKEND_URL` to optionally prefix API calls.
- `server/` – Node/Express server with endpoints:
  - `POST /api/transcribe` – transcribe an audio file
  - `POST /api/analyze` – summarise a meeting transcript
  - `POST /api/ask` – answer questions about a meeting
  - `POST /api/draft-email` – generate a follow‑up email
  - `POST /api/audio-recap` – generate a spoken recap (base64)
  - `POST /api/support` – simple chat for help on IndexedDB/cloud features
- `vercel.json` – rewrite rule for Vercel so that `/api` requests are proxied to your Render backend (replace the placeholder domain).
- `metadata.json` – metadata describing the app for the AI Studio environment (unchanged).

## 🧑‍💻 Local Development

1. **Install dependencies**. There are separate `package.json` files for the server and the client:

   ```bash
   # install server deps
   cd server
   npm install
   # install frontend deps
   cd ../frontend
   npm install
   ```

2. **Set environment variables**:

   - On the backend (`server`):
     - `GEMINI_API_KEY` – your Gemini API key.
     - `CORS_ORIGINS` – comma‑separated list of allowed origins (e.g. `http://localhost:3030,https://your-vercel-site.vercel.app`). When unset, all origins are allowed.
   - On the frontend (`frontend`):
     - `VITE_BACKEND_URL` – optional base URL of your backend (e.g. `http://localhost:3000`). If omitted, relative paths are used and you can rely on a proxy or the Vercel rewrite.

   Create `.env` files in each directory as needed. Vite exposes variables prefixed with `VITE_` to the browser.

3. **Run the backend** on port 3000:

   ```bash
   cd server
   npm start
   ```

4. **Run the frontend** on port 3030 in a separate terminal:

   ```bash
   cd frontend
   npm run dev
   ```

With both servers running you can browse to <http://localhost:3030> to use the app. The client will proxy API calls to <http://localhost:3000> when `VITE_BACKEND_URL` is configured. IndexedDB is still used for local audio storage and the UI is responsive on mobile, tablet and desktop.

## 🚀 Deployment

### Backend on Render

1. Create a new **Web Service** on [Render](https://render.com/) and point it at the `server` folder of this repository.
2. Set the build command to `npm install` and the start command to `node server.js`.
3. In the **Environment** tab add the following environment variables:
   - `GEMINI_API_KEY` – your Gemini API key.
   - `CORS_ORIGINS` – include your Vercel site URL and `http://localhost:3030` for local testing.
4. Note the generated Render domain (e.g. `https://scribeai-backend.onrender.com`).

### Frontend on Vercel

1. Create a new project on [Vercel](https://vercel.com/) and select the `frontend` directory as the root.
2. Add an environment variable `VITE_BACKEND_URL` with the Render domain from the previous step (e.g. `https://scribeai-backend.onrender.com`).
3. Optionally place a copy of `vercel.json` at the project root to use Vercel’s rewrites:

   ```json
   {
     "rewrites": [
       { "source": "/api/(.*)", "destination": "https://scribeai-backend.onrender.com/api/$1" }
     ]
   }
   ```

   When using rewrites you can omit `VITE_BACKEND_URL` and the frontend will call `/api/*` relative to the Vercel domain.
4. Deploy the frontend. Vercel will build the Vite app and serve it globally.

## ✅ Notes

- All Gemini calls are now made from the backend. The client no longer references `@google/genai` directly.
- The UI has been slightly tightened for smaller screen sizes and the oversized boxes/text from the original design have been reduced.
- The code follows Vite conventions: environment variables use the `VITE_` prefix on the client and are typed via `env.d.ts`. Module resolution uses the `@/` alias.

Enjoy your refactored, secure and deployable meeting assistant! If you encounter any issues please check your environment variables and network console for details.
