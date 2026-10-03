import { contextBridge, ipcRenderer } from "electron";

type Result<T> = { ok: true; value: T } | { ok: false; error: string };

const lifequest = {
  vaultCreate: (path: string, name?: string) =>
    ipcRenderer.invoke("vault:create", path, name) as Promise<Result<unknown>>,
  vaultOpen: (path: string) =>
    ipcRenderer.invoke("vault:open", path) as Promise<Result<unknown>>,
  vaultGetSnapshot: () =>
    ipcRenderer.invoke("vault:getSnapshot") as Promise<Result<unknown>>,
  vaultListRecent: () =>
    ipcRenderer.invoke("vault:listRecent") as Promise<
      { id: string; name: string; path: string; lastOpenedAt: string }[]
    >,
  dialogOpenDirectory: () =>
    ipcRenderer.invoke("dialog:openDirectory") as Promise<string | null>,

  domainCreate: (input: { name: string; slug?: string }) =>
    ipcRenderer.invoke("domain:create", input) as Promise<Result<unknown>>,
  domainUpdate: (slug: string, patch: Record<string, unknown>) =>
    ipcRenderer.invoke("domain:update", slug, patch) as Promise<
      Result<unknown>
    >,
  domainArchive: (slug: string) =>
    ipcRenderer.invoke("domain:archive", slug) as Promise<Result<unknown>>,
  domainUnarchive: (slug: string) =>
    ipcRenderer.invoke("domain:unarchive", slug) as Promise<Result<unknown>>,
  domainDelete: (slug: string) =>
    ipcRenderer.invoke("domain:delete", slug) as Promise<Result<unknown>>,
  domainSetActive: (slug: string | null) =>
    ipcRenderer.invoke("domain:setActive", slug) as Promise<Result<string | null>>,
  domainGetActive: () =>
    ipcRenderer.invoke("domain:getActive") as Promise<string | null>,

  // KAR-55 domain databases
  dbList: (domainSlug: string | null) =>
    ipcRenderer.invoke("db:list", domainSlug) as Promise<Result<unknown>>,
  dbGet: (slug: string, dbId: string) =>
    ipcRenderer.invoke("db:get", slug, dbId) as Promise<Result<unknown>>,
  dbCreate: (slug: string, input: { name: string }) =>
    ipcRenderer.invoke("db:create", slug, input) as Promise<Result<unknown>>,
  dbAddColumn: (slug: string, dbId: string, input: { name: string; type: string; options?: string[]; relationDatabaseId?: string }) =>
    ipcRenderer.invoke("db:addColumn", slug, dbId, input) as Promise<Result<unknown>>,
  dbListRows: (slug: string, dbId: string) =>
    ipcRenderer.invoke("db:listRows", slug, dbId) as Promise<Result<unknown>>,
  dbGetRow: (slug: string, dbId: string, rowId: string) =>
    ipcRenderer.invoke("db:getRow", slug, dbId, rowId) as Promise<Result<unknown>>,
  dbUpsertRow: (slug: string, dbId: string, input: { id?: string; cells: Record<string, unknown> }) =>
    ipcRenderer.invoke("db:upsertRow", slug, dbId, input) as Promise<Result<unknown>>,
  dbDeleteRow: (slug: string, dbId: string, rowId: string) =>
    ipcRenderer.invoke("db:deleteRow", slug, dbId, rowId) as Promise<Result<unknown>>,
  dbFileSave: (slug: string, input: { bytes: Uint8Array; mime: string; name: string }) =>
    ipcRenderer.invoke("db:fileSave", slug, input) as Promise<Result<unknown>>,

  // KAR-58 books export and restore
  dbExportBooks: (slug: string) =>
    ipcRenderer.invoke("db:exportBooks", slug) as Promise<Result<unknown>>,
  dbRestoreBooks: (slug: string, options: { confirm: boolean }) =>
    ipcRenderer.invoke("db:restoreBooks", slug, options) as Promise<Result<unknown>>,

  // KAR-59 adapter IPC
  dbLinkAdapter: (slug: string, dbId: string, input: { kind: string; bindingId?: string; secret: string; sotMode: string }) =>
    ipcRenderer.invoke("db:linkAdapter", slug, dbId, input) as Promise<Result<unknown>>,
  dbUnlinkAdapter: (slug: string, dbId: string) =>
    ipcRenderer.invoke("db:unlinkAdapter", slug, dbId) as Promise<Result<unknown>>,
  dbSync: (slug: string, dbId?: string) =>
    ipcRenderer.invoke("db:sync", slug, dbId) as Promise<Result<unknown>>,
  dbListConflicts: (slug: string, dbId?: string) =>
    ipcRenderer.invoke("db:listConflicts", slug, dbId) as Promise<Result<unknown>>,
  dbResolveConflict: (slug: string, conflictId: string, choice: string) =>
    ipcRenderer.invoke("db:resolveConflict", slug, conflictId, choice) as Promise<Result<unknown>>,

  // KAR-60 pages and pins
  pageList: (domainSlug: string | null) =>
    ipcRenderer.invoke("page:list", domainSlug) as Promise<Result<unknown>>,
  pageGet: (slug: string, pageId: string) =>
    ipcRenderer.invoke("page:get", slug, pageId) as Promise<Result<unknown>>,
  pageCreate: (slug: string, input: { title: string }) =>
    ipcRenderer.invoke("page:create", slug, input) as Promise<Result<unknown>>,
  pageUpdate: (slug: string, pageId: string, input: { title?: string; blocks?: unknown[] }) =>
    ipcRenderer.invoke("page:update", slug, pageId, input) as Promise<Result<unknown>>,
  pageDelete: (slug: string, pageId: string) =>
    ipcRenderer.invoke("page:delete", slug, pageId) as Promise<Result<unknown>>,
  // KAR-56 script blocks
  scriptApply: (input: {
    domainSlug: string;
    pageId: string;
    blockId?: string;
    name: string;
    source: string;
  }) => ipcRenderer.invoke("script:apply", input) as Promise<Result<unknown>>,
  scriptRun: (input: { domainSlug: string; source: string }) =>
    ipcRenderer.invoke("script:run", input) as Promise<Result<unknown>>,
  pinsList: (domainSlug: string | null) =>
    ipcRenderer.invoke("pins:list", domainSlug) as Promise<Result<unknown>>,
  pinsSet: (domainSlug: string | null, pins: unknown[]) =>
    ipcRenderer.invoke("pins:set", domainSlug, pins) as Promise<Result<unknown>>,
  // Agent-built dashboard views (plan.md design)
  viewList: (slug: string) =>
    ipcRenderer.invoke("view:list", slug) as Promise<Result<unknown>>,
  viewGet: (slug: string, viewId: string) =>
    ipcRenderer.invoke("view:get", slug, viewId) as Promise<Result<unknown>>,
  viewSave: (slug: string, spec: Record<string, unknown>, viewId?: string) =>
    ipcRenderer.invoke("view:save", slug, spec, viewId) as Promise<Result<unknown>>,
  viewDelete: (slug: string, viewId: string) =>
    ipcRenderer.invoke("view:delete", slug, viewId) as Promise<Result<unknown>>,
  viewRun: (slug: string, spec: Record<string, unknown>) =>
    ipcRenderer.invoke("view:run", slug, spec) as Promise<Result<unknown>>,
  viewRunSaved: (slug: string, viewId: string) =>
    ipcRenderer.invoke("view:runSaved", slug, viewId) as Promise<Result<unknown>>,
  // KAR-53 ingest
  // KAR-61 finance kit
  kitInstallFinance: () =>
    ipcRenderer.invoke("kit:installFinance") as Promise<Result<unknown>>,
  kitList: (slug: string) =>
    ipcRenderer.invoke("kit:list", slug) as Promise<Result<unknown>>,
  kitFinanceSettings: () =>
    ipcRenderer.invoke("kit:financeSettings") as Promise<Result<unknown>>,
  kitSetCaptureAccount: (accountRowId: string | null) =>
    ipcRenderer.invoke("kit:setCaptureAccount", accountRowId) as Promise<Result<unknown>>,

  // KAR-57 finance plan loop
  financeBudgetVsActual: (asOf: string) =>
    ipcRenderer.invoke("finance:budgetVsActual", asOf) as Promise<Result<unknown>>,
  financeNetWorth: (asOf: string) =>
    ipcRenderer.invoke("finance:netWorth", asOf) as Promise<Result<unknown>>,
  financeScenarioCompare: (input: { asOf: string; assumptionSetId: string; compareSetId?: string | null }) =>
    ipcRenderer.invoke("finance:scenarioCompare", input) as Promise<Result<unknown>>,
  financeSaveAssumptionSet: (input: { rowId: string; name: string; horizonMonths: number; deltas: unknown[] }) =>
    ipcRenderer.invoke("finance:saveAssumptionSet", input) as Promise<Result<unknown>>,
  ingestFile: (slug: string, input: { databaseId: string; bytes: Uint8Array; mime: string; name: string; extractedRows?: Record<string, string>[] }) =>
    ipcRenderer.invoke("ingest:file", slug, input) as Promise<Result<unknown>>,
  ingestProposeMapping: (slug: string, input: { mappingId?: string; databaseId: string; fingerprint: string; sourceKind: string; columns: Array<{ source: string; columnId: string }> }) =>
    ipcRenderer.invoke("ingest:proposeMapping", slug, input) as Promise<Result<unknown>>,
  ingestListMappings: (slug: string, databaseId?: string) =>
    ipcRenderer.invoke("ingest:listMappings", slug, databaseId) as Promise<Result<unknown>>,
  ingestListBatches: (slug: string, databaseId?: string) =>
    ipcRenderer.invoke("ingest:listBatches", slug, databaseId) as Promise<Result<unknown>>,
  ingestListRows: (slug: string, batchId: string) =>
    ipcRenderer.invoke("ingest:listRows", slug, batchId) as Promise<Result<unknown>>,
  ingestEditRow: (slug: string, batchId: string, rowId: string, cells: Record<string, unknown>) =>
    ipcRenderer.invoke("ingest:editRow", slug, batchId, rowId, cells) as Promise<Result<unknown>>,
  ingestAccept: (slug: string, batchId: string, rowIds?: string[]) =>
    ipcRenderer.invoke("ingest:accept", slug, batchId, rowIds) as Promise<Result<unknown>>,
  ingestReject: (slug: string, batchId: string, rowIds?: string[]) =>
    ipcRenderer.invoke("ingest:reject", slug, batchId, rowIds) as Promise<Result<unknown>>,

  documentGet: (slug: string, kind: string) =>
    ipcRenderer.invoke("document:get", slug, kind) as Promise<Result<unknown>>,
  documentSave: (
    slug: string,
    kind: string,
    bodyMarkdown: string,
    title?: string,
  ) =>
    ipcRenderer.invoke(
      "document:save",
      slug,
      kind,
      bodyMarkdown,
      title,
    ) as Promise<Result<unknown>>,
  documentSetLocked: (slug: string, kind: string, locked: boolean) =>
    ipcRenderer.invoke(
      "document:setLocked",
      slug,
      kind,
      locked,
    ) as Promise<Result<unknown>>,
  librarySetLocked: (id: string, locked: boolean) =>
    ipcRenderer.invoke("library:setLocked", id, locked) as Promise<Result<unknown>>,
  documentMediaSave: (
    slug: string,
    input: { bytes: Uint8Array; mime: string },
  ) =>
    ipcRenderer.invoke("document:mediaSave", slug, input) as Promise<
      Result<{ relPath: string }>
    >,
  documentMediaRead: (slug: string, relPath: string) =>
    ipcRenderer.invoke("document:mediaRead", slug, relPath) as Promise<
      Result<{ bytes: Uint8Array; mime: string }>
    >,

  decisionList: () =>
    ipcRenderer.invoke("decision:list") as Promise<Result<unknown>>,
  decisionCreate: (input: Record<string, unknown>) =>
    ipcRenderer.invoke("decision:create", input) as Promise<Result<unknown>>,
  decisionResolve: (id: string, resolution: "approved" | "rejected") =>
    ipcRenderer.invoke("decision:resolve", id, resolution) as Promise<
      Result<unknown>
    >,

  logList: () => ipcRenderer.invoke("log:list") as Promise<Result<unknown>>,

  signalChainList: () =>
    ipcRenderer.invoke("signalChain:list") as Promise<Result<unknown>>,
  signalChainCreate: (input: Record<string, unknown>) =>
    ipcRenderer.invoke("signalChain:create", input) as Promise<Result<unknown>>,
  signalChainUpdate: (id: string, patch: Record<string, unknown>) =>
    ipcRenderer.invoke("signalChain:update", id, patch) as Promise<
      Result<unknown>
    >,
  signalChainDelete: (id: string) =>
    ipcRenderer.invoke("signalChain:delete", id) as Promise<Result<unknown>>,

  libraryList: () => ipcRenderer.invoke("library:list"),
  libraryCreate: (input: Record<string, unknown>) =>
    ipcRenderer.invoke("library:create", input),
  libraryGet: (id: string) => ipcRenderer.invoke("library:get", id),
  libraryUpdate: (id: string, patch: Record<string, unknown>) =>
    ipcRenderer.invoke("library:update", id, patch),
  libraryDelete: (id: string) => ipcRenderer.invoke("library:delete", id),

  // KAR-7 projects: direct operator writes, no Decision.
  projectsList: () => ipcRenderer.invoke("projects:list"),
  projectsGet: (id: string) => ipcRenderer.invoke("projects:get", id),
  projectsCreate: (input: Record<string, unknown>) =>
    ipcRenderer.invoke("projects:create", input),
  projectsUpdate: (id: string, patch: Record<string, unknown>) =>
    ipcRenderer.invoke("projects:update", id, patch),

  agentsList: () =>
    ipcRenderer.invoke("agents:list") as Promise<Result<unknown>>,
  agentsHire: (input: Record<string, unknown>) =>
    ipcRenderer.invoke("agents:hire", input) as Promise<Result<unknown>>,
  agentsDismiss: (id: string) =>
    ipcRenderer.invoke("agents:dismiss", id) as Promise<Result<unknown>>,

  settingsUpdate: (patch: Record<string, unknown>) =>
    ipcRenderer.invoke("settings:update", patch) as Promise<Result<unknown>>,

  secretsHasHermesKey: () =>
    ipcRenderer.invoke("secrets:hasHermesKey") as Promise<boolean>,
  secretsSetHermesKey: (key: string) =>
    ipcRenderer.invoke("secrets:setHermesKey", key) as Promise<Result<true>>,
  secretsClearHermesKey: () =>
    ipcRenderer.invoke("secrets:clearHermesKey") as Promise<Result<true>>,

  hermesTest: () =>
    ipcRenderer.invoke("hermes:test") as Promise<Result<unknown>>,
  hermesChat: (messages: { role: string; content: string }[]) =>
    ipcRenderer.invoke("hermes:chat", messages) as Promise<Result<unknown>>,
  hermesChatTools: (
    messages: { role: string; content: string }[],
    hire?: { id: string; name: string },
  ) =>
    ipcRenderer.invoke(
      "hermes:chatTools",
      messages,
      hire,
    ) as Promise<Result<unknown>>,
  hermesScanAgents: () =>
    ipcRenderer.invoke("hermes:scanAgents") as Promise<Result<unknown>>,

  mcpGetUrl: () =>
    ipcRenderer.invoke("mcp:getUrl") as Promise<string>,
  mcpGetError: () =>
    ipcRenderer.invoke("mcp:getError") as Promise<string | null>,

  companionEnsure: () => ipcRenderer.invoke("companion:ensure"),
  companionStatus: () => ipcRenderer.invoke("companion:status"),
  companionSessionsList: () => ipcRenderer.invoke("companion:sessionsList"),
  companionSessionCreate: (title: string) =>
    ipcRenderer.invoke("companion:sessionCreate", title),
  companionSessionMessages: (id: string) =>
    ipcRenderer.invoke("companion:sessionMessages", id),
  companionSessionPatch: (
    id: string,
    patch: { title?: string; pinned?: boolean; archived?: boolean },
  ) => ipcRenderer.invoke("companion:sessionPatch", id, patch),
  companionSessionDelete: (id: string) =>
    ipcRenderer.invoke("companion:sessionDelete", id),
  companionChatStream: (payload: {
    sessionId: string;
    input: string;
    instructionsContext: {
      domainName: string | null;
      domainSlug: string | null;
      aboutMe: string;
      locked: boolean;
      vaultOpen: boolean;
    };
  }) => ipcRenderer.invoke("companion:chatStream", payload),
  companionApproval: (payload: {
    runId: string;
    requestId: string;
    allow: boolean;
  }) => ipcRenderer.invoke("companion:approval", payload),
  companionRunStop: (runId: string) =>
    ipcRenderer.invoke("companion:runStop", runId) as Promise<
      { ok: true } | { ok: false; error: string }
    >,
  companionOpenProfileFolder: () =>
    ipcRenderer.invoke("companion:openProfileFolder"),
  companionGetFiling: () =>
    ipcRenderer.invoke("companion:getFiling") as Promise<boolean>,
  companionSetFiling: (enabled: boolean) =>
    ipcRenderer.invoke("companion:setFiling", enabled) as Promise<void>,
  onCompanionStream: (cb: (evt: unknown) => void) => {
    const listener = (_event: unknown, evt: unknown) => {
      cb(evt);
    };
    ipcRenderer.on("companion:stream", listener);
    return () => {
      ipcRenderer.removeListener("companion:stream", listener);
    };
  },

  mapGetState: () =>
    ipcRenderer.invoke("map:getState") as Promise<Result<unknown>>,
  mapApply: (command: unknown) =>
    ipcRenderer.invoke("map:apply", command) as Promise<Result<unknown>>,
  goalsApply: (command: unknown) =>
    ipcRenderer.invoke("goals:apply", command) as Promise<Result<unknown>>,

  reviewGet: (cadence: string, period: string) =>
    ipcRenderer.invoke("review:get", cadence, period) as Promise<Result<unknown>>,
  reviewEnsure: (cadence: string, period: string, scope: string) =>
    ipcRenderer.invoke("review:ensure", cadence, period, scope) as Promise<
      Result<unknown>
    >,
  reviewWrite: (cadence: string, period: string, body: string) =>
    ipcRenderer.invoke("review:write", cadence, period, body) as Promise<
      Result<unknown>
    >,
  reviewMarkDone: (cadence: string, period: string, scope: string) =>
    ipcRenderer.invoke("review:markDone", cadence, period, scope) as Promise<
      Result<unknown>
    >,
  reviewUnlock: (cadence: string, period: string) =>
    ipcRenderer.invoke("review:unlock", cadence, period) as Promise<
      Result<unknown>
    >,
  reviewPeriodPack: (cadence: string, period: string, scope: string) =>
    ipcRenderer.invoke("review:periodPack", cadence, period, scope) as Promise<
      Result<unknown>
    >,
  planningEnsure: (cadence: string, period: string, scope: string) =>
    ipcRenderer.invoke("planning:ensure", cadence, period, scope) as Promise<
      Result<unknown>
    >,
  reviewStartOrResume: (cadence: string, period: string, scope: string) =>
    ipcRenderer.invoke(
      "review:startOrResume",
      cadence,
      period,
      scope,
    ) as Promise<Result<unknown>>,
  planningStartOrResume: (cadence: string, period: string, scope: string) =>
    ipcRenderer.invoke(
      "planning:startOrResume",
      cadence,
      period,
      scope,
    ) as Promise<Result<unknown>>,

  deadlineDismiss: () =>
    ipcRenderer.invoke("deadline:dismiss") as Promise<Result<true>>,

  deadlineGetDismissed: () =>
    ipcRenderer.invoke("deadline:getDismissed") as Promise<
      Result<{ ok: true; value: string | null }>
    >,

  deadlineMaybeNotify: () =>
    ipcRenderer.invoke("deadline:maybeNotify") as Promise<
      Result<{ ok: true; notified: boolean; title: string; body: string }>
    >,

  onVaultFileChanged: (cb: (payload: { path: string }) => void) => {
    const listener = (_event: unknown, payload: { path: string }) => {
      cb(payload);
    };
    ipcRenderer.on("vault:fileChanged", listener);
    return () => {
      ipcRenderer.removeListener("vault:fileChanged", listener);
    };
  },

  windowChrome: {
    get: () =>
      ipcRenderer.invoke("window:getChrome") as Promise<{
        overlay: boolean;
        platform: string;
      }>,
    setTitleBarOverlay: (opts: { color: string; symbolColor: string }) =>
      ipcRenderer.invoke("window:setTitleBarOverlay", opts) as Promise<void>,
    minimize: () => {
      ipcRenderer.send("window:minimize");
    },
    toggleMaximize: () => {
      ipcRenderer.send("window:toggleMaximize");
    },
    close: () => {
      ipcRenderer.send("window:close");
    },
    isMaximized: () =>
      ipcRenderer.invoke("window:isMaximized") as Promise<boolean>,
    onMaximizeChange: (cb: (maximized: boolean) => void) => {
      const listener = (_event: unknown, maximized: boolean) => {
        cb(maximized);
      };
      ipcRenderer.on("window:maximizeChanged", listener);
      return () => {
        ipcRenderer.removeListener("window:maximizeChanged", listener);
      };
    },
  },
};

contextBridge.exposeInMainWorld("lifequest", lifequest);
