import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  DEFAULT_DECISION_INBOX_SETTINGS,
  createVault,
  openVault,
  updateSettings,
  vaultPaths,
  type DecisionInboxSettings,
  type VaultSettings,
} from "@lifequest/vault-core";

/**
 * The Decisions inbox switches, end to end against a real vault on disk.
 *
 * The UI rig (`decision-inbox-auto-e2e.test.ts`) proves what the operator sees
 * with a stubbed bridge, which is the right instrument for a sheet opening and
 * closing itself. It deliberately does not prove that the switches are actually
 * PERSISTED: the preference lives in `.lifequest/settings.json`, and the path
 * that writes it is the vault engine in the main process, behind the bridge the
 * rig stubs. A preference that is only held in memory is a switch that forgets
 * itself at the next launch, and that is the failure this file exists to catch.
 *
 * It runs under `node --experimental-strip-types --test` from `apps/desktop`, so
 * it needs no Electron and no dev server: vault-core is plain Node, and every
 * assertion below is against a real temporary vault's real settings file.
 *
 * ── How this can fail (written before the assertions) ────────────────────────
 *
 *  1. A new vault is created without the key, so the settings page draws the
 *     defaults while the file it wrote has nothing to read back.
 *  2. A vault written before the switches existed (no key) opens without them,
 *     so the page shows an undefined switch position and the watcher sees
 *     `undefined` instead of "on".
 *  3. The switches are written but dropped by the NEXT settings write, because
 *     `updateSettings` rebuilds the settings object from named fields and the
 *     new field is not carried through.
 *  4. A patch for one switch resets the other to its default instead of keeping
 *     the value the operator chose.
 *  5. A non-boolean value (`"off"`, `1`) is accepted and saved, so a hand-edited
 *     or mis-typed write silently changes behaviour.
 *  6. A hand-edited file with one good and one broken value loses both, rather
 *     than falling back per field.
 *  7. The value the settings page sends (the whole `decisionInbox` object) does
 *     not round-trip through the engine unchanged.
 */

const desktopRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const ARTIFACT = path.join(
  desktopRoot,
  "e2e/artifacts/decision-inbox-settings-engine.json",
);

type Claim = {
  claim: string;
  pass: boolean;
  detail: Record<string, unknown>;
};

const claims: Claim[] = [];

function record(claim: string, detail: Record<string, unknown> = {}): void {
  claims.push({ claim, pass: true, detail });
}

async function readSettings(root: string): Promise<VaultSettings> {
  const raw = await fs.readFile(vaultPaths(root).settingsJson, "utf8");
  return JSON.parse(raw) as VaultSettings;
}

/** Rewrite the settings file exactly as a hand-edit or a legacy vault would. */
async function writeSettings(
  root: string,
  value: Record<string, unknown>,
): Promise<void> {
  await fs.writeFile(
    vaultPaths(root).settingsJson,
    `${JSON.stringify(value, null, 2)}\n`,
  );
}

describe("the decision inbox switches persist in a real vault", () => {
  it("seeds both switches, normalizes a legacy vault, and survives unrelated writes and partial patches", async () => {
    const root = await fs.mkdtemp(
      path.join(os.tmpdir(), "lifequest-decision-inbox-"),
    );
    try {
      // 1 — a new vault carries the switches, so the page has a file to read.
      const created = await createVault(root, "Harness");
      assert.equal(
        created.ok,
        true,
        `createVault failed: ${created.ok ? "" : created.error}`,
      );
      const seeded = await readSettings(root);
      assert.deepEqual(
        seeded.decisionInbox,
        { autoOpen: true, autoClose: true },
        "a new vault's settings.json does not carry both switches on",
      );
      record(
        "1. A new vault's settings.json carries decisionInbox with both switches on.",
        { seeded: seeded.decisionInbox },
      );

      // 2 — a vault written before the switches existed gains the defaults on
      //     open, without rewriting the file (open must not mutate a vault).
      const legacy: Record<string, unknown> = { ...seeded };
      delete legacy.decisionInbox;
      await writeSettings(root, legacy);
      const opened = await openVault(root);
      assert.equal(
        opened.ok,
        true,
        `openVault failed: ${opened.ok ? "" : opened.error}`,
      );
      assert.deepEqual(
        opened.ok ? opened.value.settings.decisionInbox : null,
        DEFAULT_DECISION_INBOX_SETTINGS,
        "a vault with no decisionInbox key did not open with both switches on",
      );
      const stillLegacy = await readSettings(root);
      assert.equal(
        stillLegacy.decisionInbox,
        undefined,
        "opening a legacy vault rewrote its settings file",
      );
      record(
        "2. A vault with no decisionInbox key opens with both switches on, and opening it leaves the file untouched.",
        { opened: DEFAULT_DECISION_INBOX_SETTINGS },
      );

      // 3 — the settings page's write (the whole object) lands on disk and is
      //     read back by a reopen, which is what "survives a launch" means.
      const off = await updateSettings(root, {
        decisionInbox: { autoOpen: false, autoClose: true },
      });
      assert.equal(off.ok, true, "updateSettings refused the settings page's write");
      assert.deepEqual(
        (await readSettings(root)).decisionInbox,
        { autoOpen: false, autoClose: true },
        "the auto-open write never reached settings.json",
      );
      const reopened = await openVault(root);
      assert.deepEqual(
        reopened.ok ? reopened.value.settings.decisionInbox : null,
        { autoOpen: false, autoClose: true },
        "the written switch did not survive a reopen",
      );
      record(
        "3. Turning auto-open off lands in settings.json and survives a reopen.",
        { stored: { autoOpen: false, autoClose: true } },
      );

      // 4 — an unrelated settings write must not drop the field. This is the
      //     exact bug `updateSettings`'s rebuilt `next` invites.
      const theme = await updateSettings(root, { theme: "dark" });
      assert.equal(theme.ok, true, "the theme write was refused");
      const afterTheme = await readSettings(root);
      assert.equal(afterTheme.theme, "dark", "the unrelated write did not land");
      assert.deepEqual(
        afterTheme.decisionInbox,
        { autoOpen: false, autoClose: true },
        "an unrelated settings write dropped or reset the inbox switches",
      );
      record(
        "4. An unrelated settings write (theme) preserves both inbox switches.",
        { theme: afterTheme.theme, decisionInbox: afterTheme.decisionInbox },
      );

      // 5 — a one-switch patch keeps the other stored value. The settings page
      //     sends both, but the IPC channel is public and a partial write must
      //     not undo the operator's other choice.
      await updateSettings(root, {
        decisionInbox: { autoOpen: true, autoClose: false },
      });
      const partial = await updateSettings(root, {
        decisionInbox: { autoOpen: false },
      });
      assert.equal(partial.ok, true, "a one-switch patch was refused");
      assert.deepEqual(
        (await readSettings(root)).decisionInbox,
        { autoOpen: false, autoClose: false },
        "a one-switch patch reset the other switch to its default",
      );
      record(
        "5. A one-switch patch keeps the other switch's stored value.",
        { stored: { autoOpen: false, autoClose: false } },
      );

      // 6 — a non-boolean is refused and nothing is written, so a mistyped
      //     write cannot silently change behaviour.
      const beforeBad = await readSettings(root);
      const bad = await updateSettings(root, {
        decisionInbox: {
          autoOpen: "yes",
        } as unknown as DecisionInboxSettings,
      });
      assert.equal(bad.ok, false, "a non-boolean switch value was accepted");
      assert.deepEqual(
        (await readSettings(root)).decisionInbox,
        beforeBad.decisionInbox,
        "a refused write still changed settings.json",
      );
      record("6. A non-boolean switch value is refused and settings.json is unchanged.", {
        error: bad.ok ? null : bad.error,
        stored: beforeBad.decisionInbox,
      });

      // 7 — a hand-edited file is read per field: one broken value does not
      //     turn the other switch off with it.
      await writeSettings(root, {
        ...beforeBad,
        decisionInbox: { autoOpen: false, autoClose: "loud" },
      });
      const tolerant = await openVault(root);
      assert.equal(tolerant.ok, true, "a hand-edited settings file failed to open");
      assert.deepEqual(
        tolerant.ok ? tolerant.value.settings.decisionInbox : null,
        { autoOpen: false, autoClose: true },
        "a broken field took its sibling switch down with it",
      );
      record(
        "7. A hand-edited settings file falls back per field: the good switch keeps its value, the broken one reads on.",
        { opened: { autoOpen: false, autoClose: true } },
      );

      // The repeatable artifact: only a run that held writes one.
      const report = {
        pass: true,
        ranAt: new Date().toISOString(),
        command:
          "cd apps/desktop && node --experimental-strip-types --test tests/decision-inbox-settings-engine-e2e.test.ts",
        vaultRoot: "<temporary, removed after the run>",
        claims,
        passCount: claims.length,
        failCount: 0,
        files: {
          settings: ".lifequest/settings.json",
          artifact:
            "apps/desktop/e2e/artifacts/decision-inbox-settings-engine.json",
        },
      };
      await fs.mkdir(path.dirname(ARTIFACT), { recursive: true });
      await fs.writeFile(ARTIFACT, `${JSON.stringify(report, null, 2)}\n`);

      assert.equal(claims.length, 7, "every claim must be named in the artifact");
      for (const claim of claims) {
        assert.equal(claim.pass, true, `claim failed: ${claim.claim}`);
      }
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
