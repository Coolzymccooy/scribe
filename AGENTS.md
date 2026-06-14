# Agent Guide — ScribeAI

**Before starting any work, read the active roadmap / to-do list:**

➡️ **[`docs/roadmap/meeting-intelligence-roadmap.md`](docs/roadmap/meeting-intelligence-roadmap.md)**

It contains the prioritized backlog, effort/risk tiering, and the recommended
build sequence for the "meeting intelligence OS" direction.

## Key facts

- **Hard prerequisite before adding features:** decompose `frontend/src/App.tsx`
  (~5,000 lines) into feature modules. Do this first or every feature gets worse.
- Design specs: [`docs/superpowers/specs/`](docs/superpowers/specs/).
  - ✅ `2026-06-14-recording-reliability-design.md` — shipped (cloud-first audio, cross-device retry).
  - ⏭️ `2026-06-14-redesign-command-centre-design.md` — next workstream (sans redesign + Command Centre).

## Architecture (quick map)

- `frontend/` — Vite/React app. Firestore is the durable source of truth for
  recordings (`users/{uid}/meetings`); audio in Firebase Storage; IndexedDB local cache.
- `server/` — stateless Express worker wrapping Google Gemini. Jobs persist to a
  `/data` volume and re-enqueue on restart. No DB yet (needed for the Company Brain feature).

## Build / verify

```bash
cd frontend && npm install && npx tsc --noEmit && npm run build && npm test
cd server && node --check server.js
```
