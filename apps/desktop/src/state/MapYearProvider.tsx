import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { findYear, todayLocalIso, yearOf } from "@lifequest/vault-core/map";
import { useVault } from "./VaultProvider";

type MapYearContextValue = {
  yearNum: number | null;
  month: number | null;
  setYearNum: (y: number) => void;
  setMonth: (m: number | null) => void;
};

const MapYearContext = createContext<MapYearContextValue | null>(null);

export function MapYearProvider({ children }: { children: ReactNode }) {
  const { snapshot } = useVault();
  const map = snapshot?.map ?? null;
  const [yearNum, setYearNumState] = useState<number | null>(null);
  const [month, setMonth] = useState<number | null>(null);

  const resolvedYear = useMemo(() => {
    if (!map) return null;
    const todayYear = yearOf(todayLocalIso());
    if (yearNum != null && findYear(map, yearNum)) return yearNum;
    if (findYear(map, todayYear)) return todayYear;
    const live = map.years.filter((y) => y.status === "live").sort((a, b) => a.year - b.year);
    return live[0]?.year ?? map.years[0]?.year ?? todayYear;
  }, [map, yearNum]);

  function setYearNum(y: number) {
    setYearNumState(y);
    setMonth(null);
  }

  return (
    <MapYearContext.Provider
      value={{ yearNum: resolvedYear, month, setYearNum, setMonth }}
    >
      {children}
    </MapYearContext.Provider>
  );
}

export function useMapYear(): MapYearContextValue {
  const ctx = useContext(MapYearContext);
  if (!ctx) throw new Error("useMapYear requires MapYearProvider");
  return ctx;
}
