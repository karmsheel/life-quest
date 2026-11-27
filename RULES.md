# Rules: how to work in this repo

Last verified: 2026-11-27 · LifeQuest 0.3.4

**MUST** / **MUST NOT** are RFC 2119 when capitalized. These rules bind humans and agents
writing code, docs or tests here. Three other documents hold adjacent rules, and this one does
not restate them:

- Product invariants (observable behavior): [`LAWS/`](LAWS/README.md)
- Visual and token rules: [`DESIGN.md`](DESIGN.md)
- Shared UI primitives and their local conventions:
  [`apps/desktop/src/components/ui/AGENTS.md`](apps/desktop/src/components/ui/AGENTS.md)

## 0. Before you write anything

1. Read [`PRD.md`](PRD.md), [`ARCHITECTURE.md`](ARCHITECTURE.md), [`DESIGN.md`](DESIGN.md) and
   this file, then [`TASKS.md`](TASKS.md) for what is current and [`PROGRESS.md`](PROGRESS.md)
   for what broke.
2. Run `./bin/agent-cli status` — it reports the checkout, branch, dirty state, bench, E2E lock
   and the last commit, faster than reading around.
3. If the change is user-visible, the [`LAWS/`](LAWS/README.md) file it touches and its wiki
   page are part of the change, not a follow-up.

## 1. Workflow

- **A task gets its own worktree and branch.** Branch as `<type>/<slug>` — `feat/`, `fix/`,
  `docs/`, `chore/`, `audit/`. Do all edits there; never work on `master` in the primary
  checkout.
- **Commit like the log does.** `type(scope): lowercase imperative sentence` for work
  (`feat(chat): …`, `fix(review): …`, `docs(specs): …`, `test(review): …`); merges read
  `merge: <feature in one sentence>`. No issue numbers in the subject.
- **E2E is the testing mechanism.** Every feature change runs its rig against *this* checkout
  through `/root/.local/bin/lifequest-e2e <worktree>`, and the run leaves a report artifact.
  A skipped rig is evidence of nothing.
- **Restart what you changed, and verify against the restarted process.** A rebuilt main
  process, preload or IPC channel does not take effect until the app is relaunched; alerting the
  operator is not doing it. Restart only what the change needs.
- **One bench.** Never start a second `npm run dev` or bind 5173 by hand: Vite runs
  `strictPort`, and the companion's MCP doors are single-instance. Use `lifequest-dev` to move
  the bench, and put the primary checkout back when done.
- **Do not merge or push until the operator says the branch is good.** Then merge `--no-ff` in
  the primary checkout and push. Hand over in the `READY FOR TESTING` shape from
  [`AGENTS.md`](AGENTS.md) and then stop.
- **A user-visible change updates its wiki page in the same branch.** `npm run docs:check` is
  the gate; a release refuses to build over a stale wiki.

## 2. Code conventions

The repo has no linter or formatter; these are the conventions the code already follows.

- **TypeScript, `strict: true`, everywhere.** Do not weaken a tsconfig or add `// @ts-ignore`
  to get past a type.
- **Formatting:** 2-space indent, double quotes, semicolons, trailing commas in multi-line
  literals, one import per line.
- **Imports:** `import type` for type-only imports; `@/…` for `apps/desktop/src`, relative
  paths for siblings. `packages/vault-core` runs as plain Node ESM and writes explicit `.ts`
  extensions; renderer imports are extensionless. Order: node built-ins, packages, `@/`,
  relative.
- **Exports:** named exports for components and helpers (`export function ViewCard`); route
  pages in `src/pages/` are default exports.
- **Names:** `PascalCase.tsx` for components, `camelCase.ts` for helpers, `kebab-case.ts` for
  state/persistence modules. Feature code lives under `src/components/<feature>/`.
- **Never reach around the bridge.** The renderer has no Node access; privileged work goes
  through `window.lifequest` / `LifequestApi`.
- **IPC returns a result, it does not throw across the wire.** Use
  `{ ok: true; value } | { ok: false; error }`; a handler turns an exception into
  `{ ok: false, error }`.
- **All vault writes go through `electron/vault-service.ts`** and its serialized queue, and
  file logic lives in `packages/vault-core` (paths in `paths.ts`, writes through
  `atomic-write.ts`).
- **Profile state is not vault state.** Active vault, themes, model settings and chat
  transcripts live in app `userData`; the vault holds only the prescribed layout.
- **Styles:** no new raw hex / `rgb()` / `hsl()`; use the semantic tokens. The values live in
  `tokens.css` and the skin palettes, and `global.css` still carries a handful of legacy
  hard-coded colours — do not add to them. Per-feature CSS file, BEM-style class names
  (`block__element--modifier`). Read [`DESIGN.md`](DESIGN.md) before inventing a primitive.
- **Use the shared primitives** in `src/components/ui/` (`Button`, `Toggle`, `SettingsRow`,
  `SettingsSection`, `ViewCard`, `ListRow`, `PageMenu`, `SegmentedControl`, `ConfirmDialog`)
  instead of new markup.
- **New dependency: ask first.** A runtime dependency enlarges the asar and the update surface;
  say why, and prefer what is already there (Node built-ins, `lucide-react`, `node:sqlite`).
- **No unit test written after the code.** E2E is the mechanism. If a system must be tested in
  isolation, write down all the ways it can fail first, then write the test, then the code.

## 3. Never do

Product-level (also laws, listed here because agents break them most often):

- Never edit a locked document in place, and never lock or unlock one as an agent; an agent
  change to a locked document is a pending Decision.
- Never write the vault from the renderer, from a script, or around the service queue.
- Never put a raw API key, calendar token or sheet token in the vault or the renderer; secrets
  live in OS secure storage.
- Never post a money transaction when the amount or account is missing; the chat names what was
  logged, and the phone never posts without companion confirmation.
- Never raise `SCHEMA_VERSION` without an explicit decision and a migration story; a higher
  vault schema is refused today.
- Never add a hosted copy of the vault, an account, or telemetry of vault content.

Working-level:

- Never start a second dev server or bind 5173; never move the bench without being asked.
- Never merge, push, tag or publish a release without the operator's word.
- Never rename a route, rail label, wing label or Settings tab without updating
  `docs/wiki/` — the docs check fails otherwise.
- Never ship over a red `npm run typecheck` or `npm run docs:check`, or without the packaged
  smoke test for a release.
- Never commit `.scratch/`, `e2e/artifacts/`, `dist/`, `dist-electron/`, `release/`, a vault,
  or a secret.
- Never claim a feature works without an artifact that shows the shipped screen.
- Never break the visual contract: the "Do not do" list in [`DESIGN.md`](DESIGN.md) is the one
  copy of what the look forbids.

## 4. Enforcement

| Gate | Command | When |
|---|---|---|
| Types | `npm run typecheck` | Before handover and before release |
| Docs drift | `npm run docs:check` | Same branch as the change; CI on every PR and weekly |
| Feature proof | `lifequest-e2e <worktree>` — report + picture | Before handover |
| Packaged build | `node apps/desktop/e2e/packaged-smoke.mjs` after `npm run release` | Before any release |
| Live update feed | `node apps/desktop/e2e/update-live-feed.mjs` | Before cutting a release, and after publishing |

A red gate is a stop, not a warning. If a gate cannot run on this machine, say which and why in
the handover — "it should pass" is not evidence.

A red report is only superseded by a newer run of its own rig. Record it, say which change it
predates, and re-run; do not explain it away.
