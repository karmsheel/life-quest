import { useEffect, useRef, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import {
  recurringState,
  todayLocalIso,
  type RecurringTask,
} from "@lifequest/vault-core/map";
import { formatLocalIsoDate } from "@lifequest/vault-core/pure";
import { Button } from "@/components/ui/Button";
import { useConfirm } from "@/components/ui/useConfirm";
import { dueStateLabel, recurrenceLabel } from "@/lib/recurring-copy";
import { api } from "@/lib/ipc";
import { useVault } from "@/state/VaultProvider";
import { RecurringTaskEditor } from "./RecurringTaskEditor";

type Props = {
  /** Arrive already asking for this section: the Dashboard's manage link. */
  scrollOnMount?: boolean;
};

/**
 * The Task Manager's recurring tasks: the standing records that come round and
 * never become board cards.
 *
 * The section is drawn even with no records, because it is also where one is
 * made. Editing is inline above the list rather than a second window — a record
 * is a handful of fields and the list stays readable behind it. Pause and delete
 * write through the same `mapApply` bus as the board; delete asks the app's own
 * confirmation first because it takes the completion history with it.
 */
export function RecurringTasksSection({ scrollOnMount = false }: Props) {
  const { snapshot, refresh } = useVault();
  const { ask, dialog } = useConfirm();
  const today = todayLocalIso();
  const weekStartDay = snapshot?.settings.weekStartDay ?? "monday";
  const items = snapshot?.map?.recurring ?? [];

  /** The record being edited, wrapped so "new" (`null` record) and "closed"
   *  (`null` editor) cannot be confused. */
  const [editor, setEditor] = useState<{ item: RecurringTask | null } | null>(
    null,
  );
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sectionRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!scrollOnMount) return;
    // The link arrives while Act is mounting; one frame lets the page lay the
    // section out before the scroller is asked to move to it.
    const frame = requestAnimationFrame(() => {
      sectionRef.current?.scrollIntoView({ block: "start" });
    });
    return () => cancelAnimationFrame(frame);
  }, [scrollOnMount]);

  function openNew() {
    setError(null);
    setEditor({ item: null });
  }

  function openEdit(item: RecurringTask) {
    setError(null);
    setEditor({ item });
  }

  function closeEditor() {
    setEditor(null);
  }

  async function togglePause(item: RecurringTask) {
    if (busyId) return;
    setBusyId(item.id);
    setError(null);
    try {
      const result = await api().mapApply({
        type: "updateRecurring",
        id: item.id,
        paused: !item.paused,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      await refresh();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Failed to update the recurring task",
      );
    } finally {
      setBusyId(null);
    }
  }

  function requestDelete(item: RecurringTask) {
    ask({
      title: "Delete recurring task?",
      message: `Delete "${item.title}"? Its schedule and completion history leave the vault, and nothing restores them.`,
      confirmLabel: "Delete",
      destructive: true,
      run: () => void removeItem(item),
    });
  }

  async function removeItem(item: RecurringTask) {
    setError(null);
    try {
      const result = await api().mapApply({
        type: "deleteRecurring",
        id: item.id,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      if (editor?.item?.id === item.id) setEditor(null);
      await refresh();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Failed to delete the recurring task",
      );
    }
  }

  function renderRow(item: RecurringTask) {
    const state = recurringState(item, today, weekStartDay);
    const dueState = state === "overdue" || state === "today" ? state : null;
    const last = item.history[0];
    return (
      <li
        key={item.id}
        className="recurring-item"
        data-testid={`recurring-item-${item.id}`}
        data-paused={item.paused ? "true" : undefined}
      >
        <div className="recurring-item__body">
          <div className="recurring-item__title">
            <span className="recurring-item__name">{item.title}</span>
            {item.paused ? (
              <span className="recurring-badge recurring-badge--paused">
                Paused
              </span>
            ) : null}
            {dueState ? (
              <span className={`recurring-badge recurring-badge--${dueState}`}>
                {dueStateLabel(dueState)}
              </span>
            ) : null}
          </div>
          <span className="recurring-item__meta">
            <span>{recurrenceLabel(item.recurrence)}</span>
            <span aria-hidden="true">·</span>
            <span>Next due {formatLocalIsoDate(item.dueDate)}</span>
            {last ? (
              <>
                <span aria-hidden="true">·</span>
                <span>Last done {formatLocalIsoDate(last.completedOn)}</span>
              </>
            ) : null}
          </span>
          {item.notes ? (
            <span className="recurring-item__notes">{item.notes}</span>
          ) : null}
        </div>
        <div className="recurring-item__actions">
          <Button
            variant="ghost"
            data-testid={`recurring-edit-${item.id}`}
            onClick={() => openEdit(item)}
            disabled={busyId !== null}
          >
            <Pencil size={13} aria-hidden />
            Edit
          </Button>
          <Button
            variant="ghost"
            data-testid={`recurring-pause-${item.id}`}
            onClick={() => void togglePause(item)}
            disabled={busyId !== null}
          >
            {item.paused ? "Resume" : "Pause"}
          </Button>
          <Button
            variant="ghost"
            data-testid={`recurring-delete-${item.id}`}
            onClick={() => requestDelete(item)}
            disabled={busyId !== null}
          >
            <Trash2 size={13} aria-hidden />
            Delete
          </Button>
        </div>
      </li>
    );
  }

  return (
    <section
      className="act-page__section recurring-section"
      data-testid="recurring-section"
      ref={sectionRef}
      aria-labelledby="recurring-section-title"
    >
      <div className="act-page__section-head">
        <div className="recurring-section__heading">
          <h2
            className="act-page__section-title"
            id="recurring-section-title"
          >
            Recurring tasks
          </h2>
          <span className="recurring-section__count">{items.length}</span>
        </div>
        <Button
          variant="primary"
          data-testid="recurring-add"
          onClick={openNew}
          disabled={editor !== null}
        >
          <Plus size={14} aria-hidden />
          Add recurring task
        </Button>
      </div>

      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}

      {editor ? (
        <RecurringTaskEditor
          key={editor.item?.id ?? "new"}
          item={editor.item}
          onSaved={closeEditor}
          onCancel={closeEditor}
        />
      ) : null}

      {items.length === 0 ? (
        <p className="muted recurring-section__empty">No recurring tasks yet.</p>
      ) : (
        <ul className="recurring-list">{items.map(renderRow)}</ul>
      )}

      {dialog}
    </section>
  );
}
