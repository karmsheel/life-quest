import { useState, type FormEvent } from "react";
import type { DecisionAmendment, DecisionRecord } from "@lifequest/vault-core";
import {
  buildEditorStart,
  coerceFieldValue,
  editableFields,
  parseProposalText,
  serializeBody,
  titleTextAt,
  withPathValue,
  type EditableField,
} from "./decision-edit";

/**
 * The operator's correction surface for a pending proposal.
 *
 * THE REASON THIS EXISTS
 *
 * A Decision is the agent's proposal, and until now the inbox could only say
 * yes or no to it. Rejecting a proposal over one misspelt project name means
 * asking the companion for the whole thing again; approving it means the typo
 * lands in the vault. So the card becomes a staging surface: the operator can
 * edit what they are about to approve, and the record keeps both versions —
 * their edit is what approval applies, the agent's version stays restorable.
 *
 * THE TWO SAVES
 *
 * `Save changes` amends only: the card goes back to the queue, still pending,
 * carrying the corrected proposal. `Approve with changes` is the amend
 * followed by the existing approve, in that order — one intent, two calls,
 * because the amend is what the approve then applies.
 *
 * WHY THE TEXT IS THE SOURCE OF TRUTH
 *
 * The same proposal is editable as typed fields, as the exact JSON (or the
 * markdown for a prose target), and — for targets that write their title from
 * the body — as the title itself. Keeping three copies of that state in sync is
 * how an editor silently saves something other than what is on screen. Here
 * the body text is the single value; the title and fields are projections of
 * it, and every edit rewrites the text. Typed fields exist so a person does not
 * have to read JSON to fix a field; the textarea stays the only way to touch
 * lists and nested structures. Malformed JSON is a normal intermediate state
 * while typing there, so it is shown inline and both saves wait for it to
 * parse — the bridge is never called with a proposal the engine would refuse.
 */
export type DecisionEditorProps = {
  decision: DecisionRecord;
  /** True while the page is talking to the vault for this card. */
  busy: boolean;
  onCancel: () => void;
  /** Amend only; the Decision stays pending. */
  onSave: (amendment: DecisionAmendment) => Promise<void>;
  /** Amend, then resolve approved. */
  onApproveChanges: (amendment: DecisionAmendment) => Promise<void>;
  /** Restore the agent's proposal as filed. */
  onRevert: () => Promise<void>;
};

type Submission = "save" | "approve" | "revert";

export function DecisionEditor({
  decision,
  busy,
  onCancel,
  onSave,
  onApproveChanges,
  onRevert,
}: DecisionEditorProps) {
  // The opening snapshot is derived once. The body's command (`type`/`op`) is
  // structural and the engine refuses to change it, so the title's home in the
  // body cannot move under the editor; the fields, by contrast, are re-derived
  // from the working text on every render so they always show it.
  const [start] = useState(() => buildEditorStart(decision));
  const [text, setText] = useState(start.text);
  const [title, setTitle] = useState(start.title);
  const [note, setNote] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState<Submission | null>(null);

  const parsed = parseProposalText(decision.target, text);
  const fields =
    parsed.kind === "json"
      ? editableFields(decision.target, parsed.body, start.binding?.path ?? null)
      : [];
  const busyNow = busy || submitting !== null;
  const error = parsed.kind === "invalid" ? parsed.error : localError;
  const titleValue =
    start.binding?.path && parsed.kind === "json"
      ? titleTextAt(parsed.body, start.binding.path)
      : title;

  function changeText(next: string) {
    setLocalError(null);
    setText(next);
  }

  function changeTitle(next: string) {
    setLocalError(null);
    setTitle(next);
    // A body-carried title has to be written into the body, or approval would
    // keep the old spelling in the file this Decision applies to.
    if (start.binding?.path && parsed.kind === "json") {
      setText(
        serializeBody(withPathValue(parsed.body, start.binding.path, next)),
      );
    }
  }

  function changeField(field: EditableField, raw: string) {
    setLocalError(null);
    if (parsed.kind !== "json") return;
    setText(
      serializeBody(
        withPathValue(parsed.body, field.key, coerceFieldValue(field.kind, raw)),
      ),
    );
  }

  /**
   * Assemble what `decisionAmend` should receive, refusing locally first.
   *
   * The JSON check is the one the bridge would repeat; doing it here keeps a
   * half-typed proposal out of the vault and lets the operator see the reason
   * next to the field instead of in a toast above the list. The title check
   * mirrors the engine's own refusal: an amendment may not leave a proposal
   * nameless.
   */
  function buildAmendment():
    | { ok: true; amendment: DecisionAmendment }
    | { ok: false; error: string } {
    if (parsed.kind === "invalid") return { ok: false, error: parsed.error };
    const amendment: DecisionAmendment = { note: note.trim() || null };
    if (parsed.kind === "prose") {
      amendment.proposedBodyMarkdown = text;
      if (start.binding) {
        const nextTitle = title.trim();
        if (!nextTitle) {
          return { ok: false, error: "A proposal needs a title — add one before saving." };
        }
        amendment.proposedTitle = nextTitle;
      }
      return { ok: true, amendment };
    }
    amendment.proposedBodyMarkdown = serializeBody(parsed.body);
    if (start.binding) {
      // For a body-carried title the engine re-derives the record title from the
      // body; sending the same value keeps a title-only correction honest even
      // if a target ever stops deriving. For `path: null` targets it is the
      // title that is authoritative.
      const nextTitle = start.binding.path
        ? titleTextAt(parsed.body, start.binding.path).trim()
        : title.trim();
      if (!nextTitle) {
        return { ok: false, error: "A proposal needs a title — add one before saving." };
      }
      amendment.proposedTitle = nextTitle;
    }
    return { ok: true, amendment };
  }

  async function submit(mode: "save" | "approve") {
    setLocalError(null);
    const built = buildAmendment();
    if (!built.ok) {
      setLocalError(built.error);
      return;
    }
    setSubmitting(mode);
    try {
      if (mode === "save") await onSave(built.amendment);
      else await onApproveChanges(built.amendment);
    } finally {
      setSubmitting(null);
    }
  }

  async function revert() {
    setLocalError(null);
    setSubmitting("revert");
    try {
      await onRevert();
    } finally {
      setSubmitting(null);
    }
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    void submit("save");
  }

  const canSubmit = !busyNow && parsed.kind !== "invalid";

  return (
    <form
      className="decision-editor"
      data-testid="decision-editor"
      onSubmit={handleSubmit}
    >
      <p className="decision-editor__lead muted">
        Correct the proposal before you answer it. Saving keeps it pending;
        approving applies this version.
      </p>

      {start.binding ? (
        <label
          className="field decision-editor__field decision-editor__title"
          data-testid="decision-editor-field-title"
        >
          <span>Title</span>
          <input
            type="text"
            value={titleValue}
            data-testid="decision-editor-title"
            disabled={busyNow || (start.binding.path !== null && parsed.kind === "invalid")}
            onChange={(event) => changeTitle(event.target.value)}
          />
        </label>
      ) : null}

      {fields.length > 0 ? (
        <div className="decision-editor__fields">
          {fields.map((field) => (
            <label
              key={field.key}
              className={[
                "field",
                "decision-editor__field",
                field.multiline ? "decision-editor__field--wide" : "",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              <span>{field.label}</span>
              <FieldInput
                field={field}
                disabled={busyNow}
                onChange={(raw) => changeField(field, raw)}
              />
            </label>
          ))}
        </div>
      ) : null}

      {start.prose ? (
        <label className="field decision-editor__field decision-editor__field--wide">
          <span>Proposal (markdown)</span>
          <textarea
            className="decision-editor__markdown"
            rows={10}
            value={text}
            data-testid="decision-editor-json"
            disabled={busyNow}
            onChange={(event) => changeText(event.target.value)}
          />
        </label>
      ) : (
        <details className="decision-editor__exact">
          <summary>Exact proposal</summary>
          <label className="field">
            <span className="muted">
              Edit the raw JSON for nested values and lists.
            </span>
            <textarea
              className="decision-editor__json"
              rows={16}
              spellCheck={false}
              value={text}
              data-testid="decision-editor-json"
              disabled={busyNow}
              onChange={(event) => changeText(event.target.value)}
            />
          </label>
        </details>
      )}

      <label className="field decision-editor__field decision-editor__note">
        <span>Why the change? (optional)</span>
        <input
          type="text"
          value={note}
          placeholder="What the agent should learn from this correction"
          data-testid="decision-editor-note"
          disabled={busyNow}
          onChange={(event) => {
            setLocalError(null);
            setNote(event.target.value);
          }}
        />
      </label>

      {error ? (
        <p className="form-error" role="alert" data-testid="decision-editor-error">
          {error}
        </p>
      ) : null}

      <div className="decision-editor__actions">
        {decision.amendedAt != null ? (
          <button
            type="button"
            className="btn btn-ghost decision-editor__revert"
            data-testid="btn-decision-revert"
            disabled={busyNow}
            onClick={() => void revert()}
          >
            {submitting === "revert" ? "Reverting…" : "Revert to agent's version"}
          </button>
        ) : null}
        <div className="decision-editor__actions-right">
          <button
            type="button"
            className="btn"
            data-testid="btn-decision-cancel"
            disabled={busyNow}
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            data-testid="btn-decision-save"
            disabled={!canSubmit}
            onClick={() => void submit("save")}
          >
            {submitting === "save" ? "Saving…" : "Save changes"}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            data-testid="btn-decision-approve-changes"
            disabled={!canSubmit}
            onClick={() => void submit("approve")}
          >
            {submitting === "approve" ? "Approving…" : "Approve with changes"}
          </button>
        </div>
      </div>
    </form>
  );
}

function FieldInput({
  field,
  disabled,
  onChange,
}: {
  field: EditableField;
  disabled: boolean;
  onChange: (raw: string) => void;
}) {
  const testId = `decision-editor-field-${field.key}`;
  if (field.kind === "boolean") {
    return (
      <select
        value={field.value}
        data-testid={testId}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="true">Yes</option>
        <option value="false">No</option>
      </select>
    );
  }
  if (field.kind === "number") {
    return (
      <input
        type="number"
        inputMode="decimal"
        value={field.value}
        data-testid={testId}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      />
    );
  }
  if (field.multiline) {
    return (
      <textarea
        rows={3}
        value={field.value}
        data-testid={testId}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      />
    );
  }
  return (
    <input
      type="text"
      value={field.value}
      placeholder={field.kind === "null" ? "Not set" : undefined}
      data-testid={testId}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}
