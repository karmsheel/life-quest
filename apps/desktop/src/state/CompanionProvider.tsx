import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { CompanionStatus } from "@/vite-env";
import { api } from "@/lib/ipc";

type CompanionContextValue = {
  status: CompanionStatus | null;
  ensuring: boolean;
  retry: () => Promise<void>;
};

const CompanionContext = createContext<CompanionContextValue | null>(null);

export function CompanionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<CompanionStatus | null>(null);
  const [ensuring, setEnsuring] = useState(true);

  const retry = useCallback(async () => {
    setEnsuring(true);
    try {
      const next = await api().companionEnsure();
      setStatus(next);
    } catch {
      setStatus({ kind: "disconnected" });
    } finally {
      setEnsuring(false);
    }
  }, []);

  useEffect(() => {
    void retry();
  }, [retry]);

  const value = useMemo(
    () => ({ status, ensuring, retry }),
    [status, ensuring, retry],
  );

  return (
    <CompanionContext.Provider value={value}>{children}</CompanionContext.Provider>
  );
}

export function useCompanion(): CompanionContextValue {
  const ctx = useContext(CompanionContext);
  if (!ctx) {
    throw new Error("useCompanion must be used within CompanionProvider");
  }
  return ctx;
}
