# The cold start does not wait on the companion

**Status:** implemented
**Date:** 2026-10-17
**Touches:** `apps/desktop/electron/companion-profile.ts`,
`apps/desktop/electron/companion-lifecycle.ts`,
`apps/desktop/src/components/shell/splashHold.ts`,
`apps/desktop/src/components/shell/SplashGate.tsx`,
`apps/desktop/e2e/startup-boot.electron.mjs` (new),
`apps/desktop/tests/startup-boot-e2e.test.ts` (new)

## 1. The problem

The app took 57 seconds to show itself. Measured on 2026-10-17 against the real
main process, preload and renderer, with the built renderer served over loopback
and a throwaway vault and profile:

```
window loaded              449 ms
renderer first paint       849 ms   (dashboard mounted at 812 ms)
splash dismissed        57,674 ms
  companion:ensure      56,549 ms   <- the whole thing
```

Everything else on the boot path was already fast, and stayed fast:

| Call | Before |
|---|---|
| `vault:getSnapshot` | 0 ms (no vault open yet) |
| `vault:listRecent` | 22–38 ms |
| `vault:open` | 65–133 ms |
| `companion:profilesList` | 49–98 ms |
| `update:check` | 290–316 ms, in parallel, off the critical path |
| renderer bundle (654 kB) + CSS | painted by 0.4–0.6 s |
| `import dist-electron/main.js` (2.3 MB) | 204–275 ms |

So the app was painted and interactive inside a second and the operator could not
touch it, because the cold-start splash waited on `companion:ensure` — and
`companion:ensure` was restarting a Hermes gateway that was already serving the
profile. Every launch. The child processes it spawned, from the same run:

```
hermes config set gateway.multiplex_profiles true    3,309 ms
hermes config set gateway.api_server.enabled true    3,188 ms
hermes gateway restart                              45,043 ms   (killed at HERMES_TIMEOUT_MS)
hermes gateway start                                 4,484 ms
```

## 2. Why it restarted a healthy host

`writeCompanionMcpProfile` decides whether a running host must be restarted to
see the vault's credential:

```ts
const hadCredential =
  hasCompanionHeader(current, authorization) &&
  (rootYaml === null || hasCompanionHeader(rootYaml, authorization));
```

The root file was being asked a question it can never answer yes to.
`ensureRootCompanionHeader` only fills in the header on a root config that
**already lists** `mcp_servers.lifequest`; a root with no such entry is left
untouched, deliberately. A root config with no `lifequest` entry is the default
shape of every install, so for those machines `hadCredential` was false on every
launch, `credentialChanged` was true on every launch, and `hostMustReRead` sent
`ensureCompanion` down the restart path on every launch — including the launches
where `tryAttach` had just been told the profile was being served.

Measured directly, with the profile config carrying exactly the token the host
needed and a root config shaped like a real install:

```
profile already carries this token: true
credentialChanged: true
```

The credential is now only read out of the root file when the root file actually
carries the entry — one boolean on the decision, and two `hermes config set`
invocations plus a gateway restart per launch disappear.

## 3. Why the splash made it look worse than it was

`splashHold.ts` held the splash while `ensuring`, so the splash's exit had no
upper bound. `ensureCompanion` runs up to four `hermes` commands at 45 s each
(`HERMES_TIMEOUT_MS`) and then polls for health for up to 90 s
(`waitForHealth(prefix, 180, 500)`), so a companion that never came up held the
operator on a logo for minutes with no way out.

The splash now covers the app's own boot — the renderer, the first vault read —
and stops there. The companion's own boot surface is what reports the wait, and
it already existed: `CompanionSetupScreen` renders the same `.welcome` pane with
what it is doing, a Recheck, and the profile picker. On a healthy launch the
companion answers in ~100 ms, well inside the floor, so that surface is never
seen.

**This does not let the studio open without the companion.** The gate is
`status.kind === "ready"` in `AppRoutes`, which the splash never was; the rig's
stalled leg asserts the Dashboard never mounted while the splash was gone
(`attached: false`).

Same world, same rig, one variable — the CLI sleeps 3 s per call and refuses
`gateway`:

| | before | after |
|---|---|---|
| `companion:ensure` | 12,194 ms | 12,173 ms |
| splash dismissed | **12,836 ms** | **2,088 ms** |
| what was on screen under it | `Hermes gateway exited` | `Connecting to your LifeQuest companion…` |

## 4. What was ruled out

- **The renderer bundle.** 654 kB minified, painted at 0.38–0.51 s from process
  start. Code-splitting it would buy a fraction of the splash floor.
- **The main bundle.** 2.3 MB, unminified, 204–275 ms to import. Minifying it is
  a real but small win, and it costs readable stack traces in a shipped build.
- **The vault read.** 65–133 ms on a fresh vault; it grows with the vault, not
  with anything this change touches.
- **The window before its first paint.** `BrowserWindow` is created visible and
  paints the splash ~0.2 s later, so there is a brief frame on the window's
  default background. `show: false` + `ready-to-show` would remove it; that is a
  perceived-jank change, not a time change, and it is not taken here.

## 5. What is left on the table

`SPLASH_FLOOR_MS = 1500`, measured from `__LQ_SPLASH_T0` in the document head.
With the companion no longer on the path, the floor is the largest remaining
term: the app is painted at ~0.4 s and the splash goes at ~2.0 s. Lowering it is
one constant, and it is a brand decision rather than a defect, so it is left as
it is.

Found while measuring, and **not fixed here** because it is not on the boot path:
`checkPinnedModel` is wired as `io.checkModel` with three arguments and takes a
fourth, `fetchImpl`. It is called with `fetchImpl === undefined`, throws inside
its own `try`, and reports `unreachable` — so the "your model was retired"
warning can never fire, and the probe also never costs the 8 s it is budgeted.
Fixing it adds a network round-trip to the ready path and wants its own change.

## 6. The rig

`e2e/startup-boot.electron.mjs` boots the real app against a throwaway world — a
stub `hermes` first on PATH, `HERMES_HOME` inside the world, a companion profile
name no real install has, an in-process fake host gateway on a free port — and
writes `e2e/artifacts/startup-boot-<leg>.json`. It serves the built `dist/`
itself, so it needs `npm run build` rather than `npm run dev`.

`tests/startup-boot-e2e.test.ts` runs three legs and merges them into
`e2e/artifacts/startup-boot.json`:

| Leg | World | What it holds the app to |
|---|---|---|
| `boot` | host serving | painted inside 2 s, splash gone inside 3 s, attached |
| `warm` | the same world again | an ensure asked for after the vault is open spawns **no** `hermes` at all |
| `stalled` | host down, 3 s per CLI call | the splash still stands down on the floor, and what is left is the app's own boot surface |

The `warm` leg asks for the ensure **by hand, once the vault is open**, because
that is the only moment the credential check is guaranteed to have a token to
look at (`openVaultCompanionToken` answers null until a vault is open, and at
mount time the vault is usually still opening). A leg that only watched the
launch could pass by never exercising the check.

It was verified to fail before the fix and pass after: with the old
`hadCredential` restored, the `warm` leg reports four invocations
(`config set` ×2, `gateway restart`, `gateway start`) and exits 1; with the fix
it reports none.
