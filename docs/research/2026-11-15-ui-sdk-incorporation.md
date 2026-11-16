# UI SDK (vercel-labs/ui) — how it fits LifeQuest's design and agent-authoring principles

**Date:** 2026-11-15
**Status:** Analysis + recommendation. Companion to
[UI malleability and theme scope](../research/2026-11-15-ui-malleability-theme-scope.md).
**Subject:** [`vercel-labs/ui`](https://github.com/vercel-labs/ui) — "UI SDK", `@ui-sdk/core` + adapters.

---

## 0. What the library actually is

| Fact | Value |
|---|---|
| Shape | A **behaviors** library, not a component library. Keyboard, focus, selection, dismissal, popups, drag and drop, and their ARIA, as small composable functions. |
| Layers | **Behaviors** (`createRovingFocus`, `createFocusRecovery`, `createPopup`, `createSelection`, …) → **primitives** (`definePrimitive`: state + api + slots) → **adapters** (`createParts` for React/Vue/Svelte/Solid/Web Components). |
| Agent surface (authoring) | A skill (`npx skills add vercel-labs/ui --skill ui-sdk`), versioned `llms.txt`/`docs/` shipped inside each package, a testing kit (`@ui-sdk/core/testing`) that checks WAI-ARIA behavior, RTL and server rendering. |
| Agent surface (operating) | A runtime **agent bridge** (`createAgent`): `snapshot()` lists components with labels, exposed state and actions; `act({steps})` calls component APIs; `query()` finds components and choices. Permissions via an `allow` callback, `data-agent-confirm` marks, redaction, `source: "agent"` on changes. `agentTools` gives the tool definitions for your own agent loop; `registerTools` registers them with WebMCP where the browser supports it. |
| Version / license | `0.1.0-beta.5`, **beta**, Apache-2.0, **zero runtime dependencies**, React peer `>=19`. Created 2026-10-26; 4.7k stars, 110 open issues at the time of writing. |
| Stated principles | No runtime deps; works pre-hydration; one shape everywhere; small predictable APIs "so a model writes them correctly in few tokens"; parts change element via `render`, not `as`. |

Source: repo `README.md`, `AGENTS.md`, `packages/core/package.json`, `packages/react/package.json`, and
the published docs at `ui-sdk.dev` (`/docs/agents/llms.txt`). **[web]**

**What it is not:** a plugin runtime, a way to run untrusted UI code safely, or a data format. Adopting it
changes how *we* build the shell; it does not change what a pack may execute.

---

## 1. The two agent modes, and which one each belongs to

The library is built around two agent modes. LifeQuest needs exactly this split, because the app has two
very different trust domains:

| Mode | What it means | Fits LifeQuest where |
|---|---|---|
| **Agent builds UI** (code, build time) | An agent writes primitives/components with tested behaviors, checked by the testing kit, reviewed by a human. | **The developer loop.** Our Pi companion drafts new first-party shell components/widgets as source in the repo; a developer reviews and merges. This is the "agent as contributor" path, not a runtime channel. |
| **Agent operates UI** (bridge, runtime) | An agent reads component state and calls actions through structured tools with permissions. | **A narrow, gated surface** — the theme/authoring studio, where the agent needs to try things and see state. Not general app navigation. |

The third mode — **agent ships UI as data** (themes, widgets, packs) — is LifeQuest's own model, and UI SDK
does not do it. The right relationship is: UI SDK is the toolkit for the *build-time* mode; its
**primitive anatomy** is the design reference for the *data format*; the shipped mode stays declarative.

This is the principle to write down: **the companion may author UI in two levels — data at runtime, code at
build time — and only the data level ships.**

---

## 2. Four ways to incorporate it, ranked by fit

### 2.1 Internal behaviors for relocatable shell components — **adopt now (highest fit)**

This is the direct answer to the R2 problem in the theme ladder: a wing switcher or domain switcher that
must render in the titlebar, in the rail, as a floating pill or icon-only needs the *same* keyboard, focus,
selection and dismissal behavior in every placement. That is precisely UI SDK's layer.

Concretely:

- `WingTabs` becomes a `segmented-control`-shaped primitive: state `{ active }`, api `{ select }`, slots
  `root` / `option`, attrs `role=tablist` / `aria-selected`, behaviors roving focus + typeahead.
- `DomainSwitcher` becomes a selection primitive with async state (`pending`, `error`) and roving focus;
  the lens comes from the vault, so the primitive stays presentation-free.
- Placement is a container decision (`chrome.domainSwitcher.place`), not a component variant: the same
  primitive renders in `.window-titlebar__lens`, a below-header bar, a bottom bar, or a floating pill,
  with placement CSS only.
- The primitives live behind one seam, `apps/desktop/src/lib/ui/primitives.ts`, so the dependency can be
  pinned, upgraded or dropped without touching feature code.

Trust impact: **none.** It is bundled, reviewed app code with no dynamic loading. The CSP, preload and
updater are untouched.

Effort: **2–3 weeks** for the two components plus rigs. This is the cheapest way to de-risk the R2 spike,
because "does it still work when it moves?" stops being a hand-rolled question.

### 2.2 Primitive anatomy as the contract for declarative widgets — **adopt as a design reference (R4)**

UI SDK's primitive model is a good schema for the vocabulary packs will compose from, without making packs
code:

```
state   → the handful of values a widget owns (active, value, open, selected…)
api     → the named actions a widget accepts (select, setValue, toggle…)
parts   → the named regions a theme/pack can style or place (root, label, option, value…)
attrs   → the accessibility contract the host guarantees (role, aria-*)
agent   → which state keys and actions are exposed to an agent
```

That anatomy is already the right thing to teach an authoring agent: it is small, uniform, and it maps to
what a theme/widget JSON needs (a widget instance names a type, a state, and the parts it fills). It also
gives us a vocabulary **registry** — one JSON schema per widget type — that the companion can read
version-matched, the same way UI SDK ships `docs/` inside the package.

Do **not** copy the code-shape literally into pack data. A pack writes *instances and content*, not
`slots()` functions; the host implements behaviors per widget type once.

### 2.3 The agent bridge for the theme studio — **selective, later**

`createAgent` is the most interesting borrowed capability: the companion could read the live UI
(`snapshot`) and act on it (`act`) with an `allow` policy and `data-agent-confirm` for sensitive steps.
For LifeQuest that is powerful and dangerous in equal measure:

- The app already has **one** authority path (MCP tools + Decisions + Log). A UI bridge is a second path
  to the same effects, with weaker provenance unless carefully mapped.
- Snapshot results carry page text (`untrustedContentHint: true` in their own annotations) — a
  prompt-injection channel straight into the companion.
- `act` can press buttons; if an "Approve" button is reachable, the bridge can approve a Decision.

Recommendation: use it **only for the theme/widget studio**, where the actions are presentation-only and
reversible (set a token, try a placement, keep/revert), and never for Decisions, vault writes, locks, or
install flows. If we ever expose it more broadly, the bridge's `allow` callback must route through the same
Decision logic as the MCP surface — not a parallel permission system.

Electron note: `registerTools` is a no-op where `document.modelContext` is absent. Do not build on WebMCP;
use `agentTools` definitions with our own tool loop if this mode is built at all.

### 2.4 As the runtime for packs — **no**

Packs stay data. Shipping UI SDK components inside a pack would require executing third-party code, which
is the R5 tier with its sandbox, signing and review conditions — the same conclusions as the
[2026-11-09 analysis](../research/2026-11-09-plugin-system-analysis.md) §5.2 and §7. UI SDK being
"agent-friendly" does not change that.

---

## 3. Design principles worth adopting from the library

These are cheap, survive even if we never depend on the package, and improve our authoring story:

1. **Behavior separate from presentation.** A component is state + api + parts, rendered by an adapter.
   That is what makes placement-independent chrome possible; a component that hardcodes its container can
   never be theme-controlled.
2. **One shape everywhere.** Same part names, state keys and action names across placements and widgets.
   Predictability is what keeps an agent's error rate (and token count) down.
3. **Explicitly exposed state and actions.** The agent only sees what the host declares (`controlled`,
   `agent.actions`); secrets are redacted; risky steps carry `confirm`. We can mirror this exactly in the
   widget schema and in our own tool surface.
4. **Small, documented, versioned APIs for agents.** Ship the vocabulary docs *with the version* — inside
   the app/repo, readable by the companion — instead of relying on the model's memory. (UI SDK does this
   with `docs/llms.txt` and `skills/` inside the package.)
5. **Check behavior, not just looks.** Their testing kit asserts WAI-ARIA patterns, RTL and SSR. For us
   that maps to a per-placement rig: focus order, arrow keys, escape/dismissal, aria-selected — asserted
   by the E2E rig, since the repo's rule is E2E-first.
6. **Zero runtime dependencies and a pinned version.** Beta software with no transitive deps is the
   cheapest kind to trial; pin exactly and keep the seam.

---

## 4. What the R2 spike becomes with this

The [5–7 day spike](../research/2026-11-15-ui-malleability-theme-scope.md#6-spike-before-phase-1-57-days-smaller-than-the-pack-spike)
gains one task and one gate question:

- **Day 2 change:** re-express `WingTabs` and `DomainSwitcher` as UI SDK primitives rendered through
  `createParts`, then render each from the `chrome` layout config in the four placements. Keep the
  existing CSS tokens; the library supplies behavior, not looks.
- **New gate question:** did behavior survive relocation — focus recovery, arrow keys, typeahead,
  escape/dismissal, `aria-selected`, chat-dock interaction — in every placement, checked by the rig?
- **New kill signal:** if adopting the primitive shape regresses keyboard/aria in a way the rig catches,
  fall back to one hand-rolled primitive per component; the theme ladder does not depend on the library.

Rig the two components once; if the seam holds, Phase 1 uses it for tabs, menus, popovers and the
segmented controls that themes will move or restyle — **but not wholesale**. The app has its own design
system (`ui-segmented`, buttons, dialogs); running two systems of focus management is worse than running
one hand-rolled one. Adopt only where relocation/composition is the requirement.

---

## 5. Risks and stop conditions

| Risk | Mitigation |
|---|---|
| **Beta API churn** (0.1.0-beta.5, created two weeks ago) | Pin exact version; one seam module; no public API of ours mirrors theirs. |
| **Design-system duplication** | Limit to relocatable/composable surfaces; keep our tokens and primitives elsewhere. |
| **React peer `>=19` and `@types/react >=19.2.10`** | Compatible with our `^19.2.x` tree at install time; verify lockfile resolves; typecheck in the spike. |
| **Two focus systems fighting** | The seam owns behavior; remove the old roving-focus code as each component migrates, never both. |
| **Agent bridge authority leakage** | Only the theme studio; `allow` routes through Decisions; never expose Decisions/locks/install via `act`. |
| **Untrusted page text in snapshots** | Treat snapshot text as data (as the library's own tool annotations do); the companion's prompt already fences page context. |
| **Bundle cost** | Zero runtime deps helps; measure in the spike and record it in the artifact. |

**Stop condition:** if the two-component migration costs more than ~3 weeks or the rig cannot prove
behavior parity across placements, do not adopt further — keep the theme ladder, drop the dependency.

---

## 6. Recommendation

1. **Adopt `@ui-sdk/core` + `@ui-sdk/react` internally for R2's relocatable chrome** (two components,
   one seam, pinned beta). This is the highest-value, lowest-risk incorporation: it solves a real R2
   risk and teaches us the primitive model.
2. **Use its primitive anatomy as the schema reference for the R4 widget vocabulary**, and ship a
   version-matched authoring skill/docs to the companion — copy the *pattern*, not the dependency.
3. **Hold the agent bridge for the theme studio only**, behind the existing authority model, and only
   after R2 ships.
4. **Never ship it to packs.** Packs stay declarative.

In one line: **UI SDK is how our shell becomes placement-independent and how our agent gets better at
authoring components at build time; it is not how third-party UI runs at runtime.**
