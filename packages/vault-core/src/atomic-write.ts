import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { assertNoSymlinkLeaf } from "./paths.ts";

/**
 * Write a file by creating a sibling temp file and renaming it over the target.
 *
 * Three properties matter beyond "the bytes end up there":
 *
 *  - the temp name carries a random suffix, so two writers in one process (the
 *    renderer's vault queue AND an MCP agent tool, which does not share that
 *    queue) can never collide on it — the old `.name.pid.tmp` made the second
 *    `rename` fail with ENOENT and could truncate the first writer's payload;
 *  - the temp file is opened `wx` (exclusive) and `0600`, fsynced, then renamed,
 *    so a crash cannot leave a half-written file under the target name;
 *  - a symlinked target or a symlinked containing directory is refused. This is
 *    the last-line check for writers that do not hold the vault root (the
 *    callers that do also run the full `assertPhysicalContainment` walk).
 */
async function writeAtomic(filePath: string, data: string | Uint8Array): Promise<void> {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
  // `dir` may itself be the symlink a hostile vault planted.
  await assertNoSymlinkLeaf(dir);
  await assertNoSymlinkLeaf(filePath);

  const tmp = path.join(
    dir,
    `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`,
  );
  const handle = await fs.open(tmp, "wx", 0o600);
  try {
    if (typeof data === "string") {
      await handle.writeFile(data, "utf8");
    } else {
      await handle.writeFile(data);
    }
    await handle.sync();
  } catch (e) {
    await handle.close().catch(() => undefined);
    await fs.rm(tmp, { force: true }).catch(() => undefined);
    throw e;
  }
  try {
    await handle.close();
  } catch {
    // The fsync above is what matters for durability; a close failure here is
    // reported by the rename that follows if the file is actually unusable.
  }
  try {
    await fs.rename(tmp, filePath);
  } catch (e) {
    await fs.rm(tmp, { force: true }).catch(() => undefined);
    throw e;
  }
  // Best effort: make the rename itself durable. A filesystem that refuses to
  // open a directory for fsync (some network mounts) must not fail the write.
  try {
    const dirHandle = await fs.open(dir, "r");
    try {
      await dirHandle.sync();
    } finally {
      await dirHandle.close();
    }
  } catch {
    // Durability of the directory entry is not guaranteed on this filesystem.
  }
}

export async function atomicWriteFile(filePath: string, contents: string): Promise<void> {
  await writeAtomic(filePath, contents);
}

export async function atomicWriteBytes(
  filePath: string,
  bytes: Uint8Array,
): Promise<void> {
  await writeAtomic(filePath, bytes);
}
