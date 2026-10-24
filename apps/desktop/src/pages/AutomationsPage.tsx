import { useMemo, useState, type FormEvent } from "react";
import {
  CalendarClock,
  MousePointerClick,
  Pencil,
  Play,
  Plus,
  Sparkles,
  Trash2,
} from "lucide-react";
import { formatLocalIsoDate, periodTodayLocalIso } from "@lifequest/vault-core/pure";
import { Button } from "@/components/ui/Button";
import { useConfirm } from "@/components/ui/useConfirm";
import {
  automationContextFor,
  automationHostLabel,
  automationTriggerLabel,
  formatAutomationSchedule,
  notifyAutomationsChanged,
  renderAutomationPrompt,
  type AutomationHost,
  type AutomationInput,
  type AutomationRecord,
  type AutomationScheduleFrequency,
  type AutomationTriggerType,
} from "@/lib/automations";
import { api } from "@/lib/ipc";
import { useChatDock } from "@/state/ChatDockProvider";
import { useAutomations } from "@/state/useAutomations";

const WEEKDAYS = [
  { value: 0, label: "Sunday" },
  { value: 1, label: "Monday" },
  { value: 2, label: "Tuesday" },
  { value: 3, label: "Wednesday" },
  { value: 4, label: "Thursday" },
  { value: 5, label: "Friday" },
  { value: 6, label: "Saturday" },
] as const;

const NEW_PROMPT =
  "Summarize what changed in the Daily Note for {{dateLabel}} and name the three things I should do next.";

type Draft = {
  id: string | null;
  name: string;
  description: string;
  prompt: string;
  host: AutomationHost;
  triggerType: AutomationTriggerType;
  frequency: AutomationScheduleFrequency;
  time: string;
  weekday: number;
  enabled: boolean;
};

function draftOf(record: AutomationRecord): Draft {
  const trigger = record.trigger;
  return {
    id: record.id,
    name: record.name,
    description: record.description,
    prompt: record.prompt,
    host: record.host,
    triggerType: trigger.type,
    frequency: trigger.type === "schedule" ? trigger.frequency : "daily",
    time: trigger.type === "schedule" ? trigger.time : "09:00",
    weekday:
      trigger.type === "schedule" && trigger.weekday !== null
        ? trigger.weekday
        : 1,
    enabled: record.enabled,
  };
}

function blankDraft(): Draft {
  return {
    id: null,
    name: "",
    description: "",
    prompt: NEW_PROMPT,
    host: "daily-note",
    triggerType: "manual",
    frequency: "daily",
    time: "09:00",
    weekday: 1,
    enabled: true,
  };
}

function inputOf(draft: Draft): AutomationInput {
  return {
    name: draft.name.trim(),
    description: draft.description.trim(),
    prompt: draft.prompt.trim(),
    host: draft.host,
    trigger:
      draft.triggerType === "manual"
        ? { type: "manual" }
        : {
            type: "schedule",
            frequency: draft.frequency,
            time: draft.time,
            weekday: draft.frequency === "weekly" ? draft.weekday : null,
          },
    enabled: draft.enabled,
  };
}

function lastRunLine(record: AutomationRecord): string | null {
  if (!record.lastRunAt || !record.lastRunStatus) return null;
  const at = new Date(record.lastRunAt);
  if (Number.isNaN(at.getTime())) return null;
  const when = at.toLocaleString(undefined, {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
  const status =
    record.lastRunStatus.charAt(0).toUpperCase() + record.lastRunStatus.slice(1);
  return `Last run ${when} · ${status}`;
}

/**
 * The automations shelf.
 *
 * A row is one job, its trigger type and where it reads from. Manual jobs run
 * from this page or from the page they belong to; scheduled jobs run while
 * LifeQuest is open, and their last run is written back to the vault. The editor
 * is inline rather than a second window: a job is a few fields, and the list
 * stays readable behind it.
 */
export default function AutomationsPage() {
  const { automations, error: loadError, reload } = useAutomations();
  const chatDock = useChatDock();
  const { ask, dialog } = useConfirm();
  const [editor, setEditor] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);

  const manual = useMemo(
    () => (automations ?? []).filter((record) => record.trigger.type === "manual"),
    [automations],
  );
  const scheduled = useMemo(
    () => (automations ?? []).filter((record) => record.trigger.type === "schedule"),
    [automations],
  );

  function openNew() {
    setFormError(null);
    setEditor(blankDraft());
  }

  function openEdit(record: AutomationRecord) {
    setFormError(null);
    setEditor(draftOf(record));
  }

  async function saveEditor(event: FormEvent) {
    event.preventDefault();
    if (!editor || saving) return;
    const input = inputOf(editor);
    if (!input.name) {
      setFormError("Name the automation.");
      return;
    }
    if (!input.prompt) {
      setFormError("Write the prompt the agent should run.");
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      const result = editor.id
        ? await api().automationUpdate(editor.id, input)
        : await api().automationCreate(input);
      if (!result.ok) {
        setFormError(result.error);
        return;
      }
      setEditor(null);
      notifyAutomationsChanged();
      await reload();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function setEnabled(record: AutomationRecord, enabled: boolean) {
    try {
      const result = await api().automationUpdate(record.id, {
        name: record.name,
        description: record.description,
        prompt: record.prompt,
        host: record.host,
        trigger: record.trigger,
        enabled,
      });
      if (!result.ok) {
        setPageError(result.error);
        return;
      }
      notifyAutomationsChanged();
      await reload();
    } catch (err) {
      setPageError(err instanceof Error ? err.message : String(err));
    }
  }

  async function runNow(record: AutomationRecord) {
    if (runningId) return;
    setRunningId(record.id);
    setPageError(null);
    try {
      const date = periodTodayLocalIso();
      const dateLabel = formatLocalIsoDate(date);
      let context: string | undefined;
      if (record.host === "daily-note") {
        const note = await api().dailyNoteGet(date);
        const body = note.ok ? note.value.bodyMarkdown : "";
        if (!body.trim()) {
          setPageError(
            "No Daily Note for today. Write today's note first, or run this from its page.",
          );
          return;
        }
        context = automationContextFor(record, { date, dateLabel, body });
      }
      const created = await api().companionSessionCreate(
        `${record.name} · ${dateLabel}`,
      );
      if (!created.ok) {
        setPageError(created.error);
        return;
      }
      chatDock.requestSession(
        created.value.id,
        renderAutomationPrompt(record.prompt, { date, dateLabel }),
        context,
      );
    } catch (err) {
      setPageError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunningId(null);
    }
  }

  function removeAutomation(record: AutomationRecord) {
    ask({
      title: "Delete automation",
      message: `Delete "${record.name}"? Its definition leaves the vault, and nothing restores it. Chats it already started stay in Hermes.`,
      confirmLabel: "Delete automation",
      destructive: true,
      run: () => void runDelete(record.id),
    });
  }

  async function runDelete(id: string) {
    try {
      const result = await api().automationDelete(id);
      if (!result.ok) {
        setPageError(result.error);
        return;
      }
      if (editor?.id === id) setEditor(null);
      notifyAutomationsChanged();
      await reload();
    } catch (err) {
      setPageError(err instanceof Error ? err.message : String(err));
    }
  }

  function renderRow(record: AutomationRecord) {
    const scheduled = record.trigger.type === "schedule";
    const Icon = scheduled ? CalendarClock : MousePointerClick;
    const lastRun = lastRunLine(record);
    return (
      <li
        key={record.id}
        className="automation-row"
        data-testid={`automation-${record.id}`}
        data-trigger={record.trigger.type}
      >
        <span className="automation-row__icon" aria-hidden="true">
          <Icon size={16} />
        </span>
        <div className="automation-row__body">
          <div className="automation-row__title">
            <span className="automation-row__name">{record.name}</span>
            {!record.enabled ? (
              <span className="automation-row__badge">Paused</span>
            ) : null}
          </div>
          {record.description ? (
            <span className="automation-row__desc">{record.description}</span>
          ) : null}
          <span
            className="automation-row__meta"
            title={record.lastError ?? undefined}
          >
            <span>{automationTriggerLabel(record.trigger)}</span>
            {scheduled ? (
              <>
                <span aria-hidden="true">·</span>
                <span>{formatAutomationSchedule(record.trigger)}</span>
              </>
            ) : null}
            <span aria-hidden="true">·</span>
            <span>{automationHostLabel(record.host)}</span>
            {lastRun ? (
              <>
                <span aria-hidden="true">·</span>
                <span>{lastRun}</span>
              </>
            ) : null}
          </span>
          {record.lastRunStatus === "failed" && record.lastError ? (
            <span className="automation-row__error">{record.lastError}</span>
          ) : null}
        </div>
        <div className="automation-row__actions">
          <Button
            variant="outline"
            data-testid={`automation-run-${record.id}`}
            onClick={() => void runNow(record)}
            disabled={runningId !== null}
          >
            <Play size={13} aria-hidden />
            {runningId === record.id ? "Opening…" : "Run now"}
          </Button>
          <Button
            variant="ghost"
            data-testid={`automation-edit-${record.id}`}
            onClick={() => openEdit(record)}
          >
            <Pencil size={13} aria-hidden />
            Edit
          </Button>
          <Button
            variant="ghost"
            data-testid={`automation-toggle-${record.id}`}
            onClick={() => void setEnabled(record, !record.enabled)}
          >
            {record.enabled ? "Pause" : "Resume"}
          </Button>
          <Button
            variant="ghost"
            data-testid={`automation-delete-${record.id}`}
            onClick={() => removeAutomation(record)}
          >
            <Trash2 size={13} aria-hidden />
            Delete
          </Button>
        </div>
      </li>
    );
  }

  return (
    <div className="automations-page">
      <header className="automations-page__header">
        <div>
          <h1 className="stub-page__title">Automations</h1>
          <p className="stub-page__desc muted">
            One-click and scheduled jobs that read a page and open a chat with the
            agent.
          </p>
        </div>
        <Button
          variant="primary"
          className="automations-page__new"
          data-testid="automation-new"
          onClick={openNew}
          disabled={editor !== null}
        >
          <Plus size={14} aria-hidden />
          New automation
        </Button>
      </header>

      {pageError ? (
        <p className="form-error" role="alert">
          {pageError}
        </p>
      ) : null}
      {loadError ? (
        <div className="automations-page__load-error" role="alert">
          <p className="form-error">{loadError}</p>
          <Button variant="ghost" onClick={() => void reload()}>
            Retry
          </Button>
        </div>
      ) : null}

      {editor ? (
        <form
          className="automation-editor"
          data-testid="automation-editor"
          onSubmit={(event) => void saveEditor(event)}
        >
          <div className="automation-editor__head">
            <h2>{editor.id ? "Edit automation" : "New automation"}</h2>
            <p className="muted">
              A manual job runs when you press its button. A scheduled job runs
              while LifeQuest is open.
            </p>
          </div>

          <div className="automation-editor__row">
            <label className="field">
              Name
              <input
                data-testid="automation-name"
                value={editor.name}
                maxLength={80}
                onChange={(event) =>
                  setEditor({ ...editor, name: event.target.value })
                }
                placeholder="Morning sweep"
                required
              />
            </label>
            <label className="field">
              Page in context
              <select
                data-testid="automation-host"
                value={editor.host}
                onChange={(event) =>
                  setEditor({
                    ...editor,
                    host: event.target.value as AutomationHost,
                  })
                }
              >
                <option value="daily-note">Daily Note</option>
                <option value="none">No page (prompt only)</option>
              </select>
            </label>
          </div>

          <label className="field">
            Description
            <input
              data-testid="automation-description"
              value={editor.description}
              maxLength={240}
              onChange={(event) =>
                setEditor({ ...editor, description: event.target.value })
              }
              placeholder="What this job does, for the shelf"
            />
          </label>

          <div className="automation-editor__trigger">
            <span className="automation-editor__label">Trigger</span>
            <div
              className="ui-segmented"
              role="radiogroup"
              aria-label="Automation trigger"
            >
              {(
                [
                  ["manual", "Manual"],
                  ["schedule", "Scheduled"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={editor.triggerType === value}
                  className={`ui-segmented__option${editor.triggerType === value ? " is-active" : ""}`}
                  data-testid={`automation-trigger-${value}`}
                  onClick={() =>
                    setEditor({ ...editor, triggerType: value })
                  }
                >
                  {label}
                </button>
              ))}
            </div>
            {editor.triggerType === "schedule" ? (
              <div className="automation-editor__schedule">
                <label className="field">
                  Repeats
                  <select
                    data-testid="automation-frequency"
                    value={editor.frequency}
                    onChange={(event) =>
                      setEditor({
                        ...editor,
                        frequency: event.target
                          .value as AutomationScheduleFrequency,
                      })
                    }
                  >
                    <option value="daily">Every day</option>
                    <option value="weekly">Every week</option>
                  </select>
                </label>
                {editor.frequency === "weekly" ? (
                  <label className="field">
                    Day
                    <select
                      data-testid="automation-weekday"
                      value={editor.weekday}
                      onChange={(event) =>
                        setEditor({
                          ...editor,
                          weekday: Number(event.target.value),
                        })
                      }
                    >
                      {WEEKDAYS.map((day) => (
                        <option key={day.value} value={day.value}>
                          {day.label}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
                <label className="field">
                  At
                  <input
                    type="time"
                    data-testid="automation-time"
                    value={editor.time}
                    onChange={(event) =>
                      setEditor({ ...editor, time: event.target.value })
                    }
                    required
                  />
                </label>
              </div>
            ) : null}
          </div>

          <label className="field">
            Prompt
            <textarea
              data-testid="automation-prompt"
              value={editor.prompt}
              maxLength={12000}
              rows={7}
              onChange={(event) =>
                setEditor({ ...editor, prompt: event.target.value })
              }
              placeholder="What should the agent do? Use {{dateLabel}} for the day."
              required
            />
          </label>
          <p className="automation-editor__hint muted">
            Use {"{{dateLabel}}"} for the day the automation runs, and{" "}
            {"{{date}}"} for its ISO date. With the Daily Note in context, the
            whole note is handed to the agent.
          </p>

          <div className="automation-editor__foot">
            <label className="automation-editor__enabled">
              <input
                type="checkbox"
                data-testid="automation-enabled"
                checked={editor.enabled}
                onChange={(event) =>
                  setEditor({ ...editor, enabled: event.target.checked })
                }
              />
              Enabled
            </label>
            {formError ? (
              <p className="form-error" role="alert">
                {formError}
              </p>
            ) : null}
            <div className="automation-editor__actions">
              {editor.id ? (
                <Button
                  variant="ghost"
                  type="button"
                  data-testid="automation-delete"
                  onClick={() => {
                    const record = automations?.find(
                      (candidate) => candidate.id === editor.id,
                    );
                    if (record) removeAutomation(record);
                  }}
                >
                  <Trash2 size={13} aria-hidden />
                  Delete
                </Button>
              ) : null}
              <Button
                variant="ghost"
                type="button"
                data-testid="automation-cancel"
                onClick={() => {
                  setEditor(null);
                  setFormError(null);
                }}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                type="submit"
                data-testid="automation-save"
                disabled={saving}
              >
                {saving ? "Saving…" : "Save automation"}
              </Button>
            </div>
          </div>
        </form>
      ) : null}

      {!automations ? (
        loadError ? null : <p className="muted">Loading automations…</p>
      ) : automations.length === 0 ? (
        <div className="automations-page__empty">
          <Sparkles size={18} aria-hidden />
          <p>No automations yet. Create one to put a page in front of the agent.</p>
        </div>
      ) : (
        <>
          <section
            className="automations-page__group"
            aria-labelledby="automations-manual"
          >
            <h2
              className="automations-page__group-title"
              id="automations-manual"
            >
              Manual <span>{manual.length}</span>
            </h2>
            <p className="automations-page__group-desc muted">
              Runs when you press its button, or Run now.
            </p>
            {manual.length > 0 ? (
              <ul className="automations-page__list">
                {manual.map(renderRow)}
              </ul>
            ) : (
              <p className="muted">None yet.</p>
            )}
          </section>

          <section
            className="automations-page__group"
            aria-labelledby="automations-scheduled"
          >
            <h2
              className="automations-page__group-title"
              id="automations-scheduled"
            >
              Scheduled <span>{scheduled.length}</span>
            </h2>
            <p className="automations-page__group-desc muted">
              Runs on its schedule while LifeQuest is open; a run missed while it
              was closed fires once when it returns.
            </p>
            {scheduled.length > 0 ? (
              <ul className="automations-page__list">
                {scheduled.map(renderRow)}
              </ul>
            ) : (
              <p className="muted">None yet.</p>
            )}
          </section>
        </>
      )}

      {dialog}
    </div>
  );
}
