/**
 * The desktop half of the phone client: the door's lifetime, the machine
 * settings, the pairing code, and the renderer's read model.
 *
 * Three kinds of state, in three places, on purpose:
 *
 *  - **this machine**: whether phone access is on, and the https address the
 *    operator reaches it on. `userData/phone.json`. A copied vault must not
 *    carry "this laptop serves a door" with it.
 *  - **this vault**: the devices paired to it and the one pinned metric, under
 *    `.lifequest/phone/`. A copy of the vault is the same vault, with the same
 *    phones and the same number.
 *  - **this process**: the one-time pairing code. Memory only.
 *
 * The door itself is `phone-door.ts`; this module never serves a request.
 */
import { BrowserWindow, app } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import QRCode from "qrcode";
import {
  PHONE_PORT,
  atomicWriteFile,
  listPhoneDrafts,
  readPhoneDevices,
  readPhoneSettings,
  removePhoneDevice,
  writePhoneMetric,
  type PhoneMetricId,
  type PhoneSettings,
} from "@lifequest/vault-core";
import { createPhoneDoor, type PhoneDoor } from "./phone-door.js";

export type PhoneMachineConfig = {
  schemaVersion: 1;
  enabled: boolean;
  publicOrigin: string | null;
};

/** The E2E seam's override, applied before a vault is open. */
export type PhoneE2eConfig = {
  enabled?: boolean;
  port?: number;
  publicOrigin?: string;
  staticDir?: string;
};

export type PhoneDeviceView = {
  id: string;
  name: string;
  createdAt: string;
  lastSeenAt: string;
};

export type PhoneDraftView = {
  clientId: string;
  text: string;
  captureDate: string;
  deviceName: string;
};

export type PhoneStateView = {
  enabled: boolean;
  doorUrl: string;
  publicOrigin: string | null;
  error: string | null;
  devices: PhoneDeviceView[];
  metric: PhoneMetricId | null;
  pendingDrafts: PhoneDraftView[];
};

export type PhonePairingView = {
  code: string;
  link: string;
  qrDataUrl: string;
  expiresAt: string;
};

let e2e: PhoneE2eConfig | null = null;
let door: PhoneDoor | null = null;
let doorError: string | null = null;
let currentRoot: string | null = null;

function configPath(): string {
  return path.join(app.getPath("userData"), "phone.json");
}

async function readMachineConfig(): Promise<PhoneMachineConfig> {
  try {
    const parsed = JSON.parse(await fs.readFile(configPath(), "utf8")) as Partial<PhoneMachineConfig>;
    return {
      schemaVersion: 1,
      enabled: parsed.enabled === true,
      publicOrigin:
        typeof parsed.publicOrigin === "string" && parsed.publicOrigin
          ? parsed.publicOrigin
          : null,
    };
  } catch {
    return { schemaVersion: 1, enabled: false, publicOrigin: null };
  }
}

async function writeMachineConfig(config: PhoneMachineConfig): Promise<void> {
  await atomicWriteFile(configPath(), `${JSON.stringify(config, null, 2)}\n`);
}

async function readVaultName(root: string): Promise<string> {
  try {
    const parsed = JSON.parse(
      await fs.readFile(path.join(root, "lifequest.json"), "utf8"),
    ) as { name?: unknown };
    return typeof parsed.name === "string" && parsed.name ? parsed.name : "LifeQuest";
  } catch {
    return "LifeQuest";
  }
}

/** Only an https origin with no path, query, or fragment may be stored. */
export function normalizePublicOrigin(input: string): string | null {
  try {
    const url = new URL(input.trim());
    if (url.protocol !== "https:") return null;
    if ((url.pathname !== "/" && url.pathname !== "") || url.search || url.hash) return null;
    return url.origin;
  } catch {
    return null;
  }
}

function notifyChanged(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send("phone:changed");
  }
}

export function configurePhoneFromE2e(config: PhoneE2eConfig | null): void {
  e2e = config;
}

/** Start (or restart) the door for this vault. Errors are reported, not thrown. */
export async function startPhoneForVault(root: string): Promise<void> {
  currentRoot = root;
  await stopPhone();
  const config = await readMachineConfig();
  const enabled = e2e?.enabled ?? config.enabled;
  const publicOrigin = (e2e?.publicOrigin ?? config.publicOrigin ?? "").replace(/\/+$/, "");
  if (!enabled) {
    doorError = null;
    return;
  }
  if (!publicOrigin) {
    // Turning the door on without an address would mint a code the phone could
    // not reach; say so rather than binding a door nobody can pair with.
    doorError = "Set the phone address before turning phone access on";
    return;
  }
  const staticDir = e2e?.staticDir ?? path.join(app.getAppPath(), "dist-phone");
  const vaultName = await readVaultName(root);
  const started = await createPhoneDoor({
    root,
    vaultName,
    staticDir,
    port: e2e?.port ?? PHONE_PORT,
    publicOrigin,
    onQueueChanged: notifyChanged,
  });
  if (!started.ok) {
    door = null;
    doorError = started.error;
    return;
  }
  door = started.value;
  doorError = null;
}

export async function stopPhone(): Promise<void> {
  const current = door;
  door = null;
  if (current) await current.close();
}

export async function getPhoneState(): Promise<PhoneStateView> {
  const config = await readMachineConfig();
  const enabled = e2e?.enabled ?? config.enabled;
  const devices = currentRoot ? await readPhoneDevices(currentRoot) : { ok: true as const, value: [] };
  const settings = currentRoot
    ? await readPhoneSettings(currentRoot)
    : { ok: true as const, value: { schemaVersion: 1 as const, metric: null } };
  const pending = currentRoot
    ? await listPhoneDrafts(currentRoot, { status: "pending" })
    : { ok: true as const, value: { drafts: [], skipped: 0 } };
  return {
    enabled,
    doorUrl: door?.url ?? "",
    publicOrigin: e2e?.publicOrigin ?? config.publicOrigin,
    error: doorError,
    devices: devices.ok
      ? devices.value.map((device) => ({
          id: device.id,
          name: device.name,
          createdAt: device.createdAt,
          lastSeenAt: device.lastSeenAt,
        }))
      : [],
    metric: settings.ok ? settings.value.metric : null,
    pendingDrafts: pending.ok
      ? pending.value.drafts.map((draft) => ({
          clientId: draft.clientId,
          text: draft.text,
          captureDate: draft.captureDate,
          deviceName: draft.deviceName,
        }))
      : [],
  };
}

export async function setPhoneEnabled(enabled: boolean): Promise<PhoneStateView> {
  const config = await readMachineConfig();
  await writeMachineConfig({ ...config, enabled });
  if (enabled && currentRoot) await startPhoneForVault(currentRoot);
  else if (!enabled) await stopPhone();
  return getPhoneState();
}

export async function setPhonePublicOrigin(
  origin: string,
): Promise<{ ok: true; value: PhoneStateView } | { ok: false; error: string }> {
  const normalized = normalizePublicOrigin(origin);
  if (!normalized) {
    return {
      ok: false,
      error: "Enter an https address with no path, e.g. https://studio.tailnet.ts.net",
    };
  }
  const config = await readMachineConfig();
  await writeMachineConfig({ ...config, publicOrigin: normalized });
  if (door && currentRoot) await startPhoneForVault(currentRoot);
  return { ok: true, value: await getPhoneState() };
}

export async function setPhoneMetric(
  metric: PhoneMetricId | null,
): Promise<{ ok: true; value: PhoneSettings } | { ok: false; error: string }> {
  if (!currentRoot) return { ok: false, error: "Open a vault first" };
  const written = await writePhoneMetric(currentRoot, metric);
  if (!written.ok) return { ok: false, error: written.error };
  notifyChanged();
  return { ok: true, value: written.value };
}

export async function pairingStart(): Promise<
  { ok: true; value: PhonePairingView } | { ok: false; error: string }
> {
  if (!door) {
    return {
      ok: false,
      error: doorError ?? "Phone access is off. Turn it on and open a vault.",
    };
  }
  const minted = door.mintPairingCode();
  if (!minted.ok) return { ok: false, error: minted.error };
  const state = await getPhoneState();
  const origin = (state.publicOrigin ?? "").replace(/\/+$/, "");
  const link = `${origin}/phone/#pair=${minted.value.code}`;
  let qrDataUrl = "";
  try {
    qrDataUrl = await QRCode.toDataURL(link, { width: 240, margin: 1 });
  } catch {
    // A QR that cannot render leaves the code visible; pairing still works.
  }
  return {
    ok: true,
    value: { code: minted.value.code, link, qrDataUrl, expiresAt: minted.value.expiresAt },
  };
}

export function pairingCancel(): void {
  door?.cancelPairingCode();
}

export async function revokePhoneDevice(
  id: string,
): Promise<{ ok: true; value: PhoneStateView } | { ok: false; error: string }> {
  if (!currentRoot) return { ok: false, error: "Open a vault first" };
  const removed = await removePhoneDevice(currentRoot, id);
  if (!removed.ok) return { ok: false, error: removed.error };
  notifyChanged();
  return { ok: true, value: await getPhoneState() };
}

export async function phoneQueue(): Promise<{
  drafts: PhoneDraftView[];
  count: number;
}> {
  if (!currentRoot) return { drafts: [], count: 0 };
  const listed = await listPhoneDrafts(currentRoot, { status: "pending" });
  if (!listed.ok) return { drafts: [], count: 0 };
  const drafts = listed.value.drafts.map((draft) => ({
    clientId: draft.clientId,
    text: draft.text,
    captureDate: draft.captureDate,
    deviceName: draft.deviceName,
  }));
  return { drafts, count: drafts.length };
}
