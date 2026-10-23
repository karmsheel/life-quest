import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  createIdealState,
  createVault,
  deleteIdealState,
  getIdealState,
  IDEAL_STATE_TITLE_MAX,
  listIdealStates,
  updateIdealState,
} from "@lifequest/vault-core";

/**
 * Ideal State, end to end, against a real vault on disk.
 *
 * This is the storage half of the page behind the Define wing: the operator's
 * titled documents are created by the same functions the IPC handlers call,
 * land as real markdown files under `notes/ideal-state/`, and read back with
 * their titles, bodies and stamps intact. The page's render half — creating
 * several documents, naming them, switching between them — is the
 * `ideal-state-ui` rig, which needs a real layout engine and a dev server.
 *
 * ── How this can fail (written before the assertions) ────────────────────────
 *
 *  1. A document landing anywhere but `notes/ideal-state/{id}.md`, or a second
 *     creation reusing the first file's id.
 *  2. The title or body mangled by the frontmatter round trip — a title with
 *     spaces, a heading, a list, a trailing newline changed on the way in or out.
 *  3. `createdAt` reset by every rename, or the id changing when the title does.
 *  4. A document with no title stored, so the list has nothing to say.
 *  5. Deleting a document leaving its file behind, or removing a different file.
 *  6. The list hiding a document that exists, or ordering it oldest first.
 *  7. A path-shaped id reaching the filesystem.
 *  8. A fresh vault failing instead of reading as an empty page.
 *  9. A hand-written file losing its prose because it has no frontmatter.
 * 10. An artifact written by a failing run. Failures throw, so the artifact only
 *     exists for a run that held.
 */

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ARTIFACT = path.join(desktopRoot, "e2e/artifacts/ideal-state-engine.json");

function fileNames(dir: string): string[] {
  try {
    return fs.readdirSync(dir).sort();
  } catch {
    return [];
  }
}

describe("ideal state e2e", () => {
  it("stores any number of titled markdown documents, and reads them back", async () => {
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "lq-ideal-state-"));
    const vaultRoot = path.join(workDir, "vault");
    const docDir = path.join(vaultRoot, "notes", "ideal-state");
    const checks: Record<string, unknown> = {};

    const createdVault = await createVault(vaultRoot, "Ideal State Rig");
    assert.equal(
      createdVault.ok,
      true,
      `createVault failed: ${createdVault.ok ? "" : createdVault.error}`,
    );

    // ── 1. a fresh vault is an empty page, not a failure ─────────────────────
    const fresh = await listIdealStates(vaultRoot);
    assert.equal(fresh.ok, true, "a vault with no ideal-state directory must read as empty");
    assert.deepEqual(fresh.ok ? fresh.value : null, [], "a fresh vault reported documents");
    checks.freshList = fresh.ok ? fresh.value : null;

    // ── 2. the first document: one file, at the minted id ────────────────────
    const first = await createIdealState(vaultRoot, {
      title: "  A calm morning  ",
      bodyMarkdown:
        "# Morning\n\nWake before the house.\n\n- walk\n- write\n\nA trailing space goes.   ",
    });
    assert.equal(first.ok, true, `the first create failed: ${first.ok ? "" : first.error}`);
    if (!first.ok) return;
    const alpha = first.value;
    checks.first = alpha;
    assert.equal(alpha.title, "A calm morning", "the title was not trimmed");
    assert.match(alpha.id, /^[0-9a-f-]{36}$/i, "the vault did not mint a uuid id");

    const alphaPath = path.join(docDir, `${alpha.id}.md`);
    assert.equal(fs.existsSync(alphaPath), true, `no document at ${alphaPath}`);
    checks.filesAfterFirst = fileNames(docDir);
    assert.deepEqual(
      checks.filesAfterFirst,
      [`${alpha.id}.md`],
      "the first create did not leave exactly one file",
    );

    const alphaRaw = fs.readFileSync(alphaPath, "utf8");
    checks.alphaRaw = alphaRaw;
    assert.match(alphaRaw, /^---\ntitle: A calm morning\n/, "the file does not open with its title");
    assert.match(alphaRaw, /createdAt: "?\d{4}-\d{2}-\d{2}T/, "the file carries no createdAt");
    assert.match(alphaRaw, /updatedAt: "?\d{4}-\d{2}-\d{2}T/, "the file carries no updatedAt");
    assert.ok(alphaRaw.includes("# Morning"), "the body did not survive the round trip");
    assert.equal(
      alphaRaw.endsWith("A trailing space goes.   \n"),
      false,
      "the body kept trailing blank space the vault should have trimmed",
    );
    assert.equal(alpha.bodyMarkdown, "# Morning\n\nWake before the house.\n\n- walk\n- write\n\nA trailing space goes.\n");

    // ── 3. a second document is another file, not an edit of the first ───────
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = await createIdealState(vaultRoot, {
      title: "Work that matters",
      bodyMarkdown: "Build one thing well.",
    });
    assert.equal(second.ok, true, `the second create failed: ${second.ok ? "" : second.error}`);
    if (!second.ok) return;
    const beta = second.value;
    assert.notEqual(beta.id, alpha.id, "two documents share one id");
    checks.filesAfterSecond = fileNames(docDir);
    assert.deepEqual(
      checks.filesAfterSecond,
      [`${alpha.id}.md`, `${beta.id}.md`].sort(),
      "the second create did not leave a second file",
    );

    const listed = await listIdealStates(vaultRoot);
    assert.equal(listed.ok, true, "the list failed after two creates");
    const listedIds = listed.ok ? listed.value.map((entry) => entry.id) : [];
    checks.listedIds = listedIds;
    assert.deepEqual(
      listedIds,
      [beta.id, alpha.id],
      "the page is not newest first",
    );
    const listedTitles = listed.ok ? listed.value.map((entry) => entry.title) : [];
    assert.deepEqual(
      listedTitles,
      ["Work that matters", "A calm morning"],
      "the list is not carrying the operator's titles",
    );

    // ── 4. renaming edits that one file, and keeps its identity ──────────────
    await new Promise((resolve) => setTimeout(resolve, 5));
    const renamed = await updateIdealState(vaultRoot, alpha.id, {
      title: "A calm, strong morning",
      bodyMarkdown: "# Morning\n\nWake before the house.\n\nA new last line.",
    });
    assert.equal(renamed.ok, true, `the rename failed: ${renamed.ok ? "" : renamed.error}`);
    if (!renamed.ok) return;
    checks.renamed = renamed.value;
    assert.equal(renamed.value.id, alpha.id, "a rename changed the document's id");
    assert.equal(renamed.value.createdAt, alpha.createdAt, "a rename reset createdAt");
    assert.ok(renamed.value.updatedAt >= alpha.updatedAt, "updatedAt went backwards");
    assert.deepEqual(
      fileNames(docDir),
      [`${alpha.id}.md`, `${beta.id}.md`].sort(),
      "a rename moved or duplicated the file",
    );
    const updatedRaw = fs.readFileSync(alphaPath, "utf8");
    assert.match(
      updatedRaw,
      /^---\ntitle: A calm, strong morning\n/,
      "the renamed title did not reach the file",
    );
    assert.ok(updatedRaw.includes("A new last line."), "the new body did not reach the file");

    const readBack = await getIdealState(vaultRoot, alpha.id);
    assert.equal(readBack.ok, true, "the renamed document could not be read back");
    if (readBack.ok) {
      assert.equal(readBack.value.title, renamed.value.title);
      assert.equal(readBack.value.bodyMarkdown, renamed.value.bodyMarkdown);
      checks.readBack = readBack.value;
    }

    // ── 5. a title is required; a body is not ────────────────────────────────
    const blankCreate = await createIdealState(vaultRoot, { title: "   " });
    checks.blankCreateRefused = blankCreate.ok ? null : blankCreate.error;
    assert.equal(blankCreate.ok, false, "a document with no title was created");
    assert.match(String(checks.blankCreateRefused), /title is required/i);
    assert.equal(
      fileNames(docDir).length,
      2,
      "a refused blank title still wrote a file",
    );

    const longTitle = await createIdealState(vaultRoot, {
      title: "x".repeat(IDEAL_STATE_TITLE_MAX + 1),
    });
    checks.longTitleRefused = longTitle.ok ? null : longTitle.error;
    assert.equal(longTitle.ok, false, "a title longer than the limit was accepted");
    assert.match(String(checks.longTitleRefused), /at most/);

    const multiline = await updateIdealState(vaultRoot, alpha.id, {
      title: "two\nlines",
    });
    checks.multilineTitleRefused = multiline.ok ? null : multiline.error;
    assert.equal(multiline.ok, false, "a title with a line break was accepted");
    assert.match(String(checks.multilineTitleRefused), /one line/);
    const keptTitle = await getIdealState(vaultRoot, alpha.id);
    assert.equal(keptTitle.ok, true);
    if (keptTitle.ok) {
      assert.equal(
        keptTitle.value.title,
        "A calm, strong morning",
        "a refused title changed the title on disk",
      );
    }

    // An empty body is allowed: a document may be named before it has words.
    const emptied = await updateIdealState(vaultRoot, beta.id, { bodyMarkdown: "   \n\n" });
    assert.equal(emptied.ok, true, `clearing a body failed: ${emptied.ok ? "" : emptied.error}`);
    if (emptied.ok) {
      assert.equal(emptied.value.bodyMarkdown, "", "an empty body was not stored as empty");
      checks.emptiedBody = emptied.value.bodyMarkdown;
    }

    // ── 6. files the studio did not write ────────────────────────────────────
    // A hand-written markdown file with no frontmatter is still one of the
    // operator's documents: its prose is kept and its title falls back.
    fs.writeFileSync(path.join(docDir, "hand-written.md"), "A document from outside the app.\n");
    // A file that is not a document at all is not counted.
    fs.writeFileSync(path.join(docDir, "scratch.txt"), "not a document\n");

    const withHand = await listIdealStates(vaultRoot);
    assert.equal(withHand.ok, true, "the list failed after a hand-written file");
    const handEntry = withHand.ok
      ? withHand.value.find((entry) => entry.id === "hand-written")
      : undefined;
    checks.handWritten = handEntry ?? null;
    assert.ok(handEntry, "the hand-written document is missing from the list");
    if (handEntry) {
      assert.equal(handEntry.title, "Untitled", "a document with no title did not fall back");
      assert.equal(handEntry.error, undefined, "a readable hand-written file was reported as unreadable");
    }
    assert.equal(
      withHand.ok ? withHand.value.some((entry) => entry.id === "scratch") : true,
      false,
      "a stray text file was counted as a document",
    );
    const handRead = await getIdealState(vaultRoot, "hand-written");
    assert.equal(handRead.ok, true, "a hand-written document could not be read");
    if (handRead.ok) {
      assert.ok(
        handRead.value.bodyMarkdown.includes("from outside the app"),
        "a hand-written document lost its prose",
      );
    }

    // ── 7. ids are ours, never a path ────────────────────────────────────────
    for (const bad of ["../escape", "a/b", "", "x".repeat(100)]) {
      const escaped = await getIdealState(vaultRoot, bad);
      assert.equal(escaped.ok, false, `the id ${JSON.stringify(bad)} was accepted`);
    }
    const missing = await getIdealState(vaultRoot, "00000000-0000-0000-0000-000000000000");
    checks.missing = missing.ok ? null : missing.error;
    assert.equal(missing.ok, false, "a document that does not exist was read as found");
    assert.match(String(checks.missing), /not found/);

    // ── 8. delete removes that one file and nothing else ─────────────────────
    const removed = await deleteIdealState(vaultRoot, alpha.id);
    assert.equal(removed.ok, true, `delete failed: ${removed.ok ? "" : removed.error}`);
    if (removed.ok) assert.equal(removed.value.id, alpha.id);
    assert.equal(fs.existsSync(alphaPath), false, "the deleted document's file is still there");
    const afterDelete = await listIdealStates(vaultRoot);
    assert.equal(afterDelete.ok, true);
    checks.afterDeleteIds = afterDelete.ok ? afterDelete.value.map((entry) => entry.id) : [];
    assert.equal(
      afterDelete.ok ? afterDelete.value.some((entry) => entry.id === alpha.id) : true,
      false,
      "the deleted document is still in the list",
    );
    assert.equal(
      fs.existsSync(path.join(docDir, `${beta.id}.md`)),
      true,
      "delete removed a different document's file",
    );
    checks.filesAfterDelete = fileNames(docDir);

    // ── the artifact ────────────────────────────────────────────────────────
    fs.mkdirSync(path.dirname(ARTIFACT), { recursive: true });
    const report = {
      pass: true,
      what: "any number of titled markdown documents at notes/ideal-state/{id}.md, listed newest first and read back intact",
      command: "npm test  (this file: tests/ideal-state-e2e.test.ts)",
      vault: vaultRoot,
      checks,
      generatedAt: new Date().toISOString(),
    };
    fs.writeFileSync(ARTIFACT, `${JSON.stringify(report, null, 2)}\n`);
    assert.equal(fs.existsSync(ARTIFACT), true, "the run wrote no artifact");

    fs.rmSync(workDir, { recursive: true, force: true });
  });
});
