import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Loader2, Play, Send } from "lucide-react";
import type {
  AgentHire,
  DomainRecord,
  LifeEvent,
} from "@lifequest/vault-core";
import {
  canDispatchAgent,
  DOCUMENT_KIND_LABELS,
  DREAM_DOCUMENT_KINDS,
  recordVisible,
} from "@lifequest/vault-core/pure";
import { api } from "@/lib/ipc";
import {
  documentsToUnlockDocs,
  useActiveDomain,
  useDomainLens,
} from "@/components/shell/useActiveDomain";
import { useVault } from "@/state/VaultProvider";
import { TaskBoard } from "@/components/tasks/TaskBoard";
import { DocumentLockBadge } from "@/components/documents/DocumentLockBadge";

const BRIEF_KINDS = DREAM_DOCUMENT_KINDS.map((kind) => ({
  kind,
  label: DOCUMENT_KIND_LABELS[kind],
  room: kind === "how" ? "Track" : "Dream",
}));

type AgentRun = {
  id: string;
  agentId: string;
  agentName: string;
  prompt: string;
  reply: string;
  error: string | null;
};

function domainBrief(domain: DomainRecord): string {
  return BRIEF_KINDS.map(({ kind, label }) => {
    const body = domain.documents[kind]?.bodyMarkdown.trim() ?? "";
    return `## ${label}\n${body || "(empty)"}`;
  }).join("\n\n");
}

function buildBrief(
  active: DomainRecord | null,
  liveDomains: DomainRecord[],
): string {
  if (active) return domainBrief(active);
  return liveDomains
    .map((d) => `## ${d.meta.name}\n${domainBrief(d)}`)
    .join("\n\n");
}

export default function ActPage() {
  return <ActContent />;
}

function ActContent() {
  const { snapshot, reloadGeneration, refresh } = useVault();
  const [params] = useSearchParams();
  const taskParam = params.get("task");
  const lens = useDomainLens();
  const activeDomain = useActiveDomain();

  const liveDomains = useMemo(
    () =>
      (snapshot?.domains ?? [])
        .filter((d) => !d.meta.archivedAt)
        .slice()
        .sort((a, b) => a.meta.sortOrder - b.meta.sortOrder),
    [snapshot],
  );

  const activeAgents = useMemo(
    () => (snapshot?.agents ?? []).filter((a) => a.status === "active"),
    [snapshot],
  );

  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [promptDraft, setPromptDraft] = useState("");
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [recentEvents, setRecentEvents] = useState<LifeEvent[]>([]);
  const [brief, setBrief] = useState("");

  const title = activeDomain?.meta.name ?? "Overview";

  useEffect(() => {
    setBrief(buildBrief(activeDomain, liveDomains));
    void (async () => {
      try {
        const result = await api().logList();
        if (!result.ok) return;
        const scoped = result.value.filter((e) =>
          recordVisible(lens, e.domainSlug),
        );
        setRecentEvents(
          scoped
            .slice()
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
            .slice(0, 5),
        );
      } catch {
        setRecentEvents([]);
      }
    })();
  }, [activeDomain, liveDomains, lens, reloadGeneration]);

  // Default the selected agent once the roster loads.
  useEffect(() => {
    if (!selectedAgentId && activeAgents.length > 0) {
      setSelectedAgentId(activeAgents[0].id);
    }
  }, [activeAgents, selectedAgentId]);

  const selectedAgent: AgentHire | null = useMemo(
    () => activeAgents.find((a) => a.id === selectedAgentId) ?? null,
    [activeAgents, selectedAgentId],
  );

  const briefForAgent = useCallback(
    (agent: AgentHire): string => {
      const head = `You are acting as "${agent.name}"${
        agent.roleLabel ? ` (${agent.roleLabel})` : ""
      } for the domain "${title}".`;
      return `${head}\n\nExecute against this doctrine — stay aligned with Premise → Vision → Purpose → Strategy (How):\n\n${brief}\n\nTask: ${
        promptDraft.trim() || "Propose the next concrete action for this domain."
      }`;
    },
    [brief, promptDraft, title],
  );

  async function runAgent(agent: AgentHire) {
    if (running) return;
    setRunning(true);
    setError(null);
    const prompt = briefForAgent(agent);
    const runId = `${agent.id}:${Date.now().toString(36)}`;
    setRuns((prev) => [
      { id: runId, agentId: agent.id, agentName: agent.name, prompt, reply: "", error: null },
      ...prev,
    ]);
    try {
      const result = await api().hermesChatTools([
        { role: "user", content: prompt },
      ]);
      setRuns((prev) =>
        prev.map((r) =>
          r.id === runId
            ? {
                ...r,
                reply: result.ok ? result.value.content : "",
                error: result.ok ? null : result.error,
              }
            : r,
        ),
      );
      if (result.ok) {
        void refresh();
      } else {
        setError(result.error);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to reach Hermes";
      setError(msg);
      setRuns((prev) =>
        prev.map((r) => (r.id === runId ? { ...r, error: msg } : r)),
      );
    } finally {
      setRunning(false);
    }
  }

  const howLocked = activeDomain
    ? activeDomain.documents.how?.locked
    : liveDomains.some((d) => d.documents.how?.locked);
  const canDispatch = activeDomain
    ? canDispatchAgent(documentsToUnlockDocs(activeDomain.documents))
    : liveDomains.some((d) =>
        canDispatchAgent(documentsToUnlockDocs(d.documents)),
      );

  const briefDomains = activeDomain ? [activeDomain] : liveDomains;

  async function onMapCommand(command: import("@lifequest/vault-core/map").MapCommand) {
    const result = await api().mapApply(command);
    if (result.ok) await refresh();
  }

  return (
    <div className="act-page">
      {snapshot?.map ? (
        <TaskBoard
          state={snapshot.map}
          goals={snapshot.goals}
          onCommand={(c) => void onMapCommand(c)}
          initialOpenId={taskParam}
        />
      ) : snapshot?.mapError ? (
        <p className="form-error" role="alert">{snapshot.mapError}</p>
      ) : null}

      <header className="act-page__header">
        <div>
          <p className="act-page__eyebrow muted">Act</p>
          <h1 className="act-page__title">{title}</h1>
        </div>
        {howLocked ? (
          <span className="act-page__alignment-badge" title="Strategy (How) is locked — execution is doctrine-aligned">
            Aligned
          </span>
        ) : (
          <span
            className="act-page__alignment-badge act-page__alignment-badge--warn"
            title="Lock the Strategy (How) to align execution to doctrine"
          >
            Strategy (How) not locked
          </span>
        )}
      </header>

      <section className="act-page__section">
        <h2 className="act-page__section-title">Execution brief</h2>
        <p className="muted act-page__section-sub">
          Read-only Premise → Vision → Purpose → Strategy (How) for this
          domain. Lock the Strategy (How) to align execution.
        </p>
        <div className="act-brief">
          {briefDomains.length === 0 ? (
            <p className="muted">No live domains yet.</p>
          ) : (
            briefDomains.map((domain) => (
              <div key={domain.slug}>
                {briefDomains.length > 1 ? (
                  <p className="act-brief__label">{domain.meta.name}</p>
                ) : null}
                {BRIEF_KINDS.map(({ kind, label, room }) => {
                  const doc = domain.documents[kind];
                  const body = doc?.bodyMarkdown.trim() ?? "";
                  return (
                    <div key={kind} className="act-brief__row">
                      <div className="act-brief__head">
                        <span className="act-brief__label">{label}</span>
                        <Link to={`/${room.toLowerCase()}`} className="act-brief__room">
                          {room}
                        </Link>
                        <DocumentLockBadge locked={doc?.locked ?? false} />
                      </div>
                      <pre className="act-brief__body">
                        {body || "(empty)"}
                      </pre>
                    </div>
                  );
                })}
              </div>
            ))
          )}
        </div>
      </section>

      <section className="act-page__section">
        <div className="act-page__section-head">
          <h2 className="act-page__section-title">Run an agent</h2>
          <Link to="/personnel" className="btn btn-secondary">
            Manage agents
          </Link>
        </div>

        {activeAgents.length === 0 ? (
          <div className="act-page__empty">
            <p className="muted">
              No active agents. Scan Hermes and hire agents in Personnel, then
              return here to dispatch them against this doctrine.
            </p>
            <Link to="/personnel" className="act-page__link">
              Go to Personnel →
            </Link>
          </div>
        ) : (
          <>
            <label className="field act-run__agent-field">
              <span>Agent</span>
              <select
                className="act-run__agent-select"
                value={selectedAgentId ?? ""}
                onChange={(e) => setSelectedAgentId(e.target.value)}
              >
                {activeAgents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                    {a.roleLabel ? ` — ${a.roleLabel}` : ""}
                  </option>
                ))}
              </select>
            </label>

            <label className="field act-run__prompt-field">
              <span>Task (optional)</span>
              <textarea
                className="act-run__prompt"
                value={promptDraft}
                onChange={(e) => setPromptDraft(e.target.value)}
                rows={3}
                placeholder="Leave blank to ask the agent for the next concrete action."
                disabled={running}
              />
            </label>

            <button
              type="button"
              className="btn btn-primary act-run__send"
              onClick={() => selectedAgent && void runAgent(selectedAgent)}
              disabled={running || !selectedAgent || !canDispatch}
            >
              {running ? (
                <>
                  <Loader2 size={14} className="spin" /> Running…
                </>
              ) : (
                <>
                  <Play size={14} /> Run {selectedAgent?.name ?? "agent"}
                </>
              )}
            </button>

            {error ? (
              <p className="form-error" role="alert">
                {error}
              </p>
            ) : null}

            {runs.length > 0 ? (
              <div className="act-run__results">
                {runs.map((run) => (
                  <div key={run.id} className="act-run__result">
                    <div className="act-run__result-head">
                      <Send size={13} aria-hidden />
                      <span className="act-run__result-agent">
                        {run.agentName}
                      </span>
                      {run.error ? (
                        <span className="act-run__result-error">failed</span>
                      ) : run.reply ? (
                        <span className="act-run__result-ok">done</span>
                      ) : null}
                    </div>
                    {run.error ? (
                      <p className="form-error" role="alert">
                        {run.error}
                      </p>
                    ) : (
                      <pre className="act-run__reply">{run.reply || "…"}</pre>
                    )}
                  </div>
                ))}
              </div>
            ) : null}
          </>
        )}
      </section>

      <section className="act-page__section">
        <h2 className="act-page__section-title">Recent activity</h2>
        {recentEvents.length === 0 ? (
          <p className="muted act-page__empty-note">No activity yet.</p>
        ) : (
          <ul className="act-activity-list">
            {recentEvents.map((e) => (
              <li key={e.id} className="act-activity-row">
                <span className="act-activity-row__type">{e.type}</span>
                <span className="act-activity-row__summary">{e.summary}</span>
              </li>
            ))}
          </ul>
        )}
        <Link to="/log" className="act-page__link">
          View full log →
        </Link>
      </section>
    </div>
  );
}
