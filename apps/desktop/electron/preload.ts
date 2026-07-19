import { contextBridge } from "electron";

contextBridge.exposeInMainWorld("lifequest", {
  ping: () => "pong",
});
