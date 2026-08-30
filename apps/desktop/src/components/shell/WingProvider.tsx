import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  applyPath,
  initialWingSession,
  selectWing as selectWingSession,
  type WingId,
  type WingSession,
} from "./wing.ts";

type WingContextValue = {
  active: WingId;
  selectWing: (wing: WingId) => void;
};

const WingContext = createContext<WingContextValue | null>(null);

export function WingProvider({ children }: { children: ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [session, setSession] = useState<WingSession>(() =>
    applyPath(initialWingSession(), location.pathname),
  );

  useEffect(() => {
    setSession((current) => applyPath(current, location.pathname));
  }, [location.pathname]);

  const value = useMemo<WingContextValue>(
    () => ({
      active: session.active,
      selectWing: (wing: WingId) => {
        const next = selectWingSession(session, wing);
        setSession(next.session);
        if (next.pathname !== location.pathname) {
          navigate(next.pathname);
        }
      },
    }),
    [session, location.pathname, navigate],
  );

  return (
    <WingContext.Provider value={value}>{children}</WingContext.Provider>
  );
}

export function useWing(): WingContextValue {
  const ctx = useContext(WingContext);
  if (!ctx) throw new Error("useWing requires WingProvider");
  return ctx;
}
