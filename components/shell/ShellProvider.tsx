"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  parseDocumentKind,
  type DocumentKind,
  type DocumentStatus,
} from "@/lib/document-kinds.ts";
import { getUnlockedRooms, type UnlockDoc } from "@/lib/unlock.ts";
import type { RoomId } from "@/lib/document-kinds.ts";

export type ShellUser = {
  id: string;
  email: string;
  name: string | null;
};

export type ShellDocumentSummary = {
  kind: DocumentKind;
  status: DocumentStatus;
  /** Approximate body for unlock when only bodyLength is available */
  bodyMarkdown: string;
  bodyLength: number;
};

export type ShellDomain = {
  id: string;
  name: string;
  description?: string | null;
  color?: string | null;
  sortOrder: number;
  documents: ShellDocumentSummary[];
};

type ShellContextValue = {
  user: ShellUser | null;
  domains: ShellDomain[];
  activeDomainId: string | null;
  activeDomain: ShellDomain | null;
  documents: ShellDocumentSummary[];
  unlockedRooms: Set<RoomId>;
  loading: boolean;
  error: string | null;
  setActiveDomainId: (id: string) => Promise<void>;
  activateDomain: (id: string) => Promise<void>;
  refresh: () => Promise<void>;
};

const ShellContext = createContext<ShellContextValue | null>(null);

function toUnlockDocs(docs: ShellDocumentSummary[]): UnlockDoc[] {
  return docs.map((d) => ({
    kind: d.kind,
    bodyMarkdown:
      d.bodyMarkdown ||
      (d.bodyLength > 0 ? "x".repeat(Math.min(d.bodyLength, 8)) : ""),
  }));
}

function normalizeDocuments(
  raw: unknown,
): ShellDocumentSummary[] {
  if (!Array.isArray(raw)) return [];
  const out: ShellDocumentSummary[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const kind = typeof rec.kind === "string" ? parseDocumentKind(rec.kind) : null;
    if (!kind) continue;
    const statusRaw = typeof rec.status === "string" ? rec.status : "draft";
    const status = (
      ["draft", "refined", "forged"].includes(statusRaw) ? statusRaw : "draft"
    ) as DocumentStatus;
    const bodyMarkdown =
      typeof rec.bodyMarkdown === "string" ? rec.bodyMarkdown : "";
    const bodyLength =
      typeof rec.bodyLength === "number"
        ? rec.bodyLength
        : bodyMarkdown.length;
    out.push({ kind, status, bodyMarkdown, bodyLength });
  }
  return out;
}

function normalizeDomains(raw: unknown): ShellDomain[] {
  if (!Array.isArray(raw)) return [];
  const out: ShellDomain[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    if (typeof rec.id !== "string" || typeof rec.name !== "string") continue;
    out.push({
      id: rec.id,
      name: rec.name,
      description:
        typeof rec.description === "string" || rec.description === null
          ? (rec.description as string | null)
          : null,
      color:
        typeof rec.color === "string" || rec.color === null
          ? (rec.color as string | null)
          : null,
      sortOrder: typeof rec.sortOrder === "number" ? rec.sortOrder : 0,
      documents: normalizeDocuments(rec.documents),
    });
  }
  return out;
}

export function ShellProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<ShellUser | null>(null);
  const [domains, setDomains] = useState<ShellDomain[]>([]);
  const [activeDomainId, setActiveDomainIdState] = useState<string | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const [meRes, domainsRes] = await Promise.all([
        fetch("/api/auth/me", { credentials: "same-origin" }),
        fetch("/api/domains", { credentials: "same-origin" }),
      ]);

      if (meRes.status === 401 || domainsRes.status === 401) {
        setUser(null);
        setDomains([]);
        setActiveDomainIdState(null);
        setError("Unauthorized");
        // Bounce soft-session loss back to sign-in
        if (typeof window !== "undefined" && !window.location.pathname.startsWith("/sign-")) {
          window.location.assign("/sign-in");
        }
        return;
      }

      if (!meRes.ok) {
        setError("Failed to load session");
        return;
      }

      const meData = (await meRes.json()) as {
        user?: ShellUser;
        activeDomainId?: string | null;
        domains?: unknown;
      };

      let nextDomains: ShellDomain[] = [];
      if (domainsRes.ok) {
        const domainsData = (await domainsRes.json()) as { domains?: unknown };
        nextDomains = normalizeDomains(domainsData.domains);
      } else {
        // Fallback to me payload (no document summaries)
        nextDomains = normalizeDomains(meData.domains);
      }

      setUser(meData.user ?? null);
      setDomains(nextDomains);

      let nextActive =
        typeof meData.activeDomainId === "string"
          ? meData.activeDomainId
          : null;
      if (nextActive && !nextDomains.some((d) => d.id === nextActive)) {
        nextActive = nextDomains[0]?.id ?? null;
      }
      if (!nextActive && nextDomains[0]) {
        nextActive = nextDomains[0].id;
      }
      setActiveDomainIdState(nextActive);
    } catch {
      setError("Network error loading shell");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const activateDomain = useCallback(async (id: string) => {
    const res = await fetch(`/api/domains/${id}/activate`, {
      method: "POST",
      credentials: "same-origin",
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(data.error ?? "Failed to activate domain");
    }
    const data = (await res.json()) as { activeDomainId?: string };
    setActiveDomainIdState(data.activeDomainId ?? id);
  }, []);

  const setActiveDomainId = useCallback(
    async (id: string) => {
      await activateDomain(id);
    },
    [activateDomain],
  );

  const activeDomain = useMemo(
    () => domains.find((d) => d.id === activeDomainId) ?? null,
    [domains, activeDomainId],
  );

  const documents = activeDomain?.documents ?? [];

  const unlockedRooms = useMemo(
    () => getUnlockedRooms(toUnlockDocs(documents)),
    [documents],
  );

  const value = useMemo<ShellContextValue>(
    () => ({
      user,
      domains,
      activeDomainId,
      activeDomain,
      documents,
      unlockedRooms,
      loading,
      error,
      setActiveDomainId,
      activateDomain,
      refresh,
    }),
    [
      user,
      domains,
      activeDomainId,
      activeDomain,
      documents,
      unlockedRooms,
      loading,
      error,
      setActiveDomainId,
      activateDomain,
      refresh,
    ],
  );

  return (
    <ShellContext.Provider value={value}>{children}</ShellContext.Provider>
  );
}

export function useShell(): ShellContextValue {
  const ctx = useContext(ShellContext);
  if (!ctx) {
    throw new Error("useShell must be used within ShellProvider");
  }
  return ctx;
}
