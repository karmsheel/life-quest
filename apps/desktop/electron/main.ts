import { app, BrowserWindow, dialog, ipcMain, Notification } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { stopMcp } from "./mcp-server.js";
import * as companion from "./companion.js";
import type { CompanionInstructionsInput } from "./companion-client.js";
import * as vault from "./vault-service.js";
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

function registerIpcHandlers() {
  ipcMain.handle("vault:create", (_e, rootPath: string, name?: string) =>
    vault.vaultCreate(rootPath, name),
  );
  ipcMain.handle("vault:open", (_e, rootPath: string) =>
    vault.vaultOpen(rootPath),
  );
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
  ipcMain.handle("domain:setActive", (_e, slug: string | null) =>
    vault.domainSetActive(slug),
  );
  ipcMain.handle("domain:getActive", () => vault.domainGetActive());

  // KAR-55 domain databases
  ipcMain.handle("db:list", (_e, domainSlug: string | null) => vault.dbList(domainSlug));
  ipcMain.handle("db:get", (_e, slug: string, dbId: string) => vault.dbGet(slug, dbId));
  ipcMain.handle("db:create", (_e, slug: string, input: { name: string }) => vault.dbCreate(slug, input));
  ipcMain.handle("db:addColumn", (_e, slug: string, dbId: string, input: { name: string; type: string; options?: string[]; relationDatabaseId?: string }) => vault.dbAddColumn(slug, dbId, input));
  ipcMain.handle("db:listRows", (_e, slug: string, dbId: string) => vault.dbListRows(slug, dbId));
  ipcMain.handle("db:getRow", (_e, slug: string, dbId: string, rowId: string) => vault.dbGetRow(slug, dbId, rowId));
  ipcMain.handle("db:upsertRow", (_e, slug: string, dbId: string, input: { id?: string; cells: Record<string, unknown> }) => vault.dbUpsertRow(slug, dbId, input));
  ipcMain.handle("db:deleteRow", (_e, slug: string, dbId: string, rowId: string) => vault.dbDeleteRow(slug, dbId, rowId));
  ipcMain.handle("db:fileSave", (_e, slug: string, input: { bytes: Uint8Array; mime: string; name: string }) => vault.dbFileSave(slug, input));

  // KAR-58 books export and restore
  ipcMain.handle("db:exportBooks", (_e, slug: string) => vault.dbExportBooks(slug));
  ipcMain.handle("db:restoreBooks", (_e, slug: string, options: { confirm: boolean }) => vault.dbRestoreBooks(slug, options));

  // KAR-59 adapter IPC
  ipcMain.handle("db:linkAdapter", (_e, slug: string, dbId: string, input: { kind: string; bindingId?: string; secret: string; sotMode: string }) => vault.dbLinkAdapter(slug, dbId, input));
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

  // KAR-53 ingest
  ipcMain.handle("ingest:file", (_e, slug: string, input: { databaseId: string; bytes: Uint8Array; mime: string; name: string; extractedRows?: Record<string, string>[] }) => vault.ingestFile(slug, input));
  ipcMain.handle("ingest:proposeMapping", (_e, slug: string, input: { mappingId?: string; databaseId: string; fingerprint: string; sourceKind: string; columns: Array<{ source: string; columnId: string }> }) => vault.ingestProposeMapping(slug, input));
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

  // KAR-57 finance plan loop
  ipcMain.handle("finance:budgetVsActual", (_e, asOf: string) => vault.financeBudgetVsActual(asOf));
  ipcMain.handle("finance:netWorth", (_e, asOf: string) => vault.financeNetWorth(asOf));
  ipcMain.handle("finance:scenarioCompare", (_e, input: { asOf: string; assumptionSetId: string; compareSetId?: string | null }) => vault.financeScenarioCompare(input));
  ipcMain.handle("finance:saveAssumptionSet", (_e, input: { rowId: string; name: string; horizonMonths: number; deltas: unknown[] }) => vault.financeSaveAssumptionSet(input));

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
    (_e, messages: { role: string; content: string }[]) =>
      vault.hermesChatToolsCall(messages),
  );

  ipcMain.handle("mcp:getUrl", () => vault.getMcpUrl());
  ipcMain.handle("mcp:getError", () => vault.getMcpError());

  ipcMain.handle("companion:ensure", () => companion.companionEnsure());
  ipcMain.handle("companion:status", () => companion.companionStatus());
  ipcMain.handle("companion:sessionsList", () => companion.companionSessionsList());
  ipcMain.handle("companion:sessionCreate", (_e, title: string) =>
    companion.companionSessionCreate(title || "LifeQuest"),
  );
  ipcMain.handle("companion:sessionMessages", (_e, id: string) =>
    companion.companionSessionMessages(id),
  );
  ipcMain.handle(
    "companion:chatStream",
    async (
      event,
      payload: {
        sessionId: string;
        input: string;
        instructionsContext: CompanionInstructionsInput;
      },
    ) => {
      return vault.companionChatStreamWithPack(
        payload.sessionId,
        payload.input,
        payload.instructionsContext,
        (evt) => {
          if (!event.sender.isDestroyed()) {
            event.sender.send("companion:stream", evt);
          }
        },
      );
    },
  );
  ipcMain.handle(
    "companion:approval",
    (_e, payload: { runId: string; requestId: string; allow: boolean }) =>
      companion.companionApproval(payload.runId, payload.requestId, payload.allow),
  );
  ipcMain.handle("companion:openProfileFolder", () =>
    companion.companionOpenProfileFolder(),
  );

  ipcMain.handle("map:getState", () => vault.mapGetState());
  ipcMain.handle("map:apply", (_e, command: Parameters<typeof vault.mapApply>[0]) =>
    vault.mapApply(command, "user"),
  );
  ipcMain.handle("goals:apply", (_e, command: Parameters<typeof vault.goalsApply>[0]) =>
    vault.goalsApply(command),
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

async function createWindow() {
  const overlay = usesTitleBarOverlay();
  const win = new BrowserWindow({
    width: 1280,
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

  const sendMaximized = () => {
    if (win.isDestroyed()) return;
    win.webContents.send("window:maximizeChanged", win.isMaximized());
  };
  win.on("maximize", sendMaximized);
  win.on("unmaximize", sendMaximized);

  // External edits: on focus, re-stat doctrine files and notify renderer.
  // Channel name matches preload.ts (`vault:fileChanged`).
  win.on("focus", () => {
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
}

app.whenReady().then(() => {
  registerIpcHandlers();
  void createWindow();
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
