import { useMemo, useState, type FormEvent } from "react";
import { MessageCircleQuestion } from "lucide-react";
import type {
  ChatQuestion,
  ChatQuestionScope,
  DomainRecord,
} from "@lifequest/vault-core/pure";
import { Button } from "@/components/ui/Button";
import { SettingsSection } from "@/components/ui/SettingsSection";
import { NAV_ITEMS } from "@/components/shell/nav-items";
import { WING_IDS, WING_LABELS } from "@/components/shell/wing";
import { pageLabelFor } from "@/lib/page-context";
import { useVault } from "@/state/VaultProvider";

/**
 * Saved questions for the chat composer.
 *
 * A question is written once here and offered in the dock's empty thread — one
 * click sends it as the first turn. The scope is the whole point: a prompt that
 * fits the Review board has no business appearing while the operator is on the
 * Dashboard, so every question names one place (everywhere, a wing, a domain,
 * or a page) and the dock offers only the ones that fit the screen it is on.
 *
 * The list is read from the vault's settings file and every write goes back to
 * it through `updateSettings`, so the same question list follows the vault
 * across machines rather than living in one window's storage.
 */

/** The one sentinel in the scope select: every other value is `kind:target`. */
const EVERYWHERE = "everywhere";

type ScopeChoice = {
  kind: "everywhere" | ChatQuestionScope;
  value: string | null;
};

function parseScopeChoice(choice: string): ScopeChoice | null {
  if (choice === EVERYWHERE) return { kind: "everywhere", value: null };
  const at = choice.indexOf(":");
  if (at === -1) return null;
  const kind = choice.slice(0, at);
  const value = choice.slice(at + 1);
  if (kind !== "wing" && kind !== "domain" && kind !== "page") return null;
  if (!value.trim()) return null;
  return { kind, value };
}

function scopeChoiceOf(question: ChatQuestion): string {
  if (question.scope === "everywhere") return EVERYWHERE;
  return `${question.scope}:${question.value ?? ""}`;
}

/** The words the operator would use for a question's place, not its storage. */
function scopeLabel(question: ChatQuestion, domains: readonly DomainRecord[]): string {
  if (question.scope === "everywhere") return "Everywhere";
  if (question.scope === "wing") {
    const wing = WING_IDS.find((id) => id === question.value);
    return wing ? `${WING_LABELS[wing]} wing` : `${question.value ?? "Unknown"} wing`;
  }
  if (question.scope === "domain") {
    const domain = domains.find((row) => row.slug === question.value);
    return `${domain?.meta.name ?? question.value ?? "Unknown"} domain`;
  }
  const page = question.value ?? "";
  return `${pageLabelFor(page)} page`;
}

function newQuestionId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `q-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function SettingsQuestions() {
  const { snapshot, updateSettings } = useVault();
  const [draft, setDraft] = useState("");
  const [scopeChoice, setScopeChoice] = useState(EVERYWHERE);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [editScope, setEditScope] = useState(EVERYWHERE);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const questions = useMemo(
    () => snapshot?.settings.chatQuestions ?? [],
    [snapshot],
  );
  const liveDomains = useMemo(
    () =>
      (snapshot?.domains ?? [])
        .filter((domain) => !domain.meta.archivedAt)
        .slice()
        .sort((a, b) => a.meta.sortOrder - b.meta.sortOrder),
    [snapshot],
  );
  const allDomains = useMemo(
    () =>
      (snapshot?.domains ?? [])
        .slice()
        .sort((a, b) => a.meta.sortOrder - b.meta.sortOrder),
    [snapshot],
  );

  const editing = editingId
    ? questions.find((question) => question.id === editingId) ?? null
    : null;

  async function save(next: ChatQuestion[]): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      const result = await updateSettings({ chatQuestions: next });
      if (!result.ok) {
        setError(result.error);
        return false;
      }
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the question");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function onAdd(e: FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    const parsed = parseScopeChoice(scopeChoice);
    if (!text || !parsed) {
      setError("Write the question and choose where it should appear.");
      return;
    }
    const question: ChatQuestion = {
      id: newQuestionId(),
      text,
      scope: parsed.kind,
      value: parsed.value,
      createdAt: new Date().toISOString(),
    };
    if (await save([...questions, question])) {
      setDraft("");
    }
  }

  function startEdit(question: ChatQuestion) {
    setEditingId(question.id);
    setEditText(question.text);
    setEditScope(scopeChoiceOf(question));
    setError(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditText("");
    setEditScope(EVERYWHERE);
  }

  async function onSaveEdit(e: FormEvent) {
    e.preventDefault();
    const text = editText.trim();
    const parsed = parseScopeChoice(editScope);
    if (!text || !parsed) {
      setError("Write the question and choose where it should appear.");
      return;
    }
    const next = questions.map((question) =>
      question.id === editingId
        ? {
            ...question,
            text,
            scope: parsed.kind,
            value: parsed.value,
          }
        : question,
    );
    if (await save(next)) cancelEdit();
  }

  async function onDelete(question: ChatQuestion) {
    if (await save(questions.filter((row) => row.id !== question.id))) {
      if (editingId === question.id) cancelEdit();
    }
  }

  function scopeOptions(keep: ChatQuestion | null) {
    const wings = WING_IDS.map((wing) => ({
      value: `wing:${wing}`,
      label: `${WING_LABELS[wing]} wing`,
    }));
    const domains = liveDomains.map((domain) => ({
      value: `domain:${domain.slug}`,
      label: `${domain.meta.name} domain`,
      archived: false,
    }));
    // A question already pointed at an archived domain must still render its
    // own target while it is being edited; otherwise opening Edit and saving
    // would quietly move it to another place.
    if (
      keep?.scope === "domain" &&
      keep.value &&
      !domains.some((domain) => domain.value === `domain:${keep.value}`)
    ) {
      const archived = allDomains.find((domain) => domain.slug === keep.value);
      domains.push({
        value: `domain:${keep.value}`,
        label: `${archived?.meta.name ?? keep.value} domain (archived)`,
        archived: true,
      });
    }
    const pages = NAV_ITEMS.map((item) => ({
      value: `page:${item.href}`,
      label: `${item.label} page`,
    }));
    if (
      keep?.scope === "page" &&
      keep.value &&
      !pages.some((page) => page.value === `page:${keep.value}`)
    ) {
      pages.push({
        value: `page:${keep.value}`,
        label: `${pageLabelFor(keep.value)} page`,
      });
    }
    return { wings, domains, pages };
  }

  const addOptions = scopeOptions(null);
  const editOptions = scopeOptions(editing);

  return (
    <SettingsSection
      icon={<MessageCircleQuestion size={16} />}
      title="Chat questions"
      subtitle="Saved prompts offered when you start a new chat"
      contentClassName="settings-card settings-questions"
      banner={
        error ? (
          <p className="form-error" role="alert" data-testid="chat-question-error">
            {error}
          </p>
        ) : undefined
      }
    >
      <p className="settings-card__desc settings-questions__intro">
        Write the question once and choose where it belongs. It appears above the
        composer when you start a new chat there, and clicking it sends the
        question as the first turn.
      </p>

      <form className="settings-questions__add" onSubmit={(e) => void onAdd(e)}>
        <label className="settings-field">
          <span>Question or prompt</span>
          <textarea
            className="settings-questions__input"
            data-testid="chat-question-input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="e.g. How is my current expenditure tracking with my monthly budget?"
            rows={3}
            maxLength={600}
            disabled={busy}
          />
        </label>
        <label className="settings-field settings-questions__scope-field">
          <span>Show it in</span>
          <select
            data-testid="chat-question-scope"
            value={scopeChoice}
            onChange={(e) => setScopeChoice(e.target.value)}
            disabled={busy}
          >
            <option value={EVERYWHERE}>Everywhere</option>
            <ScopeGroups options={addOptions} />
          </select>
        </label>
        <div className="settings-questions__actions">
          <Button
            type="submit"
            variant="primary"
            data-testid="chat-question-add"
            disabled={busy || !draft.trim()}
          >
            Add question
          </Button>
        </div>
      </form>

      <div className="settings-questions__list-wrap">
        <h3 className="settings-panel__section-title">
          Saved questions
          <span className="settings-prompt__count" data-testid="chat-question-count">
            {questions.length}
          </span>
        </h3>
        {questions.length === 0 ? (
          <p className="muted settings-questions__empty">
            No saved questions yet. Add one above to see it in the chat composer.
          </p>
        ) : (
          <ul className="settings-questions__list" aria-label="Saved chat questions">
            {questions.map((question) =>
              editingId === question.id ? (
                <li
                  key={question.id}
                  className="settings-question settings-question--editing"
                  data-testid="chat-question"
                  data-question-id={question.id}
                >
                  <form
                    className="settings-question__edit"
                    onSubmit={(e) => void onSaveEdit(e)}
                  >
                    <label className="settings-field">
                      <span>Question or prompt</span>
                      <textarea
                        className="settings-questions__input"
                        data-testid="chat-question-edit-input"
                        value={editText}
                        onChange={(e) => setEditText(e.target.value)}
                        rows={3}
                        maxLength={600}
                        disabled={busy}
                        autoFocus
                      />
                    </label>
                    <label className="settings-field">
                      <span>Show it in</span>
                      <select
                        data-testid="chat-question-edit-scope"
                        value={editScope}
                        onChange={(e) => setEditScope(e.target.value)}
                        disabled={busy}
                      >
                        <option value={EVERYWHERE}>Everywhere</option>
                        <ScopeGroups options={editOptions} />
                      </select>
                    </label>
                    <div className="settings-question__actions">
                      <Button
                        type="submit"
                        variant="primary"
                        data-testid="chat-question-save"
                        disabled={busy || !editText.trim()}
                      >
                        Save
                      </Button>
                      <Button
                        variant="outline"
                        data-testid="chat-question-cancel"
                        disabled={busy}
                        onClick={cancelEdit}
                      >
                        Cancel
                      </Button>
                    </div>
                  </form>
                </li>
              ) : (
                <li
                  key={question.id}
                  className="settings-question"
                  data-testid="chat-question"
                  data-question-id={question.id}
                >
                  <p className="settings-question__text" data-testid="chat-question-text">
                    {question.text}
                  </p>
                  <div className="settings-question__meta">
                    <span
                      className="settings-question__scope"
                      data-testid="chat-question-scope-label"
                    >
                      {scopeLabel(question, allDomains)}
                    </span>
                    <div className="settings-question__actions">
                      <Button
                        variant="ghost"
                        data-testid="chat-question-edit"
                        disabled={busy}
                        onClick={() => startEdit(question)}
                      >
                        Edit
                      </Button>
                      <Button
                        variant="ghost"
                        data-testid="chat-question-delete"
                        disabled={busy}
                        onClick={() => void onDelete(question)}
                      >
                        Delete
                      </Button>
                    </div>
                  </div>
                </li>
              ),
            )}
          </ul>
        )}
      </div>
    </SettingsSection>
  );
}

function ScopeGroups({
  options,
}: {
  options: {
    wings: { value: string; label: string }[];
    domains: { value: string; label: string }[];
    pages: { value: string; label: string }[];
  };
}) {
  return (
    <>
      <optgroup label="Wings">
        {options.wings.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </optgroup>
      {options.domains.length > 0 ? (
        <optgroup label="Domains">
          {options.domains.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </optgroup>
      ) : null}
      <optgroup label="Pages">
        {options.pages.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </optgroup>
    </>
  );
}
