# ScribeAI — Meeting Intelligence Roadmap (Backlog / To-Do)

**Date:** 2026-06-14
**Status:** 📋 Backlog — not started. Pick up later.
**Context:** Product direction — move from "meeting recorder/transcriber" to a
**meeting intelligence OS**: Record → Understand → Summarise → Assign → Chase → Prepare.

> Engineering review of the proposed 10-feature list. Tiered by *real cost in this
> codebase*, not by how exciting the feature sounds. Sequencing matters more than the
> list — see the bottom.

## Hard prerequisite (do before any feature below)

- [ ] **Decompose `App.tsx` (~5,000 lines)** into feature modules (recorder, workspace,
      details, team, settings, services). Every feature added on top of the monolith
      gets slower and buggier. This is the frame everything hangs on.

## Tier 1 — High ROI, data already exists (cheap)

The backend already returns structured `executiveSummary / actionItems / decisions /
openQuestions`, and Firestore is now the durable source of truth (workstream 1).

- [ ] **#2 Action Tracker / Board** — actions are *already extracted*; add
      `owner`/`due`/`status` fields + a board view. **Strongest single ROI.**
- [ ] **#9 Evidence / Audit trail** — transcript segments already carry `startTime`;
      have the model cite segment ids so every action/decision links to a quote+timestamp.
- [ ] **#8 Role-based summary modes** — prompt variants over the existing transcript
      (Exec / Dev / QA / Sales / Legal / Client / Ministry). A dropdown, not a system.
- [ ] **#3 Smart follow-up email** — `generateEmailDraft` exists; add tone presets +
      send targets (Gmail/Outlook/Slack/Teams/copy).
- [ ] **#6 Meeting Health Score** — one extra analysis pass + a dashboard card. Nice,
      not a moat.

## Tier 2 — Genuine moats, real infra (phase it)

- [ ] **#1 AI Meeting Memory / "Company Brain"** — cross-meeting search + Q&A. Needs an
      embeddings + vector store (pgvector / Pinecone) and a retrieval pipeline; server is
      currently stateless with no DB. **Strongest moat + biggest lift.**
- [ ] **#7 Auto Meeting Prep Pack** — falls out almost for free *once #1 exists*
      (last meeting summary, open actions, suggested agenda). Blocked on #1 + deeper calendar.
- [ ] **#5 Speaker Intelligence Profiles** — a view over the #1 memory layer. Depends on
      reliable diarization (Gemini is inconsistent); build *after* #1 or it feels wrong.

## Tier 3 — Highest risk / defer

- [ ] **#10 Autonomous Follow-up Agent** — the headline feature *and* highest risk (acts
      on the user's behalf: reminders, emails, tasks). Needs a scheduler, job store, and
      OAuth write-scopes. Do **last**, after the Action Board makes the data trustworthy.
- [ ] **#4 Real-time Meeting Copilot** — **cut for now.** Live streaming + low-latency
      prompting is a different architecture from the stop-then-process model; existing Web
      Speech captions are already flaky. High effort, demo-friendly, low retention vs #1/#2.

## New navigation surface

- [ ] **"Command Centre"** section: today's meetings, pending actions, overdue follow-ups,
      recent decisions, people waiting on you, suggested emails, meetings needing review.
      Best delivered as part of the redesign (workstream 2), not bolted onto the current theme.

## Recommended sequence

1. **Redesign + Command Centre shell** (workstream 2) — clean typography (sans, less
   gothic), and decompose `App.tsx` while in there. See
   `docs/superpowers/specs/2026-06-14-redesign-command-centre-design.md`.
2. **Tier 1 batch** — Action Board (#2) + Evidence (#9) + Role summaries (#8) +
   Follow-up tones (#3). ~80% reuses data already produced. Makes it feel like a product.
3. **Company Brain (#1)** — the vector-store investment. Unlocks #7 and #5 cheaply.
4. **Autonomous Agent (#10)** — last, on trustworthy actions + integrations.

## Verdict

The proposal is ~70% right. Changes from the original list: **cut #4**, **reorder #5/#7
to ride on #1**, and **do not start any feature until `App.tsx` is decomposed**.
