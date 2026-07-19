import { z } from "zod";
import type { HermesConfig } from "./hermes-types.ts";

export const HermesCredentialsSchema = z.object({
  baseUrl: z.string(),
  apiKey: z.string(),
  model: z.string().optional(),
});

export type HermesCredentials = z.infer<typeof HermesCredentialsSchema>;

export function toHermesConfig(credentials: HermesCredentials): HermesConfig {
  return {
    baseUrl: credentials.baseUrl,
    apiKey: credentials.apiKey,
    model: credentials.model,
  };
}

export const DEFAULT_HERMES_MODEL = "hermes-agent";

export interface HermesModelOption {
  id: string;
  label: string;
}

export function resolveHermesModel(
  config?: Pick<HermesConfig, "model"> | null,
  fallback?: string,
): string {
  const fromConfig = config?.model?.trim();
  if (fromConfig) return fromConfig;
  const fromFallback = fallback?.trim();
  if (fromFallback) return fromFallback;
  return DEFAULT_HERMES_MODEL;
}

export function hermesApiBody(config: HermesConfig): {
  baseUrl: string;
  apiKey: string;
  model: string;
} {
  return {
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    model: resolveHermesModel(config),
  };
}

export function parseHermesModelsResponse(data: unknown): HermesModelOption[] {
  if (!data || typeof data !== "object") return [];

  const list = data as { data?: unknown[] };
  if (!Array.isArray(list.data)) return [];

  const models: HermesModelOption[] = [];
  for (const entry of list.data) {
    if (!entry || typeof entry !== "object") continue;
    const id = (entry as { id?: unknown }).id;
    if (typeof id !== "string" || !id.trim()) continue;
    models.push({ id, label: formatModelLabel(id) });
  }

  return models;
}

export function formatModelLabel(modelId: string): string {
  if (modelId === DEFAULT_HERMES_MODEL) return "Hermes Agent";
  return modelId
    .split(/[-_/]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export async function fetchHermesModels(
  baseUrl: string,
  apiKey: string,
): Promise<HermesModelOption[]> {
  const normalized = baseUrl.replace(/\/$/, "");
  const res = await fetch(`${normalized}/v1/models`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });

  if (!res.ok) {
    throw new Error(`Models request failed (${res.status})`);
  }

  const data = await res.json();
  return parseHermesModelsResponse(data);
}
