import type { LifequestApi } from "../vite-env";

export type { LifequestApi };

export function api(): LifequestApi {
  if (!window.lifequest) {
    throw new Error("LifeQuest API missing — not running in Electron");
  }
  return window.lifequest;
}
