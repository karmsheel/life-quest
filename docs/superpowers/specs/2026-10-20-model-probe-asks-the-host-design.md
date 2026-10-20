# The model probe asks the host, and answers after the boot

**Status:** implemented
**Date:** 2026-10-20
**Touches:** `apps/desktop/electron/companion-profile.ts`,
`apps/desktop/electron/companion-lifecycle.ts`,
`apps/desktop/electron/companion.ts`,
`apps/desktop/electron/main.ts`,
`apps/desktop/electron/preload.ts`,
`apps/desktop/src/vite-env.d.ts`,
`apps/desktop/src/state/CompanionProvider.tsx`,
`apps/desktop/e2e/model-probe.electron.mjs` (new),
`apps/desktop/tests/model-probe-e2e.test.ts` (new)

## 1. The problem

The "your companion's model was retired" warning could never fire. Two defects,
one hiding the other.

**It was never given a way to make a request.** `checkPinnedModel` takes a fourth
argument, `fetchImpl`, and was wired as `io.checkModel`, whose signature takes
three:

```ts
checkModel?: (configYaml: string, modelsUrl: string | null, apiKey: string) => Promise<ModelCheck>;
// companion.ts
checkModel: checkPinnedModel,
```

So `fetchImpl` was `undefined`, `fetchImpl(url, …)` threw, and the throw landed in
the function's own `catch` — recorded as `unreachable`, which is the verdict that
means "say nothing". `tsc` had been reporting it the entire time
(`electron/companion.ts:431: Target signature provides too few arguments`).

**It asked the wrong party, with the wrong key.** The URL came from the profile's
`model.base_url` with `/models` appended, and the bearer was `apiKey` — which in
`ensureCompanion` is `API_SERVER_KEY`, the credential this app mints for the
*host's* loopback API server. It is not the provider's key, and no part of this
app holds one: provider credentials live with the host, which is where every chat
goes. Against a provider that ignores auth (the Nous inference API answers 200
with any key) it would have worked by accident; against one that checks, it would
have answered 401 and gone quiet. Either way it put a local credential on the
wire towards a third party, which a credential for `127.0.0.1` must never be.

## 2. What it asks now

`GET /api/model/options` — the host's own inventory for this profile, authorized
with the key this app actually holds. It is the same payload the composer's model
menu is built from (`modelCatalogFromPayload`), so the list a retirement is judged
against is exactly the list the operator can pick from.

The verdict is a pure function over that catalog, in `companion-lifecycle.ts`:

| Catalog says | Verdict | Warning |
|---|---|---|
| pinned provider present, authenticated, and the id is in its models | `ok` | none |
| pinned provider present, authenticated, and the id is **not** in its models | `retired` | names the model |
| no catalog, or the pinned provider absent / unauthenticated / listing nothing | `unknown` | none |

The last row is the one that matters most: an empty or missing list is not
evidence that a model died, and a wrong warning would tell the operator to
replace a model that works.

## 3. It answers after the boot, by design

The round-trip is not free: 579 ms measured against a real profile with 52
providers. So the probe is started *after* the ready status is published, never
awaited, and its result is published as a status update.

That means the status can now change after it was first reported, so it is
pushed to the renderer on `companion:statusChanged` (preload:
`onCompanionStatusChanged`, subscribed by `CompanionProvider`). Without that the
renderer would keep the first answer forever — and a late verdict would be
discarded even once the probe worked.

Measured on the rig, with the fake catalog held for 3 s:

| | probe awaited | probe after the boot |
|---|---|---|
| first ready status carries a warning | no | no |
| warning pushed | 3.45 s after ready | 3.38 s after ready |
| **the app's own screen is up** | **3,223 ms after the window loaded** | **193 ms** |

The second column is the point: the push is early in both, because `publish()`
runs before the await — but `AppRoutes` gates the studio on `ensuring`, which is
the ensure's *promise*. An ensure that stops to ask about the model holds the
operator on "Connecting to your LifeQuest companion…" for the whole round-trip,
which is the 57-second splash of 2026-10-17 with a shorter delay. The rig
therefore measures the screen, not the push.

## 4. Delivery details

- `companion.ts` keeps the probe: `companionModelOptions()` (the host client),
  `modelVerdict`, `modelWarningFor`, and `publish`. It is guarded so two probes
  never stack, and a probe requested while one is in flight is queued — a profile
  switch replaces the status ~100 ms in, long before the old probe's round-trip
  finishes, and the new profile must still be asked about.
- A probe whose status is no longer `current` when it lands is dropped: it was
  about a host the app is no longer talking to.
- `main.ts` forwards each status change to every open window
  (`companion:statusChanged`), armed before the first window exists, beside the
  existing `vault:dataChanged` broadcast.
- Removed with the old probe: `checkPinnedModel`, `modelsUrlFromConfig`,
  `pinnedModel` and the `ModelCheck` type in `companion-profile.ts`, and the
  `checkModel` seam on `CompanionIo`. Nothing else used them, and keeping a
  second, unused way to ask about a model is how the first one stayed broken.

## 5. The rig

`e2e/model-probe.electron.mjs` boots the real app against a throwaway world — a
stub `hermes` first on PATH, `HERMES_HOME` inside the world, a probe-only profile
name, and an in-process fake host that counts its `/api/model/options` requests
and holds each answer for a configurable delay. It deliberately opens on
Welcome, with **no vault**, so the chat composer never mounts: the composer asks
for the same catalog for its model menu, and with it open "the probe ran" would
stop being an assertion.

Three legs, merged into `e2e/artifacts/model-probe.json`:

| Leg | Catalog | Held to |
|---|---|---|
| `retired` | pinned id absent from an authenticated provider | warning pushed, names the model, arrives after the ready status, and the final status carries it |
| `live` | pinned id listed | no warning ever, exactly one catalog request |
| `unknown` | pinned provider unauthenticated | no warning ever — silence is not a verdict |

Every leg also fails if the app's own screen appears more than 1.5 s after the
window loaded, with the catalog held for 3 s.

Falsified in both directions, not assumed:

- **Probe never runs** (the `void probePinnedModel(status)` call replaced by
  `void 0`): the `retired` leg fails five checks — no catalog request, no
  warning, no gap to measure — and exits 1.
- **Probe awaited on the boot path** (`void` → `await`): the warning still
  arrives on time, and the leg fails on the one check that matters —
  "the app's own screen was up without waiting for the catalog: 3,223 ms after
  the window loaded, with the catalog held 3,000 ms". That is the regression the
  first version of this rig missed: it watched the pushes, and the push had
  already happened before the await.
