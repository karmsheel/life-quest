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
  domainSetActive: (slug: string | null) =>
    ipcRenderer.invoke("domain:setActive", slug) as Promise<Result<string | null>>,
  domainGetActive: () =>
    ipcRenderer.invoke("domain:getActive") as Promise<string | null>,

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
  ) =>
    ipcRenderer.invoke("hermes:chatTools", messages) as Promise<Result<unknown>>,
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
  companionOpenProfileFolder: () =>
    ipcRenderer.invoke("companion:openProfileFolder"),
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
