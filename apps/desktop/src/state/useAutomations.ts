import { useCallback, useEffect, useRef, useState } from "react";
import { AUTOMATIONS_CHANGED_EVENT, type AutomationRecord } from "@/lib/automations";
import { api } from "@/lib/ipc";

/**
 * The vault's automation shelf, kept in step with its one change signal.
 *
 * Every surface that draws automations — the shelf page and the Daily Note's
 * manual buttons — reads this hook, so an edit on one is visible on the other
 * without a reload. The store itself is main's; this is a cache of the last
 * successful read, and a failed read keeps the last good list on screen rather
 * than replacing it with a blank shelf.
 */
export function useAutomations() {
  const [automations, setAutomations] = useState<AutomationRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const token = useRef(0);

  const reload = useCallback(async () => {
    const mine = ++token.current;
    try {
      const result = await api().automationList();
      if (mine !== token.current) return;
      if (result.ok) {
        setAutomations(result.value);
        setError(null);
      } else {
        setError(result.error);
      }
    } catch (err) {
      if (mine !== token.current) return;
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void reload();
    const onChange = () => void reload();
    window.addEventListener(AUTOMATIONS_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(AUTOMATIONS_CHANGED_EVENT, onChange);
  }, [reload]);

  return { automations, error, reload };
}
