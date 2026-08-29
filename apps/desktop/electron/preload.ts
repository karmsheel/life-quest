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
  domainSetActive: (slug: string) =>
    ipcRenderer.invoke("domain:setActive", slug) as Promise<Result<string>>,
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
  documentSetStatus: (slug: string, kind: string, status: string) =>
    ipcRenderer.invoke(
      "document:setStatus",
      slug,
      kind,
      status,
    ) as Promise<Result<unknown>>,

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

  mapGetState: () =>
    ipcRenderer.invoke("map:getState") as Promise<Result<unknown>>,
  mapApply: (command: unknown) =>
    ipcRenderer.invoke("map:apply", command) as Promise<Result<unknown>>,

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
