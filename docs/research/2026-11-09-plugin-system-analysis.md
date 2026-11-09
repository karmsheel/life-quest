# Plugin system analysis — extensions, agent authoring, and the marketplace question

Research date: 2026-11-09. Sources: this repo at `ac0cadd`, the installed DSH 0.2.1-rc.2 tree
(`/root/.nvm/versions/node/v22.22.0/lib/node_modules/@deepseek-ai/dsh/`), the npm registry, and
public web. Claims are marked **[read]** (verified in this repo's code or docs), **[dsh]** (verified
in the installed DSH tree — not this product's behaviour), **[web]** (external evidence, read but not
independently reproduced), and **[judgment]** (my recommendation, not a fact).

## Verdict

**Yes to an extension system. No to a DSH-style plugin system. Not yet to a marketplace.**

The instinct is right and the timing is not arbitrary: the app already *is* an extension platform —
it just calls its extension points themes, pages, views, automations, review skills, and kits
**[read]**. What is missing is not a runtime but a **package**: one manifest, one install, one
version, one capability list, one way to share, and an agent that can author the package from
natural language. That is the 80% — and it starts with a **ten-day experiment**, not a quarter of
commitment. If the experiment says the format is cheap, the sprint to a usable v1 is 8–12 weeks; the
whole program through agent authoring, slots and a curated index is 16–24 (§8).

What I would *not* build is the thing DSH actually is: a tree in which the UI, the agent loop, and
every service are third-party code loaded into the same privileged process. DSH can do that because
its operator is a developer on a throwaway machine, its plugin distribution is npm, and its failure
mode is a restart. LifeQuest's operator is non-technical, the vault is the most intimate data they
own, and the app holds hard-won guarantees — one privileged window, `script-src 'self'`, asar
integrity fuses, a curated preload, unsigned installer, and, in a packaged build, the GitHub
updater as the *only* code channel **[read]**. A DSH-faithful port would be the largest security
downgrade in the product's history, and it would buy a capability most users would never use
directly.

The one-line reframe:

> **The app's configuration is the API.** Extensions should be versioned, capability-scoped
> *data* the companion can write and the operator can inspect — not code the user installs.

## 1. What "plugin system" is bundling together

The request contains three products with different risks, different buyers, and different timelines.
Keeping them fused is why this conversation usually goes wrong.

| Layer | What the user gets | Unit of extension | Risk | Verdict |
|---|---|---|---|---|
| **A. Customization** | Their workspace looks and behaves the way they think | Themes, pages, views, dashboards, automations, layouts | Low — data | **Build first** (after the spike) |
| **B. Agent extensibility** | The companion can do new things and knows their routines | Skills, prompts, tool grants, MCP servers, kits | Medium — prompt and write authority | **Build first, gated** |
| **C. Code plugins** | New renderers, new widgets, new app behaviours | React/Node code | **High** — runs with vault access | **Defer, 10–16 weeks + threat model** |
| **D. Marketplace** | Third parties distribute and sell extensions | Listings, accounts, payments, review, takedowns | High — operations | **Not now; option preserved by A+B** |

DSH's plugin system is essentially C + D with B inside it. The user need is mostly A + B. That gap
is the whole strategic answer.

## 2. DSH: what it actually is, and what survives the port

### 2.1 The model in one page **[dsh]**

- **Plugin = Cordis 4.0.5 plugin**: a function, class, or `{apply}` with an optional
  Standard-Schema `Config` and `inject` (required services). Each mount is a *fiber* whose services,
  listeners and `ctx.effect()` disposers are torn down in reverse order. `extend()` / `isolate()`
  scope services. (There is no `fork` in Cordis 4.0.5, contrary to older docs.)
- **The app is an empty root plus ordered patch layers.** `cordis.yml` is emptied every boot; the
  tree is composed from each bundle's `dsh.bundle.patch` in profile order, then the profile's
  `cordis.patch.yml`, then a home patch, then `--patch` overlays. Rows are addressed by **stable
  id**; a patch replaces a row's whole `config` (never a deep merge). `!!js` scalars are YAML tags
  evaluated at activation — configuration can execute.
- **Introspection is a feature.** `--dump-config` prints the composed tree with source comments;
  `--dump-config-schema` prints JSON Schema for every plugin's config without mounting. The agent
  can see what it is made of.
- **Install is pnpm in the profile dir** (`dsh plugin --profile <p> add <pkg>`), with manifest +
  lockfile rollback, registry fallback, and build-script approval. **Update = remove + install**, and
  "restart required" is a normal outcome.
- **Version gating is real and enforced**: `engines.dsh` or DSH peer ranges are checked at install
  *and at every composition boundary*; a denied row is disabled, a denied bundle skipped. An
  exact-version exemption can be granted with an explicit risk acknowledgement, and is never
  inherited by an upgrade.
- **HMR** watches the manifest and both patch files, runs one serialised recomposition queue, and
  replaces changed modules. It is what makes "the agent edits its own config live" feel magic. It
  also has sharp edges: a failed replacement leaves the plugin stopped rather than rolling back, and
  an unhandled rejection is process-fatal regardless of which entry threw.
- **UI plugins are slots, not routes.** A package declares `dsh.client`, ships a prebuilt
  `./client` bundle served from `/plugins`, runs in a second Cordis tree in the browser, and fills
  named slots (`plugins.tab`, `sidebar.panellist`, `shell.bottom`, `tool.view.<tool>`, …). Disabling
  a plugin removes its rows and evicts its modules and styles.
- **The agent can operate it**: there are `plugin_manager` (install/remove/toggle/exempt) and
  read-only `plugin_market` model tools, a config editor that validates before writing, and
  `cordis_inspect_*` discovery. Installed host code runs **in-process, outside the workspace
  sandbox**; the docs say to treat a dynamic package "like bash access."

### 2.2 What makes it self-modifiable, and at what price

| Decision | What it buys | What it costs |
|---|---|---|
| Everything is a plugin — UI, agent loop, tools, webserver | One uniform surface; nothing privileged; the agent can extend anything | No protected core; one bad row can break boot; debugging spans 305 packages |
| Config as layered YAML over an empty root | Diffable, dumpable, overridable per profile/home/CLI, live-reloadable | Order is load-bearing; whole-config replacement; typos only warn; `!!js` executes |
| Stable ids | Override or disable one row without copying a bundle | Ids become public API; renames break overlays |
| Declared compatibility + narrow exemptions | Honest skew control for a developer preview | Author must track a fast-moving runtime; the exemption is a loaded gun |
| Hot reload of config and modules | Changes apply live; the agent sees its edits | Failure does not roll back; node-loader internals; repair-level complexity |
| pnpm as the installer | Real ecosystem, registries, lockfiles, local `link:` dev | pnpm is user-visible; build-script approval; native builds |

### 2.3 The marketplace reality check **[dsh]**, **[web]**

Two facts that matter, and both cut against a naive port:

1. **An ecosystem exists, and it is npm-shaped, not store-shaped.** The npm registry currently
   lists **13,747 packages under `keywords:dsh-plugin`** (registry search, 2026-11-09 **[web]**),
   with community market indexes (`dshmarket`, `dsh-plugin-catalog`) and plugins published outside
   the DeepSeek organisation **[web]**; the upstream README promotes a GitHub topic and a Discord.
   That is a genuinely fast ecosystem — because the users are developers who already have npm and
   are comfortable running arbitrary code.
2. **Even DSH's own in-app market is deliberately minimal.** `dsh-plugin-market` reads
   *user-configured* JSON index URLs (`indexes: []` by default — no request until the user adds
   one), validates the index format, annotates compatibility, and installs through the plugin
   manager. It is **unsigned**, has no default source, no upgrade action, and ships as an
   **experimental bundle that is off by default**. Distribution is `package` / git URL / local
   directory — not a hosted store. **[dsh]**

So the marketplace lesson from DSH is not "build a store." It is: **make the format good enough
that a JSON index is all a market needs**, and accept that the trust model is
"the operator chose to run this code."

### 2.4 The trust delta, stated plainly

| | DSH | LifeQuest |
|---|---|---|
| Operator | Developer, terminal available, sessions replayable | Non-technical, life data on disk |
| What a plugin can reach | The machine, by design | The vault: journal, finances, doctrine, health |
| Failure mode | Restart, repair, read logs | Operator has no diagnosis; data may be at stake |
| Distribution | npm/git/local dir | Would have to be a signed bundle or an installer |
| Identity | npm publisher | None — no accounts, no signing, unsigned installer |
| Code channel today | Plugin install is *the* point | In a packaged build, the GitHub updater is the **only** code channel **[read]** |

The asymmetry is not philosophical. It is: **a plugin system that executes code is a second code
channel, and LifeQuest has spent real effort proving it has exactly one.**

### 2.5 The two readings of "model it on DSH"

The request can mean two different things, and they deserve different answers:

**(a) Let the operator's agent reshape the app** — the product reading. This is the one the request
talks about ("users customize their own UX/UI … using their basic built-in agent or potentially
other external agents"). DSH's contribution here is not its plugin format; it is the *loop*: the
agent edits data that composes the app, the change is visible and reversible, and the operator can
inspect what the app is made of. Tier 0 (§5.1) delivers that loop over the app's existing
declarative surfaces, with the vault's authority model intact.

**(b) Let the app modify itself during development** — the developer/agent reading. This is DSH's
actual superpower (everything composable, config-as-data, hot reload, introspection, the agent
editing the harness). It is portable to LifeQuest **internally** and it is worth doing: module
boundaries, per-surface registries, `--dump-config`-style introspection, config-as-data for
settings, and an HMR dev loop for first-party features. What it does *not* require is a public
plugin API or a marketplace — those are distribution decisions layered on top, and they are what
turn the internal pattern into a permanent compatibility promise.

Most of the confusion in this space comes from answering (b) with a public API and answering (a)
with a code runtime. The recommendation separates them: **build (a) as data, build (b) as internal
seams, and let (b) be the thing that makes (a) possible to ship quickly.**

## 3. LifeQuest today: an extension platform the docs deny

### 3.1 Inventory (condensed from the surface map)

| Surface | Mechanism today | Files | Plugin-shaped? | What blocks a plugin |
|---|---|---|---|---|
| Skins | JSON palette + fonts, hex-validated, max 24, dynamic registry | `src/lib/themes/*`, DESIGN.md "Palette-Only Skin" | **Yes** (data-only) | Palette only; no layout/CSS; the operator's choice of an installed skin is discarded on restart (`storage.ts:9-19`, **[read]** — static read, not yet confirmed in the running app) |
| Page blocks | Closed union of 12 kinds in per-vault page JSON; validator + renderer switch | `vault-core/types.ts:1205-1260`, `PageCanvasPage.tsx` | Partial | New kind = three code edits; no dynamic renderer |
| Script blocks | Parsed, never `eval`'d: read-only SELECT + https fetches; 5 queries, 5 fetches, 200 rows, 16 KiB | `vault-core/script-block.ts`, `egress.ts` | Yes (bounded) | Nothing beyond read + public https; agents cannot fetch |
| Automations | Per-vault JSON: prompt, host page, manual/daily/weekly | `vault-core/automation-core.ts`, `state/AutomationScheduler.tsx` | Partial | Host enum is fixed; no agent tool |
| Review skills | `.lifequest/reviews/<cadence>.md`: prompt + `lifequest-snapshot` JSON directives the app executes; agent writes immediately, logged | `vault-core/review-skills.ts`, `review-tools.ts` | **Yes** — the closest thing to a plugin | Prompt-injection surface (documented as AGENT-06, still "Recommended" in the Fort-Knox sweep) |
| Agent tools / MCP | Compile-time `ALL_TOOL_DEFS` (78 tool definitions across 13 modules), if-chain dispatch; two loopback doors, bearer + pairing Decision + fail-closed per-tool grants | `vault-core/index.ts:389-405`, `vault-core/src/pairing-grant.ts:275-316` | Partial | Adding a tool = three coordinated edits |
| Harness adapters | `AgentHarness` interface; registry hardcodes `{hermes, pi}` | `electron/harness/*` | No, by design | Third harness = code; sessions owned per harness |
| Renderer shell | Static imports, static routes, static `NAV_ITEMS`, static settings sections | `App.tsx`, `nav-items.ts`, `settings-views.ts` | **No** | No registry; CSP `script-src 'self'`; needs 8–12 weeks |
| IPC/preload | 184 hand-written typed wrappers, sender-checked facade, compile-time allow-list | `electron/preload.ts`, `main.ts:521-545` | No | A plugin channel needs a new permission model |
| Decisions/provenance | Closed `DocumentTarget` union; per-target apply; `log.jsonl` records operator vs named agent | `vault-core/decisions.ts`, `log.ts` | Partial | A plugin needs a generic target + apply registry |
| Kits | Finance only, hardcoded defs, `kit-install` Decision, `installedKits` registry | `vault-core/finance-kit.ts` | No (no manifest) | Generalising it is the v1 bundle format |
| E2E / release | 209 E2E files, ~73k lines, 101 test wrappers, 81 Electron rigs; packaged build compiles the E2E seam out | `apps/desktop/e2e/`, `tests/`, `electron-builder.yml` | n/a | Each extension surface is a new rig family and a new matrix |

### 3.2 The repo has recorded this boundary, but never as a product decision **[read]**

Two places say something close to "no plugin API", and it is worth being precise about how strong
they are — because the absence of a written VISION or LAWS decision is exactly why the question is
open:

- The 2026-11-05 competitor benchmark records the current state in an inventory row: *"The MCP tool
  surface is the only machine API: no REST/HTTP API, no plugin API … Deliberate: no secondary API
  contract to maintain."* (`docs/research/2026-11-05-lifeos-benchmark/lifequest-features.md:145`).
  This is a description of the capability boundary stamped "deliberate", not a decision record; its
  own evidence pointer is the MCP tool-family section (`docs/wiki/30-system-architecture.md`),
  which describes the tool list rather than forbidding an extension layer.
- The harness seam spec lists as a **non-goal**: *"A general plugin system. There is one seam and
  (at most) two implementations."* (`docs/superpowers/specs/2026-10-21-agent-harness-seam-design.md:39`)
  — a scope fence around one refactor, not a policy about extensibility.

VISION, PRODUCT, LAWS, and the wiki contain no statement either way about plugins or a marketplace
**[read]**. So nothing is being overturned by this analysis; a product decision simply hasn't been
written. I would still treat the boundary as a real constraint, not an accident: it exists because
the app *chose* the MCP surface as its one machine API, and any extension layer has to earn its
place alongside it.

What changes the economics is not "plugins are nice." It is that **the consumer of an extension API
changed**: the companion is now a capable author, and the operator's realistic customization
request is "make me a board for this," not "write me a React widget." A data-only extension layer is
not a second API contract to maintain in the way the benchmark meant — it is the *existing*
contracts (pages, views, prompts, palettes, kits) given one envelope, and it makes the MCP surface
stronger by giving it something worth writing into.

### 3.3 The one live experiment, and what it teaches

Themes are the app's existing plugin story: a validated JSON file, installed from disk, capped at
24, curated in Settings, shared format with Hermes Desktop **[read]**. It proves the whole shape —
data-only, validated, app-local, zero code execution — is already acceptable in the product.

It also carries a warning. The surface map found that `getStoredSkinName()` only accepts builtin
names, so the operator's choice of an installed skin is discarded on restart (`themes/storage.ts:9-19`,
**[read]**, not yet confirmed in the running app). A shipped extension point with a one-line
lifecycle bug is the honest base case for how much care even a trivial extension system needs —
it is a lifecycle surface, and lifecycle surfaces are products. Multiply by a marketplace and the
lifecycle surface becomes a product in its own right.

## 4. Answering the three claims directly

### 4.1 "It will increase customizability" — **yes, but not in the way the question implies**

- **What is genuinely missing today** is not a rendering API. It is *packaging and authoring*:
  a user can make a page, a view, an automation, a theme — and cannot bundle the four into "my
  Health workspace," can't share it, can't install someone else's, and can't ask the companion to
  make one in one step.
- **Declarative extensions cover the request space better than they look.** A "workspace pack" can
  carry: a palette; pages built from existing blocks; dashboard cards from existing view specs;
  automations; review skills and snapshot directives; a kit (database schema + starter pages);
  and a rail entry that opens one of its pages. That is most of what "customize my UX/UI" means in
  practice — a home that thinks the way the operator does.
- **What declarative cannot do** is invent a *renderer*: a kanban board, a calendar view, a custom
  chart type, a new widget. Every one of those needs component code. Be explicit that this is the
  line: **declarative extends composition; code extends rendering.** If the product goal is
  "users invent new UI widgets," that is layer C, and it is a 10–16 week project plus a permanent
  trust and review burden.

Concretely, the requests an operator actually makes, and which tier answers each:

| Operator request | Tier 0 (data) | Needs code (Tier 1) |
|---|---|---|
| "A calmer/darker look" | ✅ palette pack | — |
| "A Health workspace with my own pages and cards" | ✅ workspace pack | — |
| "A weekly review that runs itself" | ✅ automation + skill pack | — |
| "A business-books database like Finance" | ✅ kit pack | — |
| "Show streaks on a board" | ✅ if expressible as a view/metric; ⚠ otherwise | renderer |
| "A kanban board for projects" | ❌ | ✅ new presentation + drag semantics |
| "A calendar view of my database" | ❌ | ✅ new presentation |
| "A new chart type / custom widget" | ❌ | ✅ renderer |
| "A new machine integration" | ✅ via the companion's MCP config, not a bundle | — |
| "My own keyboard shortcut" | ✅ already shipped (Settings → Keyboard) — not a bundle's job | — |

Read the table as the honest scope of the recommendation: **Tier 0 covers the taste, composition,
routine, and data-shape requests — which is where most customization demand lives — and stops
exactly at new rendering.**

### 4.2 "It will speed up iterations" — **yes on the customer side, conditionally on yours**

**Customer side: yes, and the fastest win needs no plugin system at all.** Today the companion can
create views/dashboards directly on an unlocked board, apply script blocks, and file Decisions for
page and document changes **[read]**. What it cannot do is author a *theme*, an *automation*, or a
*packaged workspace* — the surfaces are either agent-tool-less or Decision-gated per item. Closing
that gap ("build me a business-books pack", preview, approve) delivers the emotional core of the
request — *I customized my app by asking* — in weeks, and it is strictly prerequisite to any bundle
marketplace because it produces the artifacts.

**Developer side: a public plugin API is a tax before it is a dividend.** At one maintainer, an
extension API is a compatibility promise you alone must honour: every extension surface × every app
version is test matrix, and this repo's evidence culture (209 E2E files, screenshot artifacts, "a skipped
rig is evidence of nothing") makes each promise expensive. What actually makes *you* faster is
DSH's *internal* pattern, not its public one:

1. **Feature modules as first-party bundles** behind one toggle, so experiments can be deleted
   cleanly instead of rotting in the tree.
2. **Config-as-data for settings** with per-feature schema, so a writer other than you can change
   behaviour without a build.
3. **Stable ids and layered overrides** so a shipped default can be overridden by the vault or the
   operator without forking the feature.
4. **Slots with declarative fillers** so a new rail entry / settings section / dashboard template is
   data, not a new import graph.
5. **`--dump-config`-style introspection** so "what is this app made of" is a screen, not a search.
   (You already do this for the companion: Settings shows the SOUL, per-turn instructions and
   skills. That is the trust affordance a plugin system would need to repeat.)

The honest version of the iteration claim: **internal seams speed *you* up; a public SDK speeds up
the ecosystem after it exists.** Doing them in the other order pays the tax first.

### 4.3 "It opens a pathway to a marketplace" — **the pathway is real; the marketplace is not viable yet**

The evidence is remarkably consistent **[web]**:

- **Obsidian** (closest analogue: free, local files, no account): 4,000+ plugins, 120M downloads,
  **no payments, no store** — and it admits it cannot sandbox plugins, so plugins inherit the app's
  file/network/process access.
- **VS Code**: 64,464 extensions, but 65% stale after a year and a public removal log with 2,497
  packages — 1,227 impersonation, 770 malware, 2,086 of them in 2026 alone. That response function
  is staffed by a company.
- **WordPress**: 74,490 plugins; **11,334 new vulnerabilities in 2025, 91% in plugins, 46% unfixed
  at disclosure.** The host's brand absorbs the damage.
- **Figma** charges 15% and *paused new paid sellers* anyway; **Google killed paid Chrome
  extensions** outright; the **GPT Store** reached ~3M GPTs, filled with spam, and never broadly
  shipped payouts.
- **Claude Code's marketplaces** are literally "a JSON file in a git repo, no submission form" —
  and its docs say plugins can execute arbitrary code with the user's privileges.

Marketplaces are **operations**, not features: payments, tax, refunds, fraud, takedowns,
publisher identity, review capacity, incident response. With no accounts you cannot process a
purchase inside the product without building the account system the product deliberately avoided
**[read]**. And with no telemetry, you cannot measure ecosystem health quantitatively — the only
signals are GitHub release downloads, issues, and what people tell you directly.

The cheap move that *preserves the option* is exactly what DSH does: **a format + a signed bundle +
a curated JSON index**. At that point a "market" is a static file you maintain, with no account, no
payment, and no server. If demand never comes, you have lost nothing but the format (which you
needed anyway for sharing and agent authoring).

**Three triggers, plus one prerequisite.** None of them requires telemetry; each is an observation
you can make from issues, downloads, conversations, and your own calendar:

1. **Supply without you:** ≥3 bundles from authors you did not recruit, still working and updated
   60 days after release, written against the published schema.
2. **Explicit, repeated demand:** the same "is there an extension for X?" arrives from different
   people in issues, chat, or conversation, often enough that you are answering it rather than
   noting it. (Count conversations, not a percentage of a user base you cannot measure.)
3. **Visible support leak:** more than ~2 hours a week on third-party bundle support for four
   consecutive weeks — i.e. the ecosystem is already costing you without a marketplace.
4. **Prerequisite, not a trigger: the installer is code-signed** and bundles have something
   resembling publisher identity. You cannot run a trustworthy marketplace on an unsigned host —
   the security sweep already names code-signing as "the missing anchor" **[read]**. OV/EV
   certificate or Azure Trusted Signing is a recurring cost plus SmartScreen reputation time; it is
   weeks of lead time and an external dependency, not a code change **[judgment]**.

If you want external authors at all, remember that triggers 1–2 need an **authoring path**: a
published schema, an example repository, and "export what I built in the app" as the primary way to
start a bundle. The app's own export is the authoring tool for v1; a human edits exported JSON by
hand or with an agent, and the companion is the fastest path for the rest. Without that, trigger 1
can never fire and the option is decorative.

A better business for a single operator: **sell first-party packs, not marketplace listings.**
The Finance kit is already the precedent — domain kits, premium palettes, curated workspace packs.
Content has no publisher-identity problem, no review queue, no code signing, no refunds on
third-party bugs, and it reinforces the studio's coherence instead of diluting it. Payment can be a
hosted checkout you own (which issues a licence file the app verifies locally); the app never needs
an account or a storefront. That is a different business from a marketplace, and a smaller one — but
it is one a single maintainer can actually run.

## 5. Recommendation: one format, three tiers

Everything in this section is **[judgment]** — a recommendation, not a finding.

### 5.1 Tier 0 — declarative extension bundles (the recommendation)

**Unit:** a directory or `.zip` with `lifequest.extension.json` plus content files.

```jsonc
{
  "id": "health.habits-workspace",          // stable, namespaced
  "name": "Habits workspace",
  "version": "1.2.0",
  "apiVersion": 1,                           // integer, changes rarely
  "appRange": ">=0.3 <0.5",                  // semver against the app
  "author": { "name": "…", "url": "…" },
  "kind": "workspace-pack",                  // workspace-pack | theme-pack | kit | agent-pack
  "capabilities": ["presentation",           // fills slots, no vault data
                   "vault:read:views",       // reads the projection it is given
                   "vault:write:pages",      // through Decisions when governed
                   "agent:skills"],          // contributes prompt material
  "contents": {
    "skins": ["skins/night-owl.json"],
    "pages": ["pages/habits.json"],
    "views": ["views/streak.json"],
    "automations": ["automations/weekly-review.json"],
    "skills": ["skills/habit-coach.md"],
    "kits": ["kits/habits.json"],
    "slots": [{ "slot": "rail.shelf", "icon": "target", "label": "Habits",
                "page": "pages/habits.json" }]
  }
}
```

What v1 may contain, and why each is safe:

| Content | Mechanism already in the app | Gate |
|---|---|---|
| Skins | validated palette JSON **[read]** | none (presentation) |
| Pages | existing block union **[read]** | Decision if agent-installed |
| Views / dashboard cards | existing view spec **[read]** | Decision on a locked board (exists) |
| Automations | existing store + scheduler **[read]** | Decision for new scheduled prompts |
| Review skills / snapshot directives | existing skill file **[read]** | **Decision, always** (prompt-injection surface) |
| Kits (schema + starter pages) | `kit-install` Decision (exists) | Decision |
| Rail/settings/dashboard slots | new, declarative only (icon from an allow-list, target = a page the bundle owns) | none beyond install |
| Agent tool *grants* | connected-agent grant vocabulary **[read]** | grants are per-bundle and revocable |

**Rules that make it safe by construction:**

- **No code.** No JS execution, no `eval`, no HTML. The renderer only draws content through
  existing components. A broken bundle draws an error card; it can never crash boot.
- **Capabilities, not access.** Declared in the manifest, shown in plain language at install, and
  enforced at the same place today's connected-agent grants are enforced (fail-closed by name
  **[read]**). Default deny.
- **Install ≠ trust.** Show author, signature state ("signed by LifeQuest" / "unverified"),
  capabilities, and what it will add. No silent update: mirror the app's own update policy — ask.
- **Provenance.** Bundle-caused writes record `ext:<id>` (or the invoking agent) in the Log, and
  the existing Decisions fence applies to governed surfaces.
- **Portability.** Data-touching bundles live with the vault (`<vault>/.lifequest/extensions/<id>/`)
  so they travel with the vault and a copied vault still opens; presentation-only bundles may live
  in `userData`. An uninstall never silently deletes operator data.
- **Compatibility.** `appRange` is checked at install and at load. An incompatible bundle is
  disabled with a notice, never allowed to break the shell.
- **One schema version, supported for at least two releases.** This is the tax; state it now.
- **Publish the manifest schema openly** (a document or public repo, not just code): it lets
  authors and reviewers read the contract without running the app, and it is the cheapest trust
  move available.

**Effort, honestly.** A ten-day spike proves the format (§8). If it passes, the format +
install/uninstall/export + Settings → Extensions + one dogfood pack + one install/enable/disable rig
family is **8–12 weeks for one developer**. The full program through companion authoring, declarative
slots and a curated index is **~16–24 weeks** — a second product's worth of work, which is exactly
why §8 enters it through a gate rather than committing to it up front. Add 3–5 weeks if bundles must
install governed content through a generalized Decision target rather than reusing `kit-install` and
page applications.

**An alternative unit worth naming.** For machine integrations (a bank export, a local service, a
third-party tool), the natural extension point is already an **MCP server the companion attaches
to**, governed by the existing pairing/grant vocabulary — not a bundle. A bundle should not try to
own that; it can ship the companion's MCP configuration as its content. That keeps the app's one
machine API intact and avoids inventing a second capability language for integrations.

### 5.2 Tier 1 — sandboxed code (defer until triggered)

If demand for *new renderers* is proven, the only defensible shape is a capability-sandboxed
worker: `utilityProcess` (or an isolated webview for UI) with **no Node, no vault filesystem**, a
narrow projection API (read-only rows/views passed in, writes proposed back through Decisions),
manifest-declared capabilities, signing, and a documented threat model including prompt injection
through contributed skills. This is a **10–16 week** second-trust-channel project plus permanent
review work. Do not start it in the same release as Tier 0; the format will change once real
bundles exist, and a sandbox designed before the data model is understood is how Zed-style
capability systems get redesigned twice.

### 5.3 Tier 2 — first-party features, still seams

Keep shipping features the way you already do, but formalise the *internal* plugin shape so Tier 0
has somewhere to stand: a registry per surface (pages, slots, tools, automation hosts), stable ids,
config-as-data, and a debug "what is this app made of" screen. This is where the DSH lesson pays
off for velocity, and it does not require a public API.

### 5.4 Reuse the authority model you already built

Do not invent a permission system. The app already has: connected-agent grants (`read`/`write`,
domain scope, schedule, local/invite doors) **[read]**; fail-closed per-tool grants **[read]**;
Decisions for every governed write **[read]**; locks as operator-only authority **[read]**; and a
Log that names the actor **[read]**. An extension is just another actor with a narrower surface.
That is a differentiator DSH does not have — and it is the reason LifeQuest can offer extensibility
without handing over the vault.

## 6. The agent-authored loop — the actual DSH parallel

This is the part worth stealing from DSH, and it is not the plugin format. DSH feels alive because
the agent can edit *data* that composes the app, see the diff, and have it apply live, with
introspection when something breaks. LifeQuest can have the same loop with **no new trust channel**:

1. Operator: *"Make me a Health workspace — habits, streaks, a weekly review."*
2. Companion drafts a **bundle** under `.lifequest/extensions/_draft/<id>/` (not installed).
3. Preview renders it read-only: pages, slots, automations, capabilities list.
4. Operator approves → files a Decision → install applies atomically, Log records `ext:<id>` and
   the companion names what it added (the existing in-chat naming rule for script blocks and
   capture is the precedent **[read]**).
5. Later: *"Tighten the streaks card"* → the companion edits the bundle, files a Decision, and the
   app repaints. No restart, no install prompt, no code review.

External agents are supported by the same loop because the substrate is the MCP tool surface, not a
UI SDK: any connected agent with a grant can author the same data. Pi and Hermes both benefit; no
harness-specific plugin API is introduced. Prompt/skill content is the one part that must never be
casual: it is instruction injection into the operator's companion, so it is always Decision-gated
and always visible in the Settings screen that already shows what the companion is told **[read]**.

This is also the answer to "users customize their UI without changing the core": the core doesn't
change, the *vault's configuration* does — which VISION already promises ("customization of this
vault, not a hosted LifeQuest app runtime" **[read]**). Two caveats, both real: adding
`.lifequest/extensions/` changes the vault layout, and VISION says the layout is LifeQuest's contract
**[read]**, so Tier 0 needs an explicit one-sentence amendment and a wiki update. And a *code*
runtime would need the clause rewritten, not extended.

## 7. Risks and kill criteria

| Risk | Why it matters here | Mitigation |
|---|---|---|
| **New attack surface on intimate data** | Vault holds health, finances, journal; a bundle that injects instructions or exfiltrates via skill text is a real vector | Tier 0 is data-only; capabilities default-deny; skills always Decision-gated; no remote assets; signature state shown |
| **Support tail** | One maintainer; users will blame the app for a bundle's bug | Curated/allowlist distribution until triggers are met; failure isolation; a documented removal policy and public removal log from day one |
| **Coherence / brand** | PRODUCT.md explicitly refuses "dashboard stuffed with metrics", "generic chatbot wrapper" | Extensions are opt-in, namespaced, token-contract-bound (DESIGN.md), and the default experience stays curated |
| **API stability tax** | Every bundle is a promise; E2E matrix is already 209 files | One integer `apiVersion`, two-release deprecation window, refuse-to-load over best-effort |
| **Test matrix explosion** | Each new surface is a rig family; "a skipped rig is evidence of nothing" | Schema validation + one install/enable/disable rig family, plus one rig per new rendered surface (declarative slots add one) |
| **Platform drift** | A marketplace turns a product into a platform company with different economics | Keep marketplace out of scope until the three triggers fire and the signing prerequisite is met; monetise content, not listings |
| **Unsigned host** | A verifiable bundle publisher means little on an unsigned installer | Code-sign the installer before any third-party distribution |

**The full-DSH condition set.** I am not saying "never" to the DSH architecture; I am saying it is
gated. All five of these would have to be true before Tier 1 code is defensible:

1. A real install base of operators who want *new renderers*, not just new arrangements.
2. A code-signed host and a publisher identity story (accounts or a signing/notary scheme).
3. An automated submission and removal pipeline, or a second maintainer for review.
4. A sandbox designed *before* the API, with a written threat model and escape tests.
5. A business model that funds the operations — because none of the free ecosystems above run a
   marketplace without a team.

None of the five is a code problem, which is why no amount of engineering ambition closes the gap.

**The strongest case against this memo.** It is not the security argument I made above; it is that
**there is no demand evidence in this document.** No user has asked for an extension in an issue,
there is no install base to ask, and the product is 0.2.8. On that reading even Tier 0 is premature,
and the honest move is to write the analysis down, do nothing, and revisit when a real operator
asks. I take that seriously. My answer is not that demand is proven — it is that the *first step is
an experiment, not a commitment*: a ten-day spike with a written gate (§8) buys the information
cheaply, and the format is useful anyway for the companion and for sharing between the operator's
own vaults. If the spike says the format is expensive or the app fights it, stop there and this memo
was worth writing. What I would not accept is skipping the experiment and jumping to a public
promise, or building the code tier because the architecture is intellectually appealing.

**Kill criteria — what would make me say no:**

- If a quarter of dogfooding yields no real operator request that Tier 0 answers better than the
  companion's existing tools, do not productise it; keep the format internal.
- If, after Tier 0 ships, no bundle arrives from an author you did not recruit within six months,
  keep authoring internal and never build a registry.
- If support for third-party bundles exceeds ~2 hours a week for a quarter, stop distributing and
  keep the format for your own packs.
- If most of the requests you actually receive are for new renderers rather than new arrangements,
  the format is right and the tier is wrong — that is the signal to design Tier 1 properly, with a
  threat model, not to bolt code onto Tier 0.
- If a Tier 1 sandbox cannot pass a written threat model (vault confidentiality/integrity, prompt
  injection, network egress, update integrity), do not ship it — a partial sandbox is worse than
  none because it licenses trust it cannot enforce.

## 8. Sequencing

| # | Step | Why first | Shape |
|---|---|---|---|
| 0 | Code-sign the Windows installer | Independent value; prerequisite for any third-party trust | external cost, weeks of lead time |
| 1 | **Ten-day spike: export the Finance kit as a bundle, reinstall it into a fresh vault, render it** | Proves or kills the format before you promise it; cheapest possible evidence | 10 days |
| — | **Gate:** did the spike work, and can you name one real operator request it answers? If no, stop and keep the memo. | Demand is the weak variable; the format is not | decision point |
| 2 | **Bundle format + install/uninstall/export + Settings → Extensions**, one real dogfood pack, install rig | The useful 80%; preserves the marketplace option for free | 8–12 wks |
| 3 | **Companion authoring loop** (draft → preview → Decision → install) | The DSH feeling, no new trust channel; makes the format worth having | +3–4 wks |
| 4 | Declarative slots (rail / settings / dashboard templates) + block presets | Real UI customization without renderer code | +3–5 wks |
| 5 | Curated signed index (JSON in this repo, rendered in-app) | A "market" with no accounts, no server, no payments | +2–3 wks |
| 6 | *Only if triggered:* sandboxed code tier | New renderers, at a permanent trust cost | 10–16 wks + threat model |
| 7 | *Only if the triggers fire and signing is done:* payments/marketplace | A separate business, not a feature | months |

Cumulative: **~16–24 weeks** for steps 2–5, entered only after the spike and the gate. Steps 2–3 are
worth doing even if the marketplace never exists, because they are also the authoring experience for
the built-in agent and the sharing story between operators. That is the test of a good first slice:
**useful even if you stop after it.**

**If you do nothing else from this memo, do the internal retrofit now.** Stable ids, per-surface
registries and config-as-data are worth having whether or not a bundle format ships, and at 0.2.8
with 738 commits behind the tree, the retrofit is cheaper than it will ever be again. The public
promise is optional; the id stability is not.

## 9. Decisions I need from you

1. **Which game are we playing?** "A more customizable studio" (product) and "a plugin platform
   with a marketplace" (business) lead to different first commits. My recommendation is product
   first, option second.
2. **Is Tier 0 allowed to be the whole public story, with code plugins as "never, unless"?** That
   is the only version I can defend against the current security posture.
3. **Do you accept the spike-and-gate process?** Ten days and one written question ("can you name
   a real operator request this answers?") before any multi-week commitment. If not, the rest of
   this memo should wait.
4. **VISION amendment.** Two separate sentences: (a) an extension/pack format as customization of
   this vault, which the existing clause nearly covers; (b) `.lifequest/extensions/` added to the
   vault layout, which is a written contract and needs an explicit line. A code runtime would need
   the clause rewritten, not extended. Which do you want written down?
5. **Naming.** "Extensions" (generic), "Packs" (content), "Kits" (already taken by Finance). My
   preference: **Packs** for bundles, "Extensions" for the Settings section.
6. **Freeze the promise.** Are you willing to support `apiVersion: 1` for at least two releases and
   refuse-to-load on mismatch? That is the API tax, and it should be a written decision.
7. **Distribution posture for v1.** Authoring-only (you + power users), or curated third-party
   bundles from day one? I recommend authoring-only until one real external bundle exists.
8. **Do you want the Tier 0 spec written next?** That is the natural next artifact — a design doc
   in `docs/superpowers/specs/`, no code — or go straight to the ten-day spike, which is arguably
   the better teacher. The spike first, the spec shaped by it, is my recommendation.

## 10. What I did not verify

- The installed-theme-restart defect is a static read of `themes/storage.ts`, not an in-app run.
- Tool count: 78 is a grep of `^    parameters: {` across `packages/vault-core/src/*tools*.ts`,
  `projects.ts` and `map/tools.ts` — if a tool def is indented differently, the count is off by that
  amount. Rig counts are `ls` counts, not a green run.
- Code-signing cost and lead time are external estimates, not quotes; Azure Trusted Signing and
  SmartScreen reputation behaviour should be priced before step 0 is promised.
- Effort arithmetic (8–12 weeks for steps 2; ~16–24 for steps 2–5) is shape, not measured: one
  developer, including rigs, with no comparable prior work in this repo.
- DSH ecosystem size is npm registry metadata; package quality and whether the two community market
  indexes are the only ones is unverified. The 13,747 figure is a registry search, not an audit.
- Ecosystem figures are the sources' own published numbers (Obsidian, VS Code, WordPress, Figma);
  none was independently reproduced.
- Commit count (738) is `git rev-list --count HEAD` at `ac0cadd`; the "cheapest retrofit now" claim
  is **[judgment]**, not a measurement.

## Sources

Repo: `VISION.md`; `PRODUCT.md`; `DESIGN.md`; `LAWS/`; `docs/research/2026-11-05-lifeos-benchmark/lifequest-features.md:145`;
`docs/superpowers/specs/2026-10-21-agent-harness-seam-design.md:39`; `docs/wiki/29-security.md`;
`docs/wiki/30-system-architecture.md`; `docs/wiki/21-pages.md`; `docs/wiki/17-automations.md`;
`packages/vault-core/src/{script-block,egress,review-skills,finance-kit,adapters,connected-agents,pairing-grant}.ts`;
`apps/desktop/src/lib/themes/*`; `apps/desktop/src/components/shell/{nav-items,wing}.ts`;
`apps/desktop/electron/{main,preload,pairing-door,map-tools,updater}.ts`.

DSH: installed `@deepseek-ai/dsh` 0.2.1-rc.2 (`README.md`, `lib/`), its 305 `@deepseek-ai/*`
packages, and `/root/.dsh/profiles/*`; relevant READMEs: `dsh-plugin-manager`, `dsh-plugin-market`,
`dsh-plugin-market-index`, `dsh-client-ui-plugin-market`, `dsh-client-ui-plugin-manager`.

Web: [Obsidian plugin security](https://help.obsidian.md/plugin-security) ·
[Obsidian future of plugins](https://obsidian.md/blog/future-of-plugins/) ·
[Obsidian stats](https://www.obsidianstats.com/posts/2025-12-04-wrapped-2025) ·
[VS Code removal log](https://github.com/microsoft/vsmarketplace/blob/main/RemovedPackages.md) ·
[Wiz VS Code supply chain](https://www.wiz.io/blog/supply-chain-risk-in-vscode-extension-marketplaces) ·
[Figma selling resources](https://help.figma.com/hc/en-us/articles/12067637274519-About-selling-Community-resources) ·
[Shopify revenue share](https://shopify.dev/docs/apps/launch/distribution/revenue-share) ·
[Zed capabilities](https://zed.dev/docs/extensions/capabilities) ·
[Claude Code plugin security](https://code.claude.com/docs/en/plugins/security.md) ·
[MCP tool poisoning](https://invariantlabs.ai/blog/mcp-security-notification-tool-poisoning-attacks) ·
[Patchstack WordPress 2026](https://patchstack.com/whitepaper/state-of-wordpress-security-in-2026/).
