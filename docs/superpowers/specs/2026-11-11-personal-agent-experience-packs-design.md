# Personal Agent Experience — Packs (Tier 0) — Design Spec

**Date:** 2026-11-11
**Status:** Proposed — awaiting go on Milestone 0
**Product:** LifeQuest — local-first life-management studio
**Depends on:** [Plugin system analysis](../research/2026-11-09-plugin-system-analysis.md), `VISION.md`, `LAWS/COMPANION.md`, the harness seam (`docs/superpowers/specs/2026-10-21-agent-harness-seam-design.md`), review skills (`packages/vault-core/src/review-skills.ts`), automations (`packages/vault-core/src/automation-core.ts`), pages and views (`packages/vault-core/src/pages.ts`, `view-schema.ts`), connected-agent grants (`packages/vault-core/src/pairing-grant.ts`).

---

## 1. Purpose

The product decision is **a more customizable studio**, and its point is **a more customizable, personal agent experience** — not a plugin platform, not a marketplace. This spec defines the first version of that: how the operator shapes their companion and the workspace it works in, without changing the core and without a second code channel.

The user story in one line: *"I want my companion to know how I work — my voice, my routines, my boards — and I want to set that up by talking to it, then see exactly what it was told."*

### 1.1 What "personal agent experience" means here

Five dimensions, each of which v1 must answer with data rather than code:

| Dimension | The operator's question | v1 mechanism |
|---|---|---|
| **Who it is** | "How does my companion talk to me, and what does it care about?" | Operator persona notes + pack guidance, composed per turn and visible in Settings |
| **What it knows** | "Does it know my review habits, my framework, my vocabulary?" | Pack skills composed into review and turn instructions |
| **What it does on a rhythm** | "What should it do weekly, without me asking?" | Pack routines installed as automations (disabled until the operator enables them) |
| **Where it lives** | "Where do I see what it knows and does?" | Pack workspaces: pages, views, pins and a rail entry |
| **What it can reach** | "What tools does it have?" | **Out of v1** — see §2.3. Existing MCP/connected-agent grants remain the only tool surface |

### 1.2 Success criteria

- The operator can write a persona note and immediately see it in **Settings → Companion → What your companion is told**, fenced, labelled, and removable per line of provenance.
- The operator can install a pack from a file, see its capabilities in plain language before confirming, and see its page/pin/rail entry appear; disabling it removes its guidance immediately and leaves operator data intact.
- The companion can draft a pack from one sentence in chat, preview it, file a **Decision**, and after approval the workspace and guidance exist — the chat names what changed, in the same voice as the existing script-block and capture naming rule.
- A malformed, oversized, code-bearing, or incompatible pack is refused with a field-named reason; it cannot crash the shell, and it cannot load if `appRange` does not match.
- Copying a vault folder to a fresh profile reopens it with its packs, persona, pages and routines intact — no secret state in `userData` for data-touching packs.
- **E2E artifact:** one report JSON and one screenshot per rig family, showing the installed pack's workspace and the composed-instructions panel on the shipped UI.

### 1.3 Non-goals

- No arbitrary code, no HTML, no `eval`, no remote assets. A pack is data.
- No marketplace, no accounts, no payments, no hosted index in v1.
- No new companion authority: a pack cannot grant tools, approve Decisions, unlock anything, or change its own grants.
- No second vault layout beyond the two paths in §3.4, and no schema migration.
- No multi-persona roster (advisors/domain owners as packs) in v1.
- No MCP-server installation in v1 (see §2.3).

---

## 2. Product decisions locked by this spec

1. **Product first.** The goal is a more personal studio. Anything that only pays off at marketplace scale is deferred.
2. **Data only.** The extension unit is a versioned, capability-declared bundle of data; the app never executes pack content.
3. **The companion is both author and subject.** The same pack format that carries a workspace also carries persona, skills and routines, and the companion can write drafts of it.
4. **The gate stands.** A ten-day spike (§6) must pass before the v1 slices begin. A failed spike ends the work, not the memo.
5. **Vault-scoped.** Persona, packs and their content live in the vault, because "vault is identity". The harness *selection* remains app-level, as today.
6. **No silent anything.** Guidance from a pack is Decision-gated on install; scheduled routines start disabled; updates never overwrite content the operator has edited.

### 2.1 Why the spike is not optional

The riskiest assumption in this spec is not "can we validate JSON". It is:

- that app-built per-turn instructions can carry a persona layer *correctly and visibly* for **both** harnesses (the field exists on both; composition and precedence are unproven), and
- that a pack's workspace can be instantiated into a vault as ordinary pages/automations **without** the pack becoming a runtime dependency.

Both are cheap to test and expensive to discover late. The spike tests exactly those two, plus one real pack end-to-end.

### 2.2 Explicitly out of scope, and why

| Out | Why |
|---|---|
| Code plugins / renderers | Second trust channel; incompatible with the current CSP/asar/updater posture (analysis §2.4, §5.2) |
| Marketplace / index | An operations business; the format preserves the option (analysis §4.3) |
| Pack-supplied MCP servers | That *does* expand the companion's reach. It needs its own disclosure UX and threat model; v1.1 at the earliest |
| Editing Hermes SOUL | The companion owns its profile. The app composes instructions; it does not rewrite another product's file |
| Pack-supplied images/fonts | Remote assets and file types are attacker bytes; v1 keeps packs text and JSON only |
| New page block kinds | Renderer code; a later, separately-gated tier |
| Packs that install kits / data schemas | The Finance kit's capture hooks are code, so a generic kit is its own project (§3.7) |

### 2.3 The integration boundary

A pack may **document** an integration (a markdown page saying "connect your bank via X"), but it may not configure one. The sanctioned path for machine integrations stays what it is today: an MCP server the companion attaches to, with the existing pairing/grant vocabulary. This keeps one machine API and avoids a second capability language.

---

## 3. Architecture

### 3.1 The layer model

Three layers compose, in this order, with provenance attached to each:

```
app core (code, unchanged)
  └─ operator layer (vault, always wins on conflict)
       └─ installed packs (vault, each independently disable-able)
```

- **App core** contributes the standing instructions, rules, tool surface, and the page/board a pack may extend. It is never edited by a pack.
- **Operator layer** is the operator's own persona note and their edits to instantiated content.
- **Pack layer** is guidance, routines and workspace content a pack adds. It is reviewed at install and visible in Settings thereafter.

Conflict rule, stated once: *operator text wins over pack text; pack text wins over app default prose; app code and rules win over everything.* A pack cannot override a Law, a lock, or a Decision.

### 3.2 The persona layer (new)

A per-vault markdown file, `.lifequest/companion/persona.md`, operator-owned and directly editable:

- Read at the moment a turn is assembled, not cached; a change applies to the next turn.
- Composed into the per-turn instructions as a fenced, labelled block: *"The operator has approved the following companion guidance for this vault"* with the pack id (if pack-supplied) and the note that it is data, not a system instruction.
- **Budgeted:** operator notes ≤ 2,000 characters; each pack's guidance ≤ 1,500; total composed guidance ≤ 4,000 (the page-context budget is the precedent for a hard cap, `page-context.ts`). Over-budget installs trim the pack, never the operator.
- **Visible:** the existing Settings → Companion panel that shows the SOUL, per-turn instructions and skills becomes the single truth for this layer. Each contribution appears with provenance and a switch.
- **Bounded:** guidance may shape tone, vocabulary, priorities and review framing. It may not contain governance claims ("approve decisions"), and the fence says so to the model. Text cannot grant a capability — capabilities are enforced in code, not prompts.

The harness-specific rule: the app does not write `SOUL.md` for Hermes and does not rewrite Pi settings. It appends the composed guidance to the `instructions` it already sends every turn. **Verified in the current tree:** both harnesses already take `ChatTurnRequest.instructionsContext` (`electron/harness/types.ts:71`; `pi-harness.ts:578-588`; `hermes-harness.ts:33`), so this is composition into an existing field, not a payload change. The spike still proves that the composed text is correct and visible for both; if one harness cannot carry it, v1 ships one and says so — no silent degradation.

### 3.3 Pack manifest (v1, draft)

```jsonc
{
  "apiVersion": 1,
  "id": "karm.health-coach",            // stable, reverse-dns-ish, [a-z0-9.-], ≤ 64 chars
  "name": "Health coach",
  "version": "0.1.0",                   // semver
  "appRange": ">=0.3.0 <0.5.0",         // semver range against the app version
  "author": { "name": "…", "url": "…" },
  "kind": "agent",                      // discovery label only: agent | workspace | theme
  "description": "≤ 280 chars",
  "capabilities": ["guidance", "routines", "workspace"],
  "contents": {
    "guidance": ["guidance/persona.md", "guidance/skills/habit-coach.md"],
    "routines": ["routines/weekly-review.json"],      // automation records, verbatim shape
    "pages":    ["pages/habits.json"],                // page records, verbatim shape
    "views":    ["views/streak.json"],                // view specs, verbatim shape
    "skins":    ["skins/night.json"],                 // Forge skin JSON, same validator as today
    "placements": ["placements.json"]                 // rail entry + pins (§3.8)
  },
  "files": { "…": "sha256:…" }          // content hashes, checked on install
}
```

`kits` is deliberately absent: see §3.7. `apiVersion` 1 is the only version; a pack declaring anything else is refused.

Rules: unknown top-level keys are refused (unlike tool schemas, a pack has no reason to carry strays); every referenced file must exist and hash-match; total pack ≤ 512 KiB, ≤ 64 files; no file may be executable, binary, HTML, SVG, or an archive; text files are UTF-8 JSON/Markdown only. A pack is **one directory** with `pack.json` at the root, or **one `.pack.json` file** whose contents are inline. Zip is deliberately deferred: it would add an archive parser to the attack surface for no v1 benefit.

### 3.4 Vault layout

```
<vault>/.lifequest/
  companion/persona.md                 operator's persona note (new)
  extensions/
    registry.json                      installed packs: id, version, enabled, source, signature state
    <pack-id>/                         installed pack root (content lives here)
      pack.json
      guidance/ routines/ pages/ views/ skins/
    _drafts/<pack-id>/                 companion drafts, inert, no registry entry
```

`registry.json` is the single source of truth for "what is installed". App-level `userData` holds nothing about packs; a vault copy that opens elsewhere still has its packs.

### 3.5 Lifecycle

```
draft ──preview──▶ Decision ──approve──▶ install ──▶ enabled
                                              │
                         disable ◀────────────┤ (guidance off now, routines paused, content stays)
                                              │
                         update (new version, never overwrites operator edits)
                                              │
                         uninstall (guidance removed; content left, attributed)
```

- **Install** validates, copies, writes the registry, then applies content: guidance composes immediately; routines are created **disabled**; pages/views are instantiated with new ids; skins use the existing skin validator and install path. One log line per applied item, with `extension: <pack-id>` in the payload and the installer as actor.
- **Disable** removes the pack's guidance from the composed prompt on the next turn and pauses its routines. It does not delete pages or data — data is never hostage to a pack.
- **Uninstall** is operator-only, asks for confirmation, removes the pack directory and registry entry, and leaves instantiated content with an attribution note. It never deletes rows or pages.
- **Update** is install of a new version: guidance and skills update live; instantiated pages are never overwritten; new items may be added by explicit consent in the preview. No silent updates — the app asks, as its own updater does.

### 3.6 Authority and capabilities

A pack declares what it **does**, not what it **may access** (it has no access beyond what its content becomes). The install screen renders the list in plain language:

| Capability | Plain language | Gate |
|---|---|---|
| `guidance` | "Adds guidance the companion is told on every turn" | Decision on install; visible in Settings; switchable |
| `routines` | "Adds scheduled or one-click routines (created paused)" | Decision on install; operator enables each one |
| `workspace` | "Adds pages, views, and a rail entry" | Decision if it lands on a locked board; otherwise install |
| `presentation` | "Adds a theme you can wear" | none beyond install |

Reused authority: connected-agent grants, fail-closed tool grants, locked-surface Decisions, operator-only locks, and the Log actor. No new permission system is invented.

### 3.7 Kits are out of v1, on purpose

The research memo's Tier 0 included `data` (a pack carrying a kit). This spec defers it. The Finance kit is not a JSON blob: its capture hooks are code (`capture.ts` checks `installedKits` before offering Finance capture), and its starter pages and database defs are portions of `finance-kit.ts`. Making kits generic means moving capture hooks behind a declarative spec — a project of its own (~3–5 weeks), with its own rig work, and not needed for a *personal agent experience*.

So v1 packs carry guidance, routines, workspace and presentation. A pack may **document** a kit in a markdown page; it may not install one. The manifest's `contents` is designed so `kits` can be added in a later `apiVersion`, and the finance `kit-install` Decision stays exactly as it is today.

### 3.8 Placements (visible presence without a renderer)

v1 placements are deliberately two, both declarative:

- `rail`: `{ label ≤ 24, icon: <allow-list id>, pageId }` — renders in the rail's bottom shelf with the pack's pages; hidden when the pack is disabled.
- `pins`: `[{ scope: "overview" | <domainSlug>, pageId }]` — uses the existing pin path, so a locked board files a Decision.

No settings-section slots and no arbitrary nav in v1: the shell's nav is static (`nav-items.ts`), and a rail entry is enough to make a pack feel present.

### 3.9 The companion's authoring tools

New tool family, registered like every other (`ALL_TOOL_DEFS`):

| Tool | Actor | Behaviour |
|---|---|---|
| `list_packs` | any | Installed + drafts, capabilities, enabled state |
| `get_pack` | any | Manifest and content, read-only |
| `write_pack_draft` | companion | Creates/updates `_drafts/<id>/` only; validates; inert; logged. Caps mirror §3.3 |
| `preview_pack` | any | Dry-run validation + "what this would create" summary; no writes |
| `install_pack` | companion | Files a Decision whose body carries the draft's manifest summary, capabilities and diff; approval installs |
| `enable_pack` / `disable_pack` / `uninstall_pack` | **operator only** | Not exposed to any agent — an agent must not be able to remove its own guidance |

The draft path is what makes the authoring loop safe: writing a draft changes nothing the app reads, so it needs no Decision; everything the app reads needs one.

---

## 4. The experience

### 4.1 Settings → Companion → Personal

A new section beside the existing "What your companion is told":

- **Your notes.** A markdown field for the operator persona (char count against the 2,000 budget).
- **From your packs.** One row per pack contribution: pack name, version, a one-line summary of what it says, the switch, and *View* which opens the composed text.
- **What it is told, composed.** The existing read-only panel, now showing the composed guidance in order with provenance, so "why did it say that" has an answer.
- **Tone preview.** A short composed preview (first ~400 chars) so the operator sees the effect without installing.

### 4.2 Install flow

1. Operator picks a pack directory or a `.pack.json` file (or the companion drafts one).
2. Preview: name, author, version, `appRange`, signature state (*signed by LifeQuest* / *unverified*), capabilities in plain language, and a list of items it will create or add.
3. Confirm: the app validates hashes, writes the pack, then applies — guidance live, routines paused, pages created, placements rendered.
4. Afterwards: the pack's chat line names what changed (the capture/script-block naming rule), and the Log records it.

### 4.3 What the operator can always undo

- Disable the pack: guidance gone next turn, routines paused, pages stay.
- Remove one contribution: per-row switch.
- Edit instantiated content: it is ordinary vault data.
- Delete a pack draft: it was never active.

---

## 5. Security and trust

| Threat | Why it matters | Mitigation in v1 |
|---|---|---|
| **Instruction injection via guidance** | A pack's text reaches the model on every turn | Decision-gated install; treated as operator-approved; fenced and labelled; visible in Settings; length-capped; cannot claim authority; AGENT-06 shows why this is the sensitive surface |
| **Exfiltration via pack content** | Pages/skills could talk the companion into sending data out | Egress stays where it is (`egress.ts`); packs cannot add fetches or scripts; a workspace pack creates ordinary content under existing rules |
| **Malicious archive / oversized pack** | Attacker bytes | One directory or single JSON file (no archive parser), root `pack.json`, size/file caps, hashes, no binaries/HTML/SVG, no nesting |
| **Spoofed provenance** | "Signed" must mean something | v1 shows *signed by LifeQuest* only for packs signed by the maintainer key; everything else says *unverified*; no claim beyond that. Code-signing the installer is a prerequisite for third-party distribution, not for v1 |
| **Prompt-budget DoS** | A pack could crowd out page context | Hard 4,000-char composed cap; pack guidance trimmed first |
| **Pack update drift** | Silent changes to what the companion believes | No silent updates; instantiated content never overwritten; guidance diffs shown on update |
| **Vault portability break** | Packs must travel | Everything data-touching in `.lifequest/extensions/`; `userData` only holds app preferences |

**Explicitly accepted for v1:** guidance text is trusted once the operator approves it. This is the same trust the operator already places in the companion's own SOUL, and it is why install shows a diff and why Settings shows the composed result. It is *not* safe against a pack that social-engineers the operator at install time — no UI can be.

---

## 6. Milestone 0 — the ten-day spike

**Goal:** prove the two risky assumptions and produce one real agent pack, or kill the spec cheaply.

Work in a `feat/extension-packs-spike` worktree (never the bench), E2E through `lifequest-e2e`, one report artifact.

| Day | Work | Exit |
|---|---|---|
| 1–2 | Pack manifest + validator + a developer-only round-trip: export a real theme, page and automation as a pack, reinstall it into a throwaway vault | Round-trips with zero lost fields; invalid fixtures refused with named errors |
| 3–5 | Persona layer: `.lifequest/companion/persona.md`, composition into per-turn instructions, Settings → Companion → Personal, composed-instructions panel | Both paths verified (embedded and Hermes instruction assembly), or one proven and the other explicitly excused |
| 6–8 | One real agent pack: "Health coach" — persona, 2 routines, 1 page, 1 skill, 1 pin; draft via `write_pack_draft`, Decision, install | In a throwaway profile: approving the Decision creates the page/pin/routines; the chat names it; Settings shows the guidance |
| 9–10 | Rig family + artifact + report | `extensions-spike.json` + `.png`; files touched and rig minutes recorded |

**Gate questions (answered in the report, in writing):**

1. Did a pack deliver a *noticeably* more personal companion in one install, or did it just add a page?
2. Is the composed guidance correct and visible for both harnesses through the existing instructions field?
3. Did the theme/page/automation round-trip lose anything, and is the format small enough to explain in one screen?
4. Can you name **one real operator request** this answers (the operator's own counts)?
5. What did it cost — files touched, rig minutes, surprises?

**Kill signals:** shaping guidance requires a harness-specific rewrite; instantiated pages collide with operator content in a way that needs a migration; the spike takes more than ten days; the artifact cannot be produced without a lot of new test scaffolding.

**If the gate passes:** v1 slices S1–S3 (~12–16 weeks for one developer incl. rigs) are the point where the product is useful; S4 adds workspace instantiation and visible presence (+2–3) and S5 is docs, so the full v1 is **~15–20 weeks**. The estimate is reviewed against the spike's findings before S1 starts. **If it fails:** stop, keep the research, and the studio stays as it is.

---

## 7. Slices after the gate

| # | Slice | Contents | Rig family |
|---|---|---|---|
| S1 | Pack core | Manifest, validator, registry, install/uninstall/disable for guidance and presentation, Settings → Extensions, file picker | install, refusal, portability |
| S2 | Personal layer | persona.md, guidance + skills composition, Settings → Companion → Personal, composed view | composition, cap, provenance |
| S3 | Companion authoring | `list/get/write_draft/preview/install_pack`, Decision body, chat naming | draft → Decision → install, no-agent-uninstall |
| S4 | Presence | placements (rail + pins), workspace instantiation, export (the authoring path) | rail entry, locked-board Decision |
| S5 | Docs + VISION | Amendment, wiki pages, vault layout doc, operator guide | docs only |

**One new Decision target, not the generic refactor.** `install_pack` needs a `pack-install` member in the Decision union with an apply callback — the same concrete pattern as `kit-install` (`packages/vault-core/src/decisions.ts:108`, `:1384`), not the generalized target registry the research memo priced at 3–5 weeks. One concrete target is ~1–2 weeks and is included in S3. Likewise the automation `packId` is an optional field on a file that has no `schemaVersion` (unknown keys are dropped by `coerceRecord`), so it needs no migration.

---

## 8. VISION and docs amendments to approve

Proposed sentences, exact:

**VISION.md — after the pages/script paragraph:**

> A vault may carry packs: versioned, data-only bundles of guidance, routines, presentation and content that the operator installs, and that the companion may draft. A pack is customization of this vault; it is not a program the app runs. A pack may shape what the companion is told and what it does on a schedule, but it must not grant the companion authority, change a lock, or approve a Decision.

**VISION.md — vault layout line:** add `.lifequest/extensions/` and `.lifequest/companion/persona.md` to the enumerated layout contract.

**PRODUCT.md — Purpose:** add one line to the purpose paragraph: *"It is also the studio where the operator's companion becomes personal: its voice, its routines and its boards are theirs to shape."*

**Wiki:** `04-the-vault.md` (layout), `24-companion.md` (personal layer), `17-automations.md` (pack routines), `28-settings.md` (Extensions + Personal), plus a new `35-packs.md` operator page.

---

## 9. Open questions

Defaults I will take unless you object, so nothing blocks the spike:

1. **Persona scope — default: per vault.** It travels with the vault; "personal" resets when the operator opens another vault, which is arguably correct since a vault is a life, not a login.
2. **Naming — default: "Packs" in product copy and the Settings heading.** "Extensions" appears only in the design docs. One word is easier to explain and search.
3. **Guidance for external harness — default: app-built instructions only.** No SOUL write, no copy button in v1; the composed panel is the truth, and a "copy to SOUL" affordance can come after the spike if it earns its keep.
4. **Routines default — default: paused until the operator enables each.** A scheduled prompt the operator did not read is the one thing a personal experience must never do silently.

---

## 10. Files this touches (predicted)

`packages/vault-core/src/`: `extensions.ts` (new: manifest, validator, registry), `extension-apply.ts` (new: instantiate routines/pages/views), `companion-instructions.ts` or the existing assembly point, `automation-core.ts` (optional `packId` on records), `review-skills.ts` (compose pack skills), `paths.ts` (two new paths), tool modules (`extensions-tools.ts` new, registered in `index.ts`), Decisions (`install-pack` body + apply).

`apps/desktop/`: `electron/preload.ts` + `electron/main.ts` (extension IPC family), `src/pages/SettingsPage.tsx` and `components/settings/*` (Extensions + Personal), `src/state/*` (extensions provider), `e2e/extensions-*.{tsx,html,mjs}` + `tests/extensions-*-e2e.test.ts`.

No renderer plugin runtime, no CSP change, no asar change, no updater change.
