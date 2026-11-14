import { atomicWriteFile } from "./atomic-write.ts";
import {
  isDomainLive,
  listRows,
  normaliseFinancePayeeCells,
  readRegistry,
  updateRowCellsBulk,
} from "./domain-databases.ts";
import { rebaseSyncBaselines } from "./adapters.ts";
import { appendLog } from "./log.ts";
import { vaultPaths } from "./paths.ts";
import { PAYEE_SANITISER_VERSION } from "./payee.ts";
import {
  FINANCE_DB_IDS,
  FINANCE_DOMAIN_SLUG,
  FINANCE_KIT_ID,
  type FinanceKitSettings,
  type Result,
} from "./types.ts";

/**
 * What the one-time payee repair did, or why it did not run.
 *
 * `ran:false, alreadyCurrent:false` is the kit-absent / domain-missing answer;
 * `alreadyCurrent:true` means this vault has already been repaired at the
 * current sanitiser version.
 */
export type PayeeMigrationOutcome = {
  ran: boolean;
  alreadyCurrent: boolean;
  scanned: number;
  changed: number;
  flagged: number;
};

const NOTHING_TO_DO: PayeeMigrationOutcome = {
  ran: false,
  alreadyCurrent: false,
  scanned: 0,
  changed: 0,
  flagged: 0,
};

const EMPTY_SETTINGS: FinanceKitSettings = {
  homeCurrency: "ZAR",
  usdZarRate: null,
  usdZarAsOf: null,
  defaultCaptureAccountId: null,
};

/**
 * Repair the operator's finance history once, in the app.
 *
 * The defect this heals is systemic: every captured or imported payee kept the
 * date, the account name, the category words and filler, and `notes` was null,
 * so the polluted payee was the only copy of what the operator said. Repairing
 * that row by row through Decisions made 194 rows cost 303 approvals — the
 * queue was the wrong place for a normalisation the app can define. So this is
 * one pass at vault open, one transaction, one log line, zero Decisions.
 *
 * Idempotent: the registry marker is set only after the rows are written, and
 * a second call writes nothing.
 */
export async function normaliseFinancePayeeHistory(
  root: string,
): Promise<Result<PayeeMigrationOutcome>> {
  try {
    if (!(await isDomainLive(root, FINANCE_DOMAIN_SLUG))) {
      return { ok: true, value: NOTHING_TO_DO };
    }
    const paths = vaultPaths(root);
    const registryPath = paths.domainRegistry(FINANCE_DOMAIN_SLUG);
    const registry = await readRegistry(registryPath);
    if (!registry.installedKits.includes(FINANCE_KIT_ID)) {
      return { ok: true, value: NOTHING_TO_DO };
    }
    const current = registry.finance?.payeeSanitiserVersion ?? 0;
    if (current >= PAYEE_SANITISER_VERSION) {
      return {
        ok: true,
        value: { ran: false, alreadyCurrent: true, scanned: 0, changed: 0, flagged: 0 },
      };
    }

    const rowsRes = await listRows(root, FINANCE_DOMAIN_SLUG, FINANCE_DB_IDS.transactions);
    if (!rowsRes.ok) return rowsRes;

    const updates: Array<{ id: string; cells: Record<string, unknown> }> = [];
    let flagged = 0;
    for (const row of rowsRes.value) {
      const normalised = await normaliseFinancePayeeCells(
        root,
        FINANCE_DOMAIN_SLUG,
        FINANCE_DB_IDS.transactions,
        row.cells,
      );
      if (!normalised.changed) continue;
      if (normalised.issues.length > 0) flagged += 1;
      updates.push({ id: row.id, cells: normalised.cells });
    }

    if (updates.length > 0) {
      // One bulk write, not one Decision per row.
      const written = await updateRowCellsBulk(
        root,
        FINANCE_DOMAIN_SLUG,
        FINANCE_DB_IDS.transactions,
        updates,
      );
      if (!written.ok) return written;
      // A linked sheet would otherwise read this repair as a local edit and push
      // it over the remote row on the next sync.
      await rebaseSyncBaselines(
        root,
        FINANCE_DOMAIN_SLUG,
        updates.map((update) => ({ rowId: update.id, cells: update.cells })),
      );
    }

    // Re-read before writing the marker: a concurrent writer must not be
    // clobbered by this read-modify-write of the registry.
    const fresh = await readRegistry(registryPath);
    fresh.finance = {
      ...EMPTY_SETTINGS,
      ...(fresh.finance ?? {}),
      payeeSanitiserVersion: PAYEE_SANITISER_VERSION,
    };
    await atomicWriteFile(registryPath, JSON.stringify(fresh, null, 2) + "\n");

    await appendLog(root, {
      domainSlug: FINANCE_DOMAIN_SLUG,
      type: "finance.payees.normalised",
      summary: `Normalised payees on ${updates.length} of ${rowsRes.value.length} transaction rows`,
      payload: {
        version: PAYEE_SANITISER_VERSION,
        scanned: rowsRes.value.length,
        changed: updates.length,
        flagged,
      },
    });

    return {
      ok: true,
      value: {
        ran: true,
        alreadyCurrent: false,
        scanned: rowsRes.value.length,
        changed: updates.length,
        flagged,
      },
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
