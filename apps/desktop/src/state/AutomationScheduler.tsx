import { useCallback, useEffect, useRef } from "react";
import {
  AUTOMATIONS_CHANGED_EVENT,
  automationContextFor,
  automationIsDue,
  notifyAutomationsChanged,
  renderAutomationPrompt,
  type AutomationRecord,
} from "@/lib/automations";
import { api } from "@/lib/ipc";
import { formatLocalIsoDate, periodTodayLocalIso } from "@lifequest/vault-core/pure";
import { useVault } from "@/state/VaultProvider";

const CHECK_EVERY_MS = 30_000;

/**
 * The scheduled half of automations.
 *
 * It runs in the renderer because a LifeQuest automation is a turn in the app's
 * own companion: the same session store, the same instructions, the same chat
 * the operator will read later. While the window is open it checks every half
 * minute for a schedule that has come due, and it writes the run back to the
 * vault before the next check so one occurrence never fires twice.
 *
 * A run is deliberately not opened in the dock: the operator may be in the
 * middle of something, and an automation that steals the pane is a worse
 * neighbour than one that leaves a chat waiting in the list. The one visible
 * signal is the automation row's last-run line.
 */
export function AutomationScheduler() {
  const { snapshot } = useVault();
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  const running = useRef(new Set<string>());
  const checking = useRef(false);
  const vaultId = snapshot?.lifequest.id ?? null;

  const runOne = useCallback(async (record: AutomationRecord) => {
    try {
      const date = periodTodayLocalIso();
      const dateLabel = formatLocalIsoDate(date);
      const prompt = renderAutomationPrompt(record.prompt, { date, dateLabel });
      let context: string | undefined;

      if (record.host === "daily-note") {
        const note = await api().dailyNoteGet(date);
        const body = note.ok ? note.value.bodyMarkdown : "";
        if (!body.trim()) {
          await api().automationMarkRun(record.id, {
            status: "skipped",
            error: "No Daily Note for today.",
          });
          return;
        }
        context = automationContextFor(record, { date, dateLabel, body });
      }

      const created = await api().companionSessionCreate(
        `${record.name} · ${dateLabel}`,
      );
      if (!created.ok) {
        await api().automationMarkRun(record.id, {
          status: "failed",
          error: created.error,
        });
        return;
      }

      const aboutMe = snapshotRef.current?.map?.aboutMe ?? "";
      const result = await api().companionChatStream({
        sessionId: created.value.id,
        input: prompt,
        instructionsContext: {
          domainName: null,
          domainSlug: null,
          aboutMe,
          locked: false,
          vaultOpen: true,
          ...(context ? { automationContext: context } : {}),
        },
        runtime: null,
        receiptRelPath: null,
      });
      if ("ok" in result && result.ok === false) {
        await api().automationMarkRun(record.id, {
          status: "failed",
          sessionId: created.value.id,
          error: result.error,
        });
        return;
      }
      await api().automationMarkRun(record.id, {
        status: "succeeded",
        sessionId: created.value.id,
      });
    } catch (err) {
      // The run may have died before a session existed. Recording the failure
      // still advances the floor, so a broken bridge does not retry every tick.
      await api()
        .automationMarkRun(record.id, {
          status: "failed",
          error: err instanceof Error ? err.message : String(err),
        })
        .catch(() => undefined);
    }
  }, []);

  const check = useCallback(async () => {
    if (checking.current || !snapshotRef.current) return;
    checking.current = true;
    try {
      const status = await api().companionStatus();
      if (status.kind !== "ready") return;
      const listed = await api().automationList();
      if (!listed.ok) return;
      const now = new Date();
      const due = listed.value.filter(
        (record) => record.enabled && automationIsDue(record, now),
      );
      if (due.length === 0) return;
      for (const record of due) {
        if (running.current.has(record.id)) continue;
        running.current.add(record.id);
        try {
          await runOne(record);
        } finally {
          running.current.delete(record.id);
          notifyAutomationsChanged();
        }
      }
    } catch {
      // A scheduled run that cannot reach the vault or the gateway is recorded
      // by the path that failed; a throw here must not stop the next check.
    } finally {
      checking.current = false;
    }
  }, [runOne]);

  useEffect(() => {
    if (!vaultId) return;
    let cancelled = false;
    const tick = () => {
      if (!cancelled) void check();
    };
    // Check once on arrival, so a schedule that came due while the app was
    // closed is not left waiting for the first interval.
    tick();
    const timer = window.setInterval(tick, CHECK_EVERY_MS);
    const onChange = () => tick();
    window.addEventListener(AUTOMATIONS_CHANGED_EVENT, onChange);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener(AUTOMATIONS_CHANGED_EVENT, onChange);
    };
  }, [check, vaultId]);

  return null;
}
