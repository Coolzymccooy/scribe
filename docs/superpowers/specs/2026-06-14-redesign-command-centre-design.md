# ScribeAI — Industry-Standard Redesign + Command Centre (Design Sketch)

**Date:** 2026-06-14
**Status:** 📋 Planned — workstream 2. Not started.
**Depends on:** nothing (can start now). **Unblocks:** the entire feature roadmap.

## Goal

Move the UI from the heavy "neural/machine" theme (uppercase `font-black`, custom display
fonts, oversized gothic headings, violet-everything) to an **industry-standard, premium,
spacious** look — "Linear + Notion + Superhuman" — using clean **sans** typography. Keep
the dark, premium identity; reduce decoration in operational screens (cards, transcripts,
action boards, dashboards). Keep character for branding moments (landing, logo).

## Scope

1. **Design system pass**
   - Typography: one clean sans family (e.g. Inter / Geist) for all operational text;
     reserve the display font for landing/branding only. Normal case, sane weights/tracking.
   - Spacing, radius, elevation tokens; consistent card/control components.
   - Color: keep dark base + a restrained accent; reduce blanket violet + pulsing badges.
   - Accessibility: contrast, focus states, readable transcript text.

2. **`App.tsx` decomposition** (prerequisite for the whole roadmap)
   - Split the ~5,000-line component into feature modules: `recorder/`, `workspace/`,
     `meeting-details/`, `team/`, `settings/`, `command-centre/`, shared `components/`.
     Keep services as-is. No behaviour change — pure structural refactor, done first.

3. **Command Centre (new nav section)**
   - Home dashboard surfacing: today's meetings, pending actions, overdue follow-ups,
     recent decisions, people waiting on you, suggested emails, meetings needing review.
   - For this first pass it can read from existing data (recordings, extracted
     `actionItems`/`decisions`); richer cards land with the Tier-1 features.

## Non-goals (for this workstream)

- No new AI features (Action Board logic, Company Brain, agent) — those are the roadmap.
- No data-model changes beyond what reliability (workstream 1) already added.

## Approach

- Refactor `App.tsx` **before** restyling, so the redesign lands on clean modules.
- Introduce the design tokens/components, then migrate screens one at a time
  (Workspace → Live Studio → Details → Command Centre → the rest).
- Verify with `tsc --noEmit` + `vite build` at each step; no functional regressions.

## Open questions (resolve at pickup)

- Exact sans family + accent palette (needs a visual pass / mockups).
- Whether Command Centre replaces or sits alongside the current Workspace landing.
- Retention policy for cloud audio (carried over from reliability follow-ups).
