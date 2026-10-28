import {
  app,
  BrowserWindow,
  dialog,
  ipcMain as electronIpcMain,
  Notification,
  shell,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
} from "electron";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { stopMcp, setMcpPorts } from "./mcp-server.js";
import {
  channelMayChangeData,
  noteDataChanged,
  onDataChanged,
} from "./data-revision.js";
import * as companion from "./companion.js";
import { getFileUnsolicited, setFileUnsolicited } from "./companion-filing.js";
import type {
  CompanionInstructionsInput,
  CompanionRuntimeOverride,
} from "./companion-client.js";
import * as vault from "./vault-service.js";
import {
  checkForUpdate,
  installUpdate,
  setUpdateFeedUrl,
  setUpdateLauncher,
  setUpdateTrustPolicy,
} from "./updater.js";
import {
  setDeadlineDismissedOn,
  setDeadlineNotifiedOn,
  getDeadlineDismissedOn,
  getDeadlineNotifiedOn,
} from "./recent-vaults.js";
import {
  deadlinePressureGoals,
  daysUntilDeadline,
} from "@lifequest/vault-core/pure";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
app.setName("LifeQuest");
if (process.platform === "win32") {
  app.setAppUserModelId("com.lifequest.desktop");
}
const isDev = !app.isPackaged;

/**
 * The one e2e seam in the main process, and it is off unless a caller asks.
 *
 * An e2e rig has to do two things a normal launch cannot: point the app at a
 * throwaway profile so the operator's own `%APPDATA%\\LifeQuest` is never
 * touched, and keep the window off their desktop. Both are facts only the main
 * process can set, and neither is reachable from the renderer or a preload.
 *
 * `LIFEQUEST_E2E={"userData":"…","showWindow":false}`. Absent (the product
 * case) nothing here runs and the app behaves exactly as it always has, and
 * `showWindow` defaults to true so a rig that only wants an isolated profile
 * still gets a visible window.
 *
 * `mcpPorts` is the third fact a rig needs and cannot otherwise get: the doors
 * are 8643 and 8646 in the product, and the operator's own app holds both, so a
 * rig that watches a door bind has to move it off those ports. The listeners and
 * the url written into the Hermes profile move together (see `mcp-server.ts`).
 */
const E2E_RAW = process.env.LIFEQUEST_E2E;
const E2E: {
  userData?: string;
  showWindow: boolean;
  mcpPorts?: { local?: number; invite?: number };
  /**
   * The update feed and the installer launcher, for the auto-update rig. Both
   * are off unless this object names them: the product always reads GitHub and
   * always hands the file to the OS.
   */
  updateFeedUrl?: string;
  updateLauncher?: { exe?: unknown; args?: unknown };
  /**
   * Where the install's bytes are allowed to come from. Present only for the
   * auto-update rig, which serves them over loopback; the product leaves the
   * policy at GitHub over https.
   */
  updateTrust?: { hosts: string[]; allowHttp?: boolean };
} = { showWindow: true };
if (E2E_RAW) {
  try {
    const parsed = JSON.parse(E2E_RAW) as {
      userData?: unknown;
      showWindow?: unknown;
      mcpPorts?: { local?: unknown; invite?: unknown };
      updateFeedUrl?: unknown;
      updateLauncher?: { exe?: unknown; args?: unknown };
      updateTrust?: { hosts?: unknown; allowHttp?: unknown };
    };
    if (typeof parsed.userData === "string" && parsed.userData.trim()) {
      // Realpath, not the string: `userData` must be absolute and existing
      // before Electron resolves its own paths, and a typo here would silently
      // fall back to the operator's profile.
      E2E.userData = fs.realpathSync(parsed.userData);
    }
    if (parsed.showWindow === false) E2E.showWindow = false;
    const local = parsed.mcpPorts?.local;
    const invite = parsed.mcpPorts?.invite;
    if (typeof local === "number" || typeof invite === "number") {
      E2E.mcpPorts = {
        ...(typeof local === "number" ? { local } : {}),
        ...(typeof invite === "number" ? { invite } : {}),
      };
    }
    if (typeof parsed.updateFeedUrl === "string" && parsed.updateFeedUrl.trim()) {
      E2E.updateFeedUrl = parsed.updateFeedUrl;
    }
    // A rig cannot let the app launch a real installer, and cannot read an
    // assertion out of a process it did not start: the launcher is replaced by
    // one the rig owns, which records the file it was handed.
    if (
      parsed.updateLauncher &&
      typeof parsed.updateLauncher.exe === "string" &&
      parsed.updateLauncher.exe.trim()
    ) {
      E2E.updateLauncher = {
        exe: parsed.updateLauncher.exe,
        args: Array.isArray(parsed.updateLauncher.args)
          ? parsed.updateLauncher.args.filter(
              (arg): arg is string => typeof arg === "string",
            )
          : [],
      };
    }
    const hosts = parsed.updateTrust?.hosts;
    if (
      Array.isArray(hosts) &&
      hosts.length > 0 &&
      hosts.every((host): host is string => typeof host === "string")
    ) {
      E2E.updateTrust = {
        hosts,
        allowHttp: parsed.updateTrust?.allowHttp === true,
      };
    }
  } catch (err) {
    console.error("[e2e] LIFEQUEST_E2E is not valid JSON; ignoring:", err);
  }
}
if (E2E.userData) {
  app.setPath("userData", E2E.userData);
}
if (E2E.mcpPorts) {
  // Before any window or vault: a door binds with whatever is set here.
  setMcpPorts(E2E.mcpPorts);
}
if (E2E.updateFeedUrl) {
  setUpdateFeedUrl(E2E.updateFeedUrl);
}
if (typeof E2E.updateLauncher?.exe === "string") {
  setUpdateLauncher({
    exe: E2E.updateLauncher.exe,
    args: (E2E.updateLauncher.args as string[] | undefined) ?? [],
  });
}
if (E2E.updateTrust) {
  setUpdateTrustPolicy({
    hosts: E2E.updateTrust.hosts,
    allowHttp: E2E.updateTrust.allowHttp === true,
  });
}

const TITLEBAR_OVERLAY_HEIGHT = 32;
const DEFAULT_OVERLAY_COLOR = "#1a1917";
const DEFAULT_OVERLAY_SYMBOL = "#e8e4dc";

function usesTitleBarOverlay(): boolean {
  return process.platform === "win32" || process.platform === "linux";
}

function localIsoDate(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function windowFromEvent(event: { sender: Electron.WebContents }): BrowserWindow | null {
  return BrowserWindow.fromWebContents(event.sender);
}

function registerWindowAccelerators(win: BrowserWindow) {
  win.webContents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown") return;
    const ctrl = input.control || input.meta;
    const key = input.key.toLowerCase();

    if (ctrl && !input.alt && !input.shift && key === "r") {
      event.preventDefault();
      win.reload();
      return;
    }
    if (ctrl && input.shift && !input.alt && key === "i") {
      event.preventDefault();
      win.webContents.toggleDevTools();
      return;
    }
    if (input.key === "F12") {
      event.preventDefault();
      win.webContents.toggleDevTools();
      return;
    }
    if (input.key === "F11") {
      event.preventDefault();
      win.setFullScreen(!win.isFullScreen());
      return;
    }
    if (ctrl && !input.alt && !input.shift && key === "q") {
      event.preventDefault();
      app.quit();
    }
  });
}

/**
 * `ipcMain`, with the live-dashboard notice added.
 *
 * Every channel below is registered through this object rather than through
 * Electron's registrar directly, so "which channels announce a change" is one
 * list in `data-revision.ts` instead of a decision taken again at each of the
 * hundred-odd registration sites — and a channel added later is covered by
 * whatever that list says about it rather than by whether its author remembered.
 *
 * The notice is sent once a handler has settled, and only for a channel the list
 * names. Both of those are load-bearing. The filter, because a card's repaint
 * re-enters this same registrar to read (`view:runSaved`, `db:get`), so a READ
 * that announced a change would drive the cards to re-run for ever. And
 * "settled" rather than "resolved successfully": a handler that throws AFTER it
 * has written still changed the vault, and a board left showing the old numbers
 * because the write reported badly is the bug this exists to fix. The notice
 * carries no payload, so a spurious one costs a repaint and nothing else.
 *
 * `any` on the listener's arguments is deliberate. The handlers below take every
 * shape an IPC channel can carry, and Electron's own `handle` is typed the same
 * way; narrowing it here would make the registrar refuse the handlers it exists
 * to register.
 */
const ipcMain = {
  handle(
    channel: string,
    listener: (event: IpcMainInvokeEvent, ...args: any[]) => unknown,
  ): void {
    electronIpcMain.handle(channel, async (event, ...args: unknown[]) => {
      try {
        return await listener(event, ...args);
      } finally {
        if (channelMayChangeData(channel)) noteDataChanged();
      }
    });
  },
  on(channel: string, listener: (event: IpcMainEvent, ...args: any[]) => void): void {
    electronIpcMain.on(channel, listener);
  },
};

/**
 * Publish the vault's change signal to every open window.
 *
 * Coalesced to one message per frame: a single agent action can write several
 * times (a Decision that inserts twenty rows, a kit install that writes a
 * registry, pages, pins and a log line), and twenty messages would be twenty
 * repaints of the same board. One per frame is what the eye can see anyway.
 *
 * A window that is mid-teardown is skipped rather than awaited: the notice is
 * about a change that is already on disk, and the next window to open reads it.
 */
function startDataChangeBroadcast(): void {
  let pending: number | null = null;
  let flush: NodeJS.Timeout | null = null;
  const send = () => {
    flush = null;
    const revision = pending;
    pending = null;
    if (revision === null) return;
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send("vault:dataChanged", revision);
    }
  };
  onDataChanged((revision) => {
    pending = revision;
    if (flush === null) flush = setTimeout(send, 16);
  });
}

/**
 * The companion's status, pushed to whatever window is open when it moves.
 *
 * The status is not a launch-time constant any more: the model probe answers a
 * round-trip after the ready status is published, so "is this profile's model
 * still routable?" arrives late by design. Without this the renderer would keep
 * the first answer forever — which is exactly how the warning became
 * unreachable in the first place: the probe was broken, and even fixed, nothing
 * would have carried its verdict to the settings surface.
 *
 * Every window, because the status is the app's, not one window's: a second
 * window opened later reads `companion:status` for itself on mount.
 */
function startCompanionStatusBroadcast(): void {
  companion.onCompanionStatusChanged((status) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send("companion:statusChanged", status);
    }
  });
}

function registerIpcHandlers() {  ipcMain.handle("vault:create", (_e, rootPath: string, name?: string) =>
    vault.vaultCreate(rootPath, name),
  );
  ipcMain.handle("vault:open", async (_e, rootPath: string) => {
    const res = await vault.vaultOpen(rootPath);
    // The stored rate is stale the moment the app has been closed for an hour,
    // and a card drawn before the timer's first tick would show the old number
    // without saying so. A read on open is cheap and makes the first draw
    // correct; it is a refresh of a stored setting, not a Decision.
    if (res.ok) void refreshFxNow();
    return res;
  });
  ipcMain.handle("vault:getSnapshot", () => vault.vaultGetSnapshot());
  ipcMain.handle("vault:listRecent", () => vault.vaultListRecent());

  ipcMain.handle("dialog:openDirectory", async () => {
    const win = BrowserWindow.getFocusedWindow();
    const result = win
      ? await dialog.showOpenDialog(win, {
          properties: ["openDirectory", "createDirectory"],
        })
      : await dialog.showOpenDialog({
          properties: ["openDirectory", "createDirectory"],
        });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0] ?? null;
  });

  ipcMain.handle(
    "domain:create",
    (_e, input: { name: string; slug?: string }) => vault.domainCreate(input),
  );
  ipcMain.handle(
    "domain:update",
    (
      _e,
      slug: string,
      patch: Parameters<typeof vault.domainUpdate>[1],
    ) => vault.domainUpdate(slug, patch),
  );
  ipcMain.handle("domain:archive", (_e, slug: string) =>
    vault.domainArchive(slug),
  );
  ipcMain.handle("domain:unarchive", (_e, slug: string) =>
    vault.domainUnarchive(slug),
  );
  ipcMain.handle("domain:delete", (_e, slug: string) =>
    vault.domainDelete(slug),
  );
  ipcMain.handle("domain:setActive", (_e, slug: string | null) =>
    vault.domainSetActive(slug),
  );
  ipcMain.handle("domain:getActive", () => vault.domainGetActive());

  // KAR-55 domain databases
  ipcMain.handle("db:list", (_e, domainSlug: string | null) => vault.dbList(domainSlug));
  ipcMain.handle("db:get", (_e, slug: string, dbId: string) => vault.dbGet(slug, dbId));
  ipcMain.handle("db:create", (_e, slug: string, input: { name: string }) => vault.dbCreate(slug, input));
  ipcMain.handle("db:addColumn", (_e, slug: string, dbId: string, input: Parameters<typeof vault.dbAddColumn>[2]) => vault.dbAddColumn(slug, dbId, input));
  ipcMain.handle("db:listRows", (_e, slug: string, dbId: string) => vault.dbListRows(slug, dbId));
  ipcMain.handle("db:getRow", (_e, slug: string, dbId: string, rowId: string) => vault.dbGetRow(slug, dbId, rowId));
  ipcMain.handle("db:upsertRow", (_e, slug: string, dbId: string, input: { id?: string; cells: Record<string, unknown> }) => vault.dbUpsertRow(slug, dbId, input));
  ipcMain.handle("db:deleteRow", (_e, slug: string, dbId: string, rowId: string) => vault.dbDeleteRow(slug, dbId, rowId));
  ipcMain.handle("db:fileSave", (_e, slug: string, input: { bytes: Uint8Array; mime: string; name: string }) => vault.dbFileSave(slug, input));
  // The composer's receipt. The original is written here, before the turn that
  // scans it is ever posted, so the row always points at bytes on disk.
  ipcMain.handle(
    "receipt:attach",
    (_e, input: { bytes: Uint8Array; mime: string; name: string }) =>
      vault.receiptAttach(input),
  );

  // KAR-58 books export and restore
  ipcMain.handle("db:exportBooks", (_e, slug: string) => vault.dbExportBooks(slug));
  ipcMain.handle("db:restoreBooks", (_e, slug: string, options: { confirm: boolean }) => vault.dbRestoreBooks(slug, options));

  // KAR-59 adapter IPC
  ipcMain.handle("db:linkAdapter", (_e, slug: string, dbId: string, input: Parameters<typeof vault.dbLinkAdapter>[2]) => vault.dbLinkAdapter(slug, dbId, input));
  ipcMain.handle("db:unlinkAdapter", (_e, slug: string, dbId: string) => vault.dbUnlinkAdapter(slug, dbId));
  ipcMain.handle("db:sync", (_e, slug: string, dbId?: string) => vault.dbSync(slug, dbId));
  ipcMain.handle("db:listConflicts", (_e, slug: string, dbId?: string) => vault.dbListConflicts(slug, dbId));
  ipcMain.handle("db:resolveConflict", (_e, slug: string, conflictId: string, choice: string) => vault.dbResolveConflict(slug, conflictId, choice as "keep-local" | "keep-remote" | "skip"));

  // KAR-60 pages and pins
  ipcMain.handle("page:list", (_e, domainSlug: string | null) => vault.pageList(domainSlug));
  ipcMain.handle("page:get", (_e, slug: string, pageId: string) => vault.pageGet(slug, pageId));
  ipcMain.handle("page:create", (_e, slug: string, input: { title: string }) => vault.pageCreate(slug, input));
  ipcMain.handle("page:update", (_e, slug: string, pageId: string, input: { title?: string; blocks?: Parameters<typeof vault.pageUpdate>[2]["blocks"] }) => vault.pageUpdate(slug, pageId, input));
  ipcMain.handle("page:delete", (_e, slug: string, pageId: string) => vault.pageDelete(slug, pageId));
  // KAR-56 script blocks
  ipcMain.handle("script:apply", (_e, input: { domainSlug: string; pageId: string; blockId?: string; name: string; source: string }) => vault.scriptApply(input));
  ipcMain.handle("script:run", (_e, input: { domainSlug: string; source: string }) => vault.scriptRun(input));
  ipcMain.handle("pins:list", (_e, domainSlug: string | null) => vault.pinsList(domainSlug));
  ipcMain.handle("pins:set", (_e, domainSlug: string | null, pins: Parameters<typeof vault.pinsSet>[1]) => vault.pinsSet(domainSlug, pins));
  // The Dashboard page lock: the board read reports it, and this is the only
  // write that changes it. It rides the user actor, so an agent tool can never
  // unlock a board to get around the gate.
  ipcMain.handle("pins:setLocked", (_e, domainSlug: string | null, locked: boolean) => vault.pinsSetLocked(domainSlug, locked));
  // KAR-V: agent-built dashboard views
  ipcMain.handle("view:list", (_e, slug: string) => vault.viewList(slug));
  ipcMain.handle("view:get", (_e, slug: string, viewId: string) => vault.viewGet(slug, viewId));
  ipcMain.handle("view:save", (_e, slug: string, spec: Parameters<typeof vault.viewSave>[1], viewId?: string) => vault.viewSave(slug, spec, viewId));
  ipcMain.handle("view:delete", (_e, slug: string, viewId: string) => vault.viewDelete(slug, viewId));
  ipcMain.handle("view:run", (_e, slug: string, spec: Parameters<typeof vault.viewRun>[1]) => vault.viewRun(slug, spec));
  ipcMain.handle("view:runSaved", (_e, slug: string, viewId: string) => vault.viewRunSaved(slug, viewId));

  // KAR-53 ingest
  ipcMain.handle("ingest:file", (_e, slug: string, input: { databaseId: string; bytes: Uint8Array; mime: string; name: string; extractedRows?: Record<string, string>[] }) => vault.ingestFile(slug, input));
  ipcMain.handle("ingest:proposeMapping", (_e, slug: string, input: Parameters<typeof vault.ingestProposeMapping>[1]) => vault.ingestProposeMapping(slug, input));
  ipcMain.handle("ingest:listMappings", (_e, slug: string, databaseId?: string) => vault.ingestListMappings(slug, databaseId));
  ipcMain.handle("ingest:listBatches", (_e, slug: string, databaseId?: string) => vault.ingestListBatches(slug, databaseId));
  ipcMain.handle("ingest:listRows", (_e, slug: string, batchId: string) => vault.ingestListRows(slug, batchId));
  ipcMain.handle("ingest:editRow", (_e, slug: string, batchId: string, rowId: string, cells: Record<string, unknown>) => vault.ingestEditRow(slug, batchId, rowId, cells));
  ipcMain.handle("ingest:accept", (_e, slug: string, batchId: string, rowIds?: string[]) => vault.ingestAccept(slug, batchId, rowIds));
  ipcMain.handle("ingest:reject", (_e, slug: string, batchId: string, rowIds?: string[]) => vault.ingestReject(slug, batchId, rowIds));

  ipcMain.handle(
    "document:get",
    (_e, slug: string, kind: Parameters<typeof vault.documentGet>[1]) =>
      vault.documentGet(slug, kind),
  );
  ipcMain.handle(
    "document:save",
    (
      _e,
      slug: string,
      kind: Parameters<typeof vault.documentSave>[1],
      bodyMarkdown: string,
      title?: string,
    ) => vault.documentSave(slug, kind, bodyMarkdown, title),
  );
  ipcMain.handle(
    "document:setLocked",
    (
      _e,
      slug: string,
      kind: Parameters<typeof vault.documentSetLocked>[1],
      locked: Parameters<typeof vault.documentSetLocked>[2],
    ) => vault.documentSetLocked(slug, kind, locked),
  );
  ipcMain.handle(
    "library:setLocked",
    (_e, id: string, locked: boolean) => vault.librarySetLocked(id, locked),
  );
  ipcMain.handle(
    "document:mediaSave",
    (
      _e,
      slug: string,
      input: { bytes: Uint8Array; mime: string },
    ) => vault.documentMediaSave(slug, input),
  );
  ipcMain.handle(
    "document:mediaRead",
    (_e, slug: string, relPath: string) =>
      vault.documentMediaRead(slug, relPath),
  );

  // KAR-61 finance kit
  ipcMain.handle("kit:installFinance", () => vault.kitInstallFinance());
  ipcMain.handle("kit:list", (_e, slug: string) => vault.kitList(slug));
  ipcMain.handle("kit:financeSettings", () => vault.kitFinanceSettings());
  ipcMain.handle("kit:setCaptureAccount", (_e, accountRowId: string | null) => vault.kitSetCaptureAccount(accountRowId));

  // The USD→ZAR rate: read in the MAIN process, never in the renderer, so a
  // source the operator pastes is reached by the app's own network access and
  // the rate lands in the vault whatever window is open.
  ipcMain.handle("fx:refresh", () => vault.fxRateRefresh());
  ipcMain.handle(
    "fx:setSource",
    (_e, input: { url?: string | null; path?: string | null; asOfPath?: string | null }) =>
      vault.fxSetSource(input),
  );

  // KAR-57 finance plan loop
  ipcMain.handle("finance:budgetVsActual", (_e, asOf: string) => vault.financeBudgetVsActual(asOf));
  ipcMain.handle("finance:netWorth", (_e, asOf: string) => vault.financeNetWorth(asOf));
  ipcMain.handle("finance:scenarioCompare", (_e, input: { asOf: string; assumptionSetId: string; compareSetId?: string | null }) => vault.financeScenarioCompare(input));
  ipcMain.handle("finance:saveAssumptionSet", (_e, input: Parameters<typeof vault.financeSaveAssumptionSet>[0]) => vault.financeSaveAssumptionSet(input));

  ipcMain.handle("decision:list", () => vault.decisionList());
  ipcMain.handle(
    "decision:create",
    (_e, input: Parameters<typeof vault.decisionCreate>[0]) =>
      vault.decisionCreate(input),
  );
  ipcMain.handle(
    "decision:resolve",
    (_e, id: string, resolution: "approved" | "rejected") =>
      vault.decisionResolve(id, resolution),
  );

  // The operator's own decisions: logged, not proposed. A create is a write that
  // changes History, so `data-revision.ts` names the channel above.
  ipcMain.handle("manualDecision:list", () => vault.manualDecisionList());
  ipcMain.handle(
    "manualDecision:create",
    (_e, input: Parameters<typeof vault.manualDecisionCreate>[0]) =>
      vault.manualDecisionCreate(input),
  );

  ipcMain.handle("log:list", () => vault.logList());

  ipcMain.handle("signalChain:list", () => vault.signalChainList());
  ipcMain.handle(
    "signalChain:create",
    (_e, input: Parameters<typeof vault.signalChainCreate>[0]) =>
      vault.signalChainCreate(input),
  );
  ipcMain.handle(
    "signalChain:update",
    (
      _e,
      id: string,
      patch: Parameters<typeof vault.signalChainUpdate>[1],
    ) => vault.signalChainUpdate(id, patch),
  );
  ipcMain.handle("signalChain:delete", (_e, id: string) =>
    vault.signalChainDelete(id),
  );

  ipcMain.handle("library:list", () => vault.libraryListCall());
  ipcMain.handle(
    "library:create",
    (_e, input: Parameters<typeof vault.libraryCreateCall>[0]) =>
      vault.libraryCreateCall(input),
  );
  ipcMain.handle("library:get", (_e, id: string) => vault.libraryGetCall(id));
  ipcMain.handle(
    "library:update",
    (
      _e,
      id: string,
      patch: Parameters<typeof vault.libraryUpdateCall>[1],
    ) => vault.libraryUpdateCall(id, patch),
  );
  ipcMain.handle("library:delete", (_e, id: string) =>
    vault.libraryDeleteCall(id),
  );

  // KAR-7 projects: direct operator writes, no Decision.
  ipcMain.handle("projects:list", () => vault.projectsList());
  ipcMain.handle("projects:get", (_e, id: string) => vault.projectsGet(id));
  ipcMain.handle(
    "projects:create",
    (_e, input: Parameters<typeof vault.projectsCreate>[0]) =>
      vault.projectsCreate(input),
  );
  ipcMain.handle(
    "projects:update",
    (
      _e,
      id: string,
      patch: Parameters<typeof vault.projectsUpdate>[1],
    ) => vault.projectsUpdate(id, patch),
  );

  ipcMain.handle("agents:list", () => vault.agentsList());
  ipcMain.handle(
    "agents:hire",
    (_e, input: Parameters<typeof vault.agentsHire>[0]) =>
      vault.agentsHire(input),
  );
  ipcMain.handle("agents:dismiss", (_e, id: string) =>
    vault.agentsDismiss(id),
  );

  ipcMain.handle(
    "settings:update",
    (_e, patch: Parameters<typeof vault.settingsUpdate>[0]) =>
      vault.settingsUpdate(patch),
  );

  ipcMain.handle("secrets:hasHermesKey", () => vault.secretsHasHermesKey());
  ipcMain.handle("secrets:setHermesKey", (_e, key: string) =>
    vault.secretsSetHermesKey(key),
  );
  ipcMain.handle("secrets:clearHermesKey", () =>
    vault.secretsClearHermesKey(),
  );

  ipcMain.handle("hermes:test", () => vault.hermesTestCall());
  ipcMain.handle(
    "hermes:chat",
    (_e, messages: { role: string; content: string }[]) =>
      vault.hermesChatCall(messages),
  );
  ipcMain.handle("hermes:scanAgents", () => vault.hermesScanAgentsCall());
  ipcMain.handle(
    "hermes:chatTools",
    (
    _e,
    messages: { role: string; content: string }[],
    hire?: { id: string; name: string },
  ) => vault.hermesChatToolsCall(messages, hire),
  );

  ipcMain.handle("mcp:getUrl", () => vault.getMcpUrl());
  ipcMain.handle("mcp:getError", () => vault.getMcpError());
  // KAR-70: both doors, each with its own bind error.
  ipcMain.handle("mcp:getDoors", () => vault.getMcpDoorState());

  ipcMain.handle("connectedAgents:list", () =>
    vault.connectedAgentsList(),
  );
  ipcMain.handle(
    "connectedAgents:update",
    (
    _e,
    id: string,
    patch: { access?: "read" | "write"; domainSlugs?: string[]; schedule?: boolean },
  ) => vault.connectedAgentsUpdate(typeof id === "string" ? id : "", patch),
  );
  ipcMain.handle("connectedAgents:revoke", (_e, id: string) =>
    vault.connectedAgentsRevoke(typeof id === "string" ? id : ""),
  );
  ipcMain.handle("connectedAgents:invite", () =>
    vault.connectedAgentsInvite(),
  );
  ipcMain.handle("connectedAgents:listInvites", () =>
    vault.connectedAgentsListInvites(),
  );
  ipcMain.handle("connectedAgents:dropInvite", (_e, id: string) =>
    vault.connectedAgentsDropInvite(typeof id === "string" ? id : ""),
  );

  ipcMain.handle("companion:ensure", () => companion.companionEnsure());
  ipcMain.handle("companion:status", () => companion.companionStatus());
  // The profile picker: every installed Hermes profile, and the switch that
  // moves the companion onto one (or creates the app's own `lifequest`).
  ipcMain.handle("companion:profilesList", () => companion.companionProfilesList());
  ipcMain.handle("companion:useProfile", (_e, name: string) =>
    companion.companionUseProfile(typeof name === "string" ? name : ""),
  );
  ipcMain.handle("companion:sessionsList", () => companion.companionSessionsList());
  ipcMain.handle("companion:sessionCreate", (_e, title: string) =>
    companion.companionSessionCreate(typeof title === "string" ? title : ""),
  );
  ipcMain.handle("companion:sessionMessages", (_e, id: string) =>
    companion.companionSessionMessages(id),
  );
  ipcMain.handle(
    "companion:sessionPatch",
    (
      _e,
      id: string,
      patch: { title?: string; pinned?: boolean; archived?: boolean },
    ) =>
      companion.companionSessionPatch(
        typeof id === "string" ? id : "",
        patch && typeof patch === "object" ? patch : {},
      ),
  );
  ipcMain.handle("companion:sessionDelete", (_e, id: string) =>
    companion.companionSessionDelete(typeof id === "string" ? id : ""),
  );
  ipcMain.handle("companion:modelOptions", () =>
    companion.companionModelOptions(),
  );
  ipcMain.handle(
    "companion:chatStream",
    async (
      event,
      payload: {
        sessionId: string;
        input: string;
        instructionsContext: CompanionInstructionsInput;
        /** The composer's model / thinking-level pick for this turn. */
        runtime?: CompanionRuntimeOverride | null;
        /** The pending receipt this turn carries, named by the path main minted. */
        receiptRelPath?: string | null;
      },
    ) => {
      return vault.companionChatStreamWithPack(
        payload.sessionId,
        payload.input,
        payload.instructionsContext,
        (evt) => {
          if (!event.sender.isDestroyed()) {
            // Every frame names the chat it belongs to. The renderer keeps more
            // than one turn in the air at a time, so the channel is a single
            // wire carrying many conversations — an untagged delta would be
            // folded into whichever thread happened to be open.
            event.sender.send("companion:stream", {
              sessionId: payload.sessionId,
              event: evt,
            });
          }
        },
        payload.runtime ?? null,
        payload.receiptRelPath ?? null,
      );
    },
  );
  ipcMain.handle(
    "companion:approval",
    (_e, payload: { runId: string; requestId: string; allow: boolean }) =>
      companion.companionApproval(payload.runId, payload.requestId, payload.allow),
  );
  ipcMain.handle("companion:runStop", (_e, runId: string) =>
    companion.companionRunStop(runId),
  );
  ipcMain.handle("companion:openProfileFolder", () =>
    companion.companionOpenProfileFolder(),
  );
  ipcMain.handle("companion:getFiling", () => getFileUnsolicited());
  ipcMain.handle("companion:setFiling", (_e, enabled: boolean) =>
    setFileUnsolicited(enabled),
  );
  // What the companion is told and what it has been given to read: the profile's
  // SOUL, the per-turn instructions this app builds, and the skill library.
  ipcMain.handle("companion:prompts", () => companion.companionPrompts());

  ipcMain.handle("map:getState", () => vault.mapGetState());
  ipcMain.handle("map:apply", (_e, command: Parameters<typeof vault.mapApply>[0]) =>
    vault.mapApply(command, "user"),
  );
  ipcMain.handle("goals:apply", (_e, command: Parameters<typeof vault.goalsApply>[0]) =>
    vault.goalsApply(command),
  );
  ipcMain.handle("automation:list", () => vault.automationList());
  ipcMain.handle("automation:create", (_e, input: unknown) =>
    vault.automationCreate(input),
  );
  ipcMain.handle(
    "automation:update",
    (_e, id: string, input: unknown) =>
      vault.automationUpdate(typeof id === "string" ? id : "", input),
  );
  ipcMain.handle("automation:delete", (_e, id: string) =>
    vault.automationDelete(typeof id === "string" ? id : ""),
  );
  ipcMain.handle(
    "automation:markRun",
    (_e, id: string, patch: Parameters<typeof vault.automationMarkRun>[1]) =>
      vault.automationMarkRun(typeof id === "string" ? id : "", patch),
  );

  ipcMain.handle(
    "review:get",
    (_e, cadence: Parameters<typeof vault.reviewGet>[0], period: string) =>
      vault.reviewGet(cadence, period),
  );
  ipcMain.handle(
    "review:ensure",
    (
      _e,
      cadence: Parameters<typeof vault.reviewEnsure>[0],
      period: string,
      scope: Parameters<typeof vault.reviewEnsure>[2],
    ) => vault.reviewEnsure(cadence, period, scope),
  );
  ipcMain.handle(
    "review:write",
    (
      _e,
      cadence: Parameters<typeof vault.reviewWrite>[0],
      period: string,
      body: string,
    ) => vault.reviewWrite(cadence, period, body),
  );
  ipcMain.handle(
    "review:markDone",
    (
      _e,
      cadence: Parameters<typeof vault.reviewMarkDone>[0],
      period: string,
      scope: Parameters<typeof vault.reviewMarkDone>[2],
    ) => vault.reviewMarkDone(cadence, period, scope),
  );
  ipcMain.handle(
    "review:unlock",
    (_e, cadence: Parameters<typeof vault.reviewUnlock>[0], period: string) =>
      vault.reviewUnlock(cadence, period),
  );
  ipcMain.handle(
    "review:periodPack",
    (
      _e,
      cadence: Parameters<typeof vault.reviewPeriodPack>[0],
      period: string,
      scope: Parameters<typeof vault.reviewPeriodPack>[2],
    ) => vault.reviewPeriodPack(cadence, period, scope),
  );
  // Daily notes: the operator's one note for a day, read and written here.
  ipcMain.handle("note:get", (_e, date: string) => vault.dailyNoteGet(date));
  ipcMain.handle("note:write", (_e, date: string, body: string) =>
    vault.dailyNoteWrite(date, body),
  );
  ipcMain.handle("note:list", () => vault.dailyNoteList());
  ipcMain.handle("note:window", (_e, start: string, end: string) =>
    vault.dailyNoteWindow(start, end),
  );
  // Ideal State: any number of titled, freeform documents under Define.
  ipcMain.handle("ideal-state:list", () => vault.idealStateList());
  ipcMain.handle("ideal-state:get", (_e, id: string) =>
    vault.idealStateGet(id),
  );
  ipcMain.handle(
    "ideal-state:create",
    (_e, input: Parameters<typeof vault.idealStateCreate>[0]) =>
      vault.idealStateCreate(input),
  );
  ipcMain.handle(
    "ideal-state:update",
    (_e, id: string, patch: Parameters<typeof vault.idealStateUpdate>[1]) =>
      vault.idealStateUpdate(id, patch),
  );
  ipcMain.handle("ideal-state:delete", (_e, id: string) =>
    vault.idealStateDelete(id),
  );
  // A cadence's standing review rules, and the snapshot pass the review page
  // runs before it asks the agent for anything.
  ipcMain.handle(
    "review:skillGet",
    (_e, cadence: Parameters<typeof vault.reviewSkillGet>[0]) =>
      vault.reviewSkillGet(cadence),
  );
  ipcMain.handle(
    "review:skillWrite",
    (
      _e,
      cadence: Parameters<typeof vault.reviewSkillWrite>[0],
      markdown: string,
    ) => vault.reviewSkillWrite(cadence, markdown),
  );
  ipcMain.handle(
    "review:prepopulate",
    (
      _e,
      cadence: Parameters<typeof vault.reviewPrepopulate>[0],
      period: string,
      scope: Parameters<typeof vault.reviewPrepopulate>[2],
    ) => vault.reviewPrepopulate(cadence, period, scope),
  );
  ipcMain.handle(
    "planning:ensure",
    (
      _e,
      cadence: Parameters<typeof vault.planningEnsure>[0],
      period: string,
      scope: Parameters<typeof vault.planningEnsure>[2],
    ) => vault.planningEnsure(cadence, period, scope),
  );
  ipcMain.handle(
    "review:startOrResume",
    (
      _e,
      cadence: Parameters<typeof vault.reviewStartOrResume>[0],
      period: string,
      scope: Parameters<typeof vault.reviewStartOrResume>[2],
    ) => vault.reviewStartOrResume(cadence, period, scope),
  );
  ipcMain.handle(
    "planning:startOrResume",
    (
      _e,
      cadence: Parameters<typeof vault.planningStartOrResume>[0],
      period: string,
      scope: Parameters<typeof vault.planningStartOrResume>[2],
    ) => vault.planningStartOrResume(cadence, period, scope),
  );

  ipcMain.handle("deadline:dismiss", async (_e) => {
    const vaultId = vault.getCurrentVaultId();
    if (!vaultId) return { ok: false, error: "No vault is open" };
    await setDeadlineDismissedOn(vaultId);
    return { ok: true };
  });

  ipcMain.handle("deadline:getDismissed", async () => {
    const vaultId = vault.getCurrentVaultId();
    if (!vaultId) return { ok: true, value: null };
    const dismissedOn = await getDeadlineDismissedOn(vaultId);
    return { ok: true, value: dismissedOn };
  });

  ipcMain.handle("deadline:maybeNotify", async () => {
    const vaultId = vault.getCurrentVaultId();
    if (!vaultId) return { ok: false, error: "No vault is open" };
    const snap = await vault.vaultGetSnapshot();
    if (!snap.ok || !snap.value) return { ok: false, error: "Snapshot unavailable" };
    const today = localIsoDate();
    const dismissed = await getDeadlineDismissedOn(vaultId);
    if (dismissed === today) return { ok: true, notified: false };
    const notified = await getDeadlineNotifiedOn(vaultId);
    if (notified === today) return { ok: true, notified: false };
    const pressured = deadlinePressureGoals(snap.value.goals, today)
      .sort((a, b) => daysUntilDeadline(a.deadline, today) - daysUntilDeadline(b.deadline, today));
    if (pressured.length === 0) return { ok: true, notified: false };
    await setDeadlineNotifiedOn(vaultId);
    const soonest = pressured[0];
    const days = daysUntilDeadline(soonest.deadline, today);
    const body = days < 0
      ? `${soonest.name} — overdue`
      : days === 0
        ? `${soonest.name} — due today`
        : `${soonest.name} — due in ${days} days`;
    const title = pressured.length > 1
      ? `LifeQuest: ${pressured.length} deadlines approaching`
      : `LifeQuest: deadline pressure`;
    if (Notification.isSupported()) {
      new Notification({ title, body }).show();
    }
    return { ok: true, notified: true, title, body };
  });

  // —— auto-update ——————————————————————————————————————————————————————————
  // `update:check` is the launch's one call; `force` is the operator asking by
  // hand — the rail's build number, or Settings → Updates. Progress is pushed,
  // not polled: a download reports itself as it arrives.
  ipcMain.handle(
    "update:check",
    (_e, options?: { force?: boolean }) =>
      checkForUpdate({ force: options?.force === true }),
  );
  ipcMain.handle("update:install", (event, asset: unknown) => {
    const win = windowFromEvent(event);
    return installUpdate(asset, (progress) => {
      if (win && !win.isDestroyed()) {
        win.webContents.send("update:progress", progress);
      }
    });
  });
  ipcMain.handle("update:openReleasePage", async (_e, url: string) => {
    // The renderer chooses the url, so it is checked here: this opens the
    // operator's own browser, and the only page the app has any business
    // opening on its behalf is the release it just told them about.
    if (!/^https:\/\/(www\.)?github\.com\//i.test(url)) {
      return { ok: false as const, error: "Only GitHub release pages are opened." };
    }
    try {
      await shell.openExternal(url);
    } catch (error) {
      return {
        ok: false as const,
        error: error instanceof Error ? error.message : String(error),
      };
    }
    return { ok: true as const, value: true as const };
  });

  ipcMain.handle("window:getChrome", () => ({
    overlay: usesTitleBarOverlay(),
    platform: process.platform,
  }));
  ipcMain.handle(
    "window:setTitleBarOverlay",
    (event, opts: { color: string; symbolColor: string }) => {
      const win = windowFromEvent(event);
      if (!win || win.isDestroyed()) return;
      try {
        win.setTitleBarOverlay({
          color: opts.color,
          symbolColor: opts.symbolColor,
          height: TITLEBAR_OVERLAY_HEIGHT,
        });
      } catch {
        // Overlay unsupported on this window (e.g. macOS).
      }
    },
  );
  ipcMain.handle("window:isMaximized", (event) => {
    return windowFromEvent(event)?.isMaximized() ?? false;
  });
  ipcMain.on("window:minimize", (event) => {
    windowFromEvent(event)?.minimize();
  });
  ipcMain.on("window:close", (event) => {
    windowFromEvent(event)?.close();
  });
  ipcMain.on("window:toggleMaximize", (event) => {
    const win = windowFromEvent(event);
    if (!win || win.isDestroyed()) return;
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
  });
}

/**
 * The app's one window, published for the e2e seam.
 *
 * `bootForE2e` must hand back the window the PRODUCT created, not a second one:
 * a rig that opened its own would be testing its own boot rather than the app's.
 * `bootForE2e` also has to be safe to call after `app.whenReady()` has already
 * run the product's boot — registering the ipc handlers twice throws — so the
 * handlers are registered once behind this latch.
 */
let ipcRegistered = false;
let windowReady: Promise<BrowserWindow> | null = null;

/**
 * Boot the app for a caller other than the packaged entry point.
 *
 * The e2e seam at the top of this file isolates the profile; this gives a rig a
 * supported way to run the SAME ipc handlers and the SAME window the product
 * runs, instead of re-implementing them and testing a copy.
 */
export async function bootForE2e(): Promise<BrowserWindow> {
  await app.whenReady();
  if (!ipcRegistered) {
    ipcRegistered = true;
    registerIpcHandlers();
  }
  if (windowReady) return windowReady;
  windowReady = createWindow();
  return windowReady;
}

async function createWindow() {
  const overlay = usesTitleBarOverlay();
  const win = new BrowserWindow({    width: 1280,
    height: 800,
    titleBarStyle: "hidden",
    ...(overlay
      ? {
          titleBarOverlay: {
            color: DEFAULT_OVERLAY_COLOR,
            symbolColor: DEFAULT_OVERLAY_SYMBOL,
            height: TITLEBAR_OVERLAY_HEIGHT,
          },
        }
      : {}),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (process.platform !== "darwin") {
    win.removeMenu();
  }
  registerWindowAccelerators(win);
  // Hidden only for an e2e rig that asked for it, and applied after Electron
  // has already shown the window during load (see the E2E block at the top).
  if (!E2E.showWindow) {
    win.hide();
  }

  const sendMaximized = () => {
    if (win.isDestroyed()) return;
    win.webContents.send("window:maximizeChanged", win.isMaximized());
  };
  win.on("maximize", sendMaximized);
  win.on("unmaximize", sendMaximized);

  // External edits: on focus, re-stat doctrine files and notify renderer.
  // Channel name matches preload.ts (`vault:fileChanged`).
  //
  // Focus also announces a data change unconditionally, which is the app's
  // catch-all: the vault is a folder the operator syncs, opens in other tools,
  // and lets the companion write to with tools this process never sees. Coming
  // back to the window is the moment to re-read the numbers — the same thing a
  // spreadsheet does when you return to it — and one repaint of the visible
  // cards per focus is a price worth paying for never showing a stale figure.
  win.on("focus", () => {
    noteDataChanged();
    void (async () => {
      try {
        const changes = await vault.detectExternalDoctrineChanges();
        if (win.isDestroyed() || changes.length === 0) return;
        for (const change of changes) {
          win.webContents.send("vault:fileChanged", change);
        }
      } catch {
        // Ignore focus-check failures (e.g. vault mid-close).
      }
    })();
  });

  if (isDev) {
    const devUrl = process.env.VITE_DEV_SERVER_URL ?? "http://localhost:5173";
    await win.loadURL(devUrl);
  } else {
    await win.loadFile(path.join(__dirname, "../dist/index.html"));
  }
  return win;
}

/**
 * The USD→ZAR rate, refreshed every hour while the app is open.
 *
 * A timer rather than a fetch on each draw: a card re-runs its spec every time it
 * is drawn, and a rate that was read once an hour is the same fact for every card
 * on the board and every conversion in a report. It is also the only shape that
 * works with no window open at all.
 *
 * Two things it deliberately does NOT do. It does not fire when no vault is open
 * — there is nowhere to write — and it does not fire again while the previous
 * read is still in flight, because an hourly timer that overlaps itself on a slow
 * source would queue reads faster than they finish.
 */
const FX_REFRESH_MS = 60 * 60 * 1000;
let fxRefreshing = false;
let fxTimer: NodeJS.Timeout | null = null;

async function refreshFxNow(): Promise<void> {
  if (fxRefreshing || !vault.fxVaultOpen()) return;
  fxRefreshing = true;
  try {
    const res = await vault.fxRateRefresh();
    // A vault with no finance kit is the normal case, not an error worth
    // shouting about: the loop simply has nothing to refresh.
    if (res.ok && res.value && (res.value as { refreshed?: boolean }).refreshed) {
      console.log(`[fx] USD→ZAR ${(res.value as { rate?: number }).rate} as of ${(res.value as { asOf?: string }).asOf}`);
      // The rate is what every USD amount on the board is worth: a new one moves
      // the numbers on cards that no row write will ever touch. A refresh that
      // changed nothing announces nothing, so an idle vault stays quiet.
      noteDataChanged();
    }
  } catch {
    // A refresh must never take the app down; the failure is recorded in the
    // vault by `refreshFxRate` and read back by the Settings surface.
  } finally {
    fxRefreshing = false;
  }
}

function startFxRefreshLoop(): void {
  if (fxTimer) return;
  fxTimer = setInterval(() => void refreshFxNow(), FX_REFRESH_MS);
}

/** Exported for the e2e seam: a rig should not wait an hour to see a refresh. */
export async function fxRefreshForE2e(): Promise<void> {
  await refreshFxNow();
}

app.whenReady().then(() => {
  if (!ipcRegistered) {
    ipcRegistered = true;
    registerIpcHandlers();
  }
  // Before any window exists, so the first write of the session already has
  // somewhere to go. Subscribing once is enough: the broadcast walks whatever
  // windows are open at the moment a change is noted, so a window opened later
  // is covered without re-subscribing.
  startDataChangeBroadcast();
  // Armed with it, and for the same reason: the probe's verdict is published
  // ~0.6s after the ready status, and a window that opened first must still
  // hear it.
  startCompanionStatusBroadcast();
  // Published before it is awaited, so a rig that calls `bootForE2e` while the
  // product's own boot is still loading joins that window instead of opening a
  // second one.
  windowReady = createWindow();
  void windowReady;
  // The rate is read on a clock, not on a draw, so it is armed once here rather
  // than wherever a card happens to be rendered.
  startFxRefreshLoop();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", (event) => {
  event.preventDefault();
  void companion
    .companionShutdown()
    .finally(() => stopMcp())
    .finally(() => app.exit(0));
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    void createWindow();
  }
});
