# Walrus integration report

Research date: 2026-10-19. Sources: the Walrus-track problem statement, `docs.wal.app`, `docs.sui.io` (Seal), and the npm registry. Claims are marked **[docs]**, **[derived]** (arithmetic from a doc-stated formula), or **[not stated]**.

## Verdict

Walrus is worth integrating into LifeQuest in three places. It is worth refusing in two others.

What it actually buys:

1. **Durability the operator owns.** The vault stops being one disk. A snapshot survives the laptop.
2. **Third-party verifiability.** A blob ID is a content hash. Anyone can prove the vault said what it said on a date, without trusting LifeQuest or any host.
3. **Portability across apps and agents.** A blob is readable by any client, forever, with no account. This is the property that makes agent memory outlive the agent.

What it does not buy, and this matters because the framing that prompted this report assumed otherwise:

- **It is not a database.** Walrus is immutable content-addressed object storage in a flat namespace. No query engine, no transactions, no partial update, no folders **[docs]**. The domain `domain.sqlite` remains the database. Walrus is the substrate it is copied to.
- **It is not private.** Every blob is public and discoverable; blob IDs are not secrets; there is no native encryption **[docs]**. Walrus provides availability and integrity, never confidentiality. Client-side encryption is mandatory for anything from this vault.
- **It is not free and not inert.** Storage is paid in a market-priced token, and every blob expires. An unmetered, unrenewed backup is a lie with a two-year fuse.

The correct one-line reframe: **Walrus makes the vault durable, portable, and provable — not confidential, and not queryable.** Confidentiality is a separate layer (client-side encryption, and Seal if you want the key management handled), and it does not exist in this repo yet.

## 1. What the track asks for

The Walrus track problem statement is an AI-agent-memory track, not a storage track. It asks for agents that (a) store and retrieve memory across sessions, (b) share context across agents and workflows, and (c) access data that is portable, persistent, and not locked into a single platform — with explicit interest in long-running stateful workflows, multi-agent coordination, artifact-driven workflows, and framework/tooling integration.

LifeQuest already is a long-running stateful system with multi-agent coordination. Its gap against the track is exactly the one the track names: **the companion's memory dies with the companion.**

| Track ask | LifeQuest today |
|---|---|
| Memory across sessions | Hermes owns memory and transcripts (`VISION.md`). Nothing in the vault survives a Hermes reset. |
| Context shared across agents | Advisors and domain owners (`PersonnelPage`) share the vault, but not their own working context. |
| Portable, persistent artifacts | `exportDomainBooks` produces JSON; it lands on the operator's disk and stops there. |
| Integration/tooling | An MCP door already exists (`pairing-door.ts`, ports 8643/8646), which is the same transport Walrus Memory ships. |

## 2. What Walrus is, factually

| Property | Value |
|---|---|
| Data model | Immutable blobs, content-addressed, flat namespace. Identical content deduplicates to the same blob ID **[docs]** |
| Erasure coding | RedStuff (Twin-Code / RaptorQ). N = 1000 shards, f = 333, ~4.5x redundancy, plus a fixed **64 MB metadata term per blob** **[docs]** |
| Epoch | Mainnet 2 weeks, Testnet 1 day. Maximum purchase **53 epochs (~2 years)** **[docs]** |
| Expiry | Expires at the *start* of its end epoch. Renewal uses the Sui object ID, not the blob ID; anyone may extend a shared blob **[docs]** |
| Deletion | Owner-only, deletable blobs only. Does not clear caches, past-epoch nodes, or copies. Docs call it "limited utility for privacy". Burning the Sui object does not delete data and does not refund WAL **[docs]** |
| Price | **$0.023/GB/month**, USD-denominated, paid in WAL, billed on *encoded* size **[docs]** |
| Read | `GET $AGGREGATOR/v1/blobs/<BLOB_ID>`. Mainnet reference aggregator `https://aggregator.walrus-mainnet.walrus.space` **[docs]** |
| Max blob | ~13.6 GiB (docs disagree: 13.3 / 13.6 / 14.3 GiB). Most public aggregators cap a request at 10 MiB **[docs]** |
| Batching | **Quilt**: up to 666 blobs in one stored unit. Patches are individually readable, but delete/extend/share apply to the **whole quilt** **[docs]** |
| Mainnet publishers | **No public unauthenticated publisher on Mainnet.** A private authenticated publisher, an upload relay with a tip, or the SDK with a wallet **[docs]** |
| SDK | `@mysten/walrus` 1.2.35, peer `@mysten/sui` ^2.36.0, required WASM (`@mysten/walrus-wasm` 0.3.1). **ESM-only.** Electron main is not a documented environment **[docs/registry]** |
| Without a relay | ~2200 requests per blob write, ~335 per read **[docs]** |

### The "user-owned database" idea, done correctly

The instinct behind the request is right; the implementation is not "put the database on Walrus". The pattern that works — and the one Walrus Memory itself uses — is:

```
append-only content-addressed log on Walrus   ← source of truth, operator-owned, verifiable
        ↓ rebuild any time
disposable local index (SQLite / pgvector)    ← query engine, rebuildable from the log
```

Walrus Memory documents exactly this: Walrus is the "permanent record", Postgres+pgvector is a rebuildable cache, and `restore` re-reads the blobs. That reframes the goal usefully for LifeQuest: **the vault is already the log** (`.lifequest/log.jsonl`, append-only, with an `actor` on every event). Walrus is the second home for it, and `domain.sqlite` stays the query engine. Nothing about the current offline-first contract has to change.

## 3. Cost, worked against a real vault

Doc-stated example: 50 GB → ~225 GB encoded → ~$5.18/month → ~$62/year. Everything below is **[derived]** from the same formula (encoded ≈ 4.5 × original + 64 MB per blob), and shows the single most important engineering fact: **per-blob upload is the cost trap.**

| Payload | Billed (encoded) | $/month | $/year |
|---|---|---|---|
| One 1 MB blob | 68 MB | $0.0016 | $0.02 |
| 8 MB text-only snapshot, one Quilt | 100 MB | $0.0023 | $0.03 |
| 100 × 5 MB receipts as individual blobs | 8.65 GB | $0.20 | $2.39 |
| The same 100 receipts in one Quilt | 2.31 GB | $0.053 | $0.65 |

Consequences:

- A text-only vault snapshot — doctrine, goals, projects, pages, notes, log, book JSON — costs **about three cents a year**. This is the cheapest meaningful sovereignty feature available.
- Uploading receipts one blob at a time costs **3.75x** what batching them costs, for the same bytes.
- A $5/month storage budget at these overheads implies a vault in the tens of gigabytes. LifeQuest vaults are metadata plus photos, so this is not close to a real constraint. SUI gas per write is separate and doc-stated as size-independent for register/certify; no USD figures are given **[not stated]**.

## 4. The five candidate integrations

### A. Encrypted vault snapshot — **build this first**

The unit is the whole vault as one artifact: prescribed files plus `exportDomainBooks` output for every live domain, tarred, encrypted, and stored as **one** blob (or one Quilt for a vault that exceeds 10 MiB).

Properties that fit LifeQuest unusually well:

- **Snapshots need no conflict resolution.** Blobs are immutable and content-addressed, so two snapshots of the same state deduplicate to one blob ID and two differing snapshots are two objects rather than a merge. This sidesteps exactly the conflict machinery that linked-canonical databases carry (`domainConflicts`, `sync-queue.json`).
- **The vault never becomes dependent.** Offline-first is untouched; a failed upload is a failed upload, not a broken vault.
- **It answers a real user fear.** "My laptop died and my life database was on it" is the strongest argument for this feature, and it is a durability argument, not a blockchain argument.

Touchpoints: a new `packages/vault-core/src/walrus-snapshot.ts`; the wallet in OS secure storage via `apps/desktop/electron/secrets.ts` (`safeStorage`, next to the Hermes tokens — `LAWS/SECRETS.md` forbids putting it in the vault); a `Settings → Vault` section beside the existing per-domain export/restore in `SettingsVault.tsx`; snapshot bookkeeping in `.lifequest/snapshots.json` recording blob ID, epoch, and expiry.

Cost: ~$0.03/year for the text, ~$0.65/year including a hundred receipts.

### B. Companion memory that outlives the companion — **highest track fit**

Walrus Memory (MemWal) stores agent memories as Seal-encrypted Walrus blobs, with vector search in a rebuildable pgvector cache. A memory space is `(Owner Sui address, Namespace, App ID)`. It requires only an Ed25519 delegate key whose public key the owner registered onchain — no wallet and no tokens in the agent's own loop — and it ships an **MCP server** with eight tools (`memwal_remember`, `memwal_recall`, `memwal_analyze`, `memwal_restore`, `memwal_health`, …) over Streamable HTTP at `/api/mcp` **[docs]**.

That the transport is MCP is the whole reason this is cheap for LifeQuest: the Hermes profile written by `companion-profile.ts` already declares `mcp_servers.lifequest` with a bearer and a URL. MemWal becomes a second entry, and the companion gains memory tools beside its vault tools with no new LifeQuest code and no change to the door.

What it means for the operator: their companion's memory is addressed by **their own Sui address**, not by a LifeQuest account or a Hermes profile directory. Wipe Hermes, move machines, point another agent framework at the same memory space, and the memory is still theirs. That is the sovereignty claim in its strongest available form, and it is precisely the track's "cross-tool memory sharing" ask.

Guardrails:

- **Scope it as Hermes' memory backend, not a LifeQuest feature.** `VISION.md` states Hermes owns the agent loop, memory, skills, and transcripts. LifeQuest naming a memory space in the profile is configuration, not a takeover.
- **Namespace per vault.** Otherwise two vaults, or a test vault and a live one, pool their memories. Namespaces are ≤255 UTF-8 bytes — the vault id fits.
- **The public relayer sees plaintext** in the default path, and MemWal is a free public good with **no SLA**, 1 GB per account, 20 delegate keys, and cost-weighted write rate limits **[docs]**. For a vault containing health and finance material, `MemWalManual` (client-side Seal + embeddings; the relayer sees ciphertext and vectors only) or a self-hosted relayer is the only defensible mode. Using the default relayer and calling the result private would be false.
- Secrets are stripped before write because storage is append-only; that is a MemWal behavior, not a substitute for not writing secrets.

### C. A tamper-evident life log — **cheapest, most "blockchain" of the asks**

Once a day (or on demand), hash the vault's append-only records — `log.jsonl`, resolved Decisions, the daily note — into a Merkle root and anchor that single digest on Sui as an object, or as a tiny Walrus blob referenced by a Sui object.

Two things make this attractive:

- **A hash leaks nothing.** This is the one part of the whole design that needs no encryption, because the anchored value is a digest.
- **It gives agent accountability teeth.** `LifeEvent.actor` already records whether the operator or which agent wrote a change. Anchoring turns "the vault says the companion changed this" into "the vault can prove it did not rewrite history afterwards" — which is the difference between a log and a trustworthy log.

Cost: Sui gas per anchor plus a negligible blob. Value: provable finance records, provable agent conduct, and a date-stamped account of a life that no later edit can quietly revise.

Do not do this *instead of* A. A hash proves the integrity of data you may have already lost.

### D. Per-file receipt and media uploads — **do not build this**

`receipt-image.ts` stores originals up to 25 MB per receipt through `saveDatabaseFile`, and every file gets a `relPath` and `fileId`. The tempting move is one blob per receipt. Refuse it:

- 64 MB of fixed metadata per blob makes per-file uploads 3.75x more expensive (§3).
- Quilt batches are individually readable but **delete and extend act on the whole quilt**, so a single receipt can never be removed or extended alone.
- Deletion is already only "limited utility for privacy", so an uploaded receipt is effectively permanent. A leaked medical bill cannot be recalled.

Build the useful half instead: **content-address files locally.** Hash every stored file and keep the hash in the row. The snapshot in A then carries a manifest in which any file's bytes can be checked against its recorded hash, giving tamper-evidence with no upload at all. Offer a single explicit *"publish this one file"* action for the operator who genuinely needs to hand an accountant a verifiable document — operator-initiated, one blob, cost shown before it is paid.

### E. A published snapshot as a Walrus Site — **optional, and only as an export**

A Review pack or dashboard snapshot rendered to static HTML and published to Walrus Sites can be shared with an accountant, a spouse, or a therapist through a portal, named with SuiNS, with no account and no server. That is a real sovereignty win: sharing without a platform.

It is only lawful against `VISION.md` if it is an **export artifact generated from a locked snapshot** — never the live vault, never a second surface to keep in sync, and never a LifeQuest-hosted copy. Any design where the published site is authoritative is out.

## 5. Where this collides with LifeQuest's own laws

| Rule | Verdict |
|---|---|
| `LAWS/IDENTITY.md`: no account required to use a vault | **Aligned if opt-in.** The wallet must never enter vault creation or the open path. A vault with no wallet is a complete product. |
| `VISION.md`: a LifeQuest-hosted copy of the vault is not welcome | **Aligned while the wallet, publisher, and blobs are the operator's.** This flips to a violation the moment LifeQuest ships a funded publisher wallet that pays on the operator's behalf — that makes LifeQuest a custodian of the copy. Either the operator funds it, or the app says in plain words that LifeQuest sponsors and therefore controls the upload path. |
| `VISION.md`: the live ledger remains inside the vault folder | **Requires a hard boundary.** Walrus is a snapshot target only. No design may read live state back from Walrus as authoritative; `domain.sqlite` stays canonical. |
| `VISION.md`: whole-vault encryption is welcome, on by default for new vaults, and skippable; creating a vault does not require a passphrase | **This is an unmet precondition, not an existing feature.** grep finds no cipher, KDF, or encryption path in `packages/vault-core/src` or the desktop main process. Encryption must be built before the first byte goes to Walrus, and because vault creation may not demand a passphrase, the base key belongs in OS secure storage (`secrets.ts`, `safeStorage`) with a passphrase as an upgrade. |
| The same line, restated as a failure mode | A `safeStorage`-bound key dies with the Windows profile, so a snapshot encrypted only under it **cannot be restored on another machine** — which is the entire point of an off-site backup. A passphrase-protected key is what makes the backup restorable elsewhere. This tension needs an explicit decision before Phase 1 ships. |
| `LAWS/SECRETS.md`: API keys must not be stored in the vault | The WAL wallet key belongs in `secrets.ts`. Consequence: the key is not in the snapshot, so renewal depends on a machine-local secret. If the profile is lost, the snapshot becomes unreadable *and* unrenewable. Document it; surface it in Settings. |
| `VISION.md`: Hermes owns the agent loop, memory, skills, and transcripts | MemWal must be Hermes' memory backend named in the profile, not a LifeQuest feature that quietly takes memory over. |
| `VISION.md`: not a hosted web app, not a SaaS | Walrus Sites only as an exported artifact (§4E). |
| `AGENTS.md`: no unit tests; E2E with a repeatable artifact | The acceptance proof for Phase 1 is an E2E rig that snapshots a throwaway vault to **Testnet**, reads the blob back through the aggregator, decrypts it, and writes `e2e/artifacts/walrus-snapshot.json` holding the blob ID, expiry epoch, and the restored-bytes hash. That artifact is both the test result and the sovereignty demonstration. |

## 6. The traps, bluntly

1. **Epoch expiry is silent data loss.** Mainnet epochs are two weeks; the maximum purchase is ~2 years. A snapshot with no renewal is a backup that dies on a schedule the operator cannot see. Phase 1 needs a renewal timer, an expiry date stored beside the blob ID, and a visible warning — the same family as the deadline pressure the timeline already applies.
2. **Confidentiality is not provided, ever.** Encrypt client-side before upload. Seal is Mysten's answer and fits: client-side encryption, threshold key servers, and access policy expressed in a Move package, with an `@mysten/seal` TS SDK. Note Seal's own non-goals: it explicitly says not to use it for regulated personal data such as PHI. LifeQuest has a Health domain. Default it to *not published*, and make exclusion a per-domain, per-kind decision rather than one global switch.
3. **No true deletion.** Append-only means an uploaded receipt cannot be recalled. Anything that must be forgettable must never be uploaded.
4. **Blob IDs are capabilities, not secrets.** The Sui event stream (`BlobRegistered`, `BlobCertified`) is observable, and an aggregation endpoint needs only the ID. Treat a blob ID as publishable-by-intent.
5. **64 MB per blob of fixed overhead.** Batch everything through Quilt; never one blob per file.
6. **Mainnet has no public publisher.** A tipped relay, a private authenticated publisher, or the SDK with a wallet. The SDK also means an ESM-only dependency with a **WASM** payload landing inside an Electron main process that is currently CJS-bundled by `scripts/bundle-electron.mjs`. Docs do not list Electron as a supported environment. The WASM asset must ship in the asar and resolve at runtime; that is a packaging risk to prove with `packaged-smoke.mjs`, not to assume.
7. **~2200 requests per write without a relay.** Not a design the studio should do synchronously on a UI thread.
8. **No free tier, and a token price.** Storage is USD-denominated, so the dollar cost is stable while the WAL amount moves. A two-year prepay is a commitment in a young asset.
9. **The public MemWal relayer sees plaintext and offers no SLA.** For this data, self-host or `MemWalManual`.
10. **Single-vendor dependency.** Walrus is Sui-specific. The mitigation is architectural and already true: the vault must remain fully functional with Walrus switched off. Every phase below must hold that invariant.

## 7. Recommended sequencing

| Phase | Work | Proof |
|---|---|---|
| **0. Precondition** | Client-side encryption for the vault, with the key in `secrets.ts` and an optional passphrase upgrade. Content-addressed file hashes recorded per row. | An E2E that encrypts, decrypts, and detects a single flipped byte. |
| **1. Snapshot** | Snapshot assembly, Quilt batching, wallet in secure storage, `Settings → Vault` surface with cost shown before upload, `.lifequest/snapshots.json` with expiry, renewal timer. New `walrus-snapshot.ts` in vault-core. | Testnet E2E → `e2e/artifacts/walrus-snapshot.json` with blob ID, expiry epoch, restored-bytes hash. |
| **2. Companion memory** | MemWal MCP entry in the Hermes profile, namespace = vault id, sovereign mode (self-host or `MemWalManual`). | Wipe the Hermes profile, restart, and have the companion recall a fact written before the wipe. |
| **3. Anchors** | Daily digest of log + resolved Decisions + daily note, anchored on Sui. | Recompute the digest from the vault and match the anchored value; then edit a log line and show the mismatch. |
| **4. Optional** | Publish one Review pack as a Walrus Site from a locked snapshot. | The portal URL renders the pack; the live vault is untouched. |

Phases 0 and 1 are the ones with standalone product value. Phase 2 is the one that wins the track. Phases 3 and 4 are cheap follow-ons that make the sovereignty story complete.

## 8. If this is a Walrus-track submission

The strongest submission is not the snapshot feature — it is Phase 2 plus the vault's existing agent surfaces, demoed as one system:

- **Persistent memory across sessions and across frameworks.** The companion recalls a fact written before its entire local state was deleted, from a memory space addressed by the operator's Sui address. Then a *different* MCP client reads the same memory space, proving cross-tool sharing rather than one app's private cache.
- **Multi-agent coordination over artifacts.** An advisor agent produces a memo as an artifact; the domain-owning agent reads it by blob ID; the operator approves it as a Decision carrying that blob ID. This is the track's "artifact-driven workflow" and "step-by-step execution across agents" in one path, and LifeQuest already has the coordination primitive (Decisions) most entries would have to invent.
- **Verifiable personal data.** A finance row's `source_file` receipt has a hash, and the vault's log for that date has an anchored digest. The demo is the operator proving an entry was not altered, without asking anyone to trust the app.

Differentiator to lead with: this is a real product with a real data contract, offline-first behavior, and an approval path for agent writes — not a chatbot with a vector store. Do not claim the memory is private if the default relayer is used.

## 9. What not to build

- Walrus as the vault's primary or live store. Ever.
- One blob per file, or per receipt.
- A required wallet, account, or passphrase at vault creation.
- A LifeQuest-custodied publisher without saying so in plain words in Settings.
- Anchoring digests without snapshotting the data the digests cover.
- Publishing the Health domain by default.
- Any shared or multi-operator vault on the back of it. `VISION.md` forbids it, and immutability makes it worse, not better.

## Sources

- Problem statement: https://mystenlabs.notion.site/walrus-track-problem-statement
- Getting started: https://docs.wal.app/docs/getting-started
- Core concepts / RedStuff: https://docs.wal.app/docs/system-overview/core-concepts · https://docs.wal.app/docs/system-overview/red-stuff · https://docs.wal.app/docs/system-overview/red-stuff-parameters
- Storage costs: https://docs.wal.app/docs/system-overview/storage-costs · calculator https://costcalculator.wal.app/
- Quilt: https://docs.wal.app/docs/system-overview/quilt
- Managing blobs / caching: https://docs.wal.app/docs/walrus-client/managing-blobs · https://docs.wal.app/docs/system-overview/caching
- Data security: https://docs.wal.app/docs/data-security
- Networks and endpoints: https://docs.wal.app/docs/network-reference
- Sponsored and walletless uploads: https://docs.wal.app/docs/sponsored-uploads
- TypeScript SDK: https://sdk.mystenlabs.com/walrus · registry https://registry.npmjs.org/@mysten/walrus/latest
- Walrus Memory: https://docs.wal.app/walrus-memory · MCP https://docs.wal.app/walrus-memory/mcp/overview · relayer https://docs.wal.app/walrus-memory/relayer/overview · trust model https://docs.wal.app/walrus-memory/fundamentals/architecture/data-flow-security-model
- Seal: https://docs.sui.io/sui-stack/seal/
