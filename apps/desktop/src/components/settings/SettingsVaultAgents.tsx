import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Bot, Check, Cpu } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { api } from "@/lib/ipc";
import { useCompanion } from "@/state/CompanionProvider";
import { useVault } from "@/state/VaultProvider";
import type {
  HarnessId,
  VaultAgentAddInput,
  VaultAgentProfile,
  VaultAgentsState,
} from "@/vite-env";

/**
 * Settings → Hermes → Agents in this vault.
 *
 * A vault is the profile that is loaded, so its chats AND its agent belong to
 * it, and every new vault starts with the built-in Pi companion. This section
 * replaces the app-level companion and profile pickers, and that is the point:
 * "which agent is the app?" is the question that let a fresh vault inherit the
 * previous vault's Hermes profile, with its memory, skills and knowledge.
 *
 * The decision is drawn as data rather than a picker: Pi is always here; Hermes
 * is either bound to this vault (with the shared-memory warning when the same
 * profile also works somewhere else) or absent, with the only two ways to add
 * it — a fresh agent for this vault, or an explicit reuse of an installed one.
 * Reuse is never the default, and the warning names the vaults whose memory
 * would be shared before the operator picks it.
 */
export function SettingsVaultAgents() {
  const { snapshot } = useVault();
  const { harness, switchHarness, refreshHarnesses } = useCompanion();
  const vaultId = snapshot?.lifequest.id ?? null;

  const [state, setState] = useState<VaultAgentsState | null>(null);
  /** The bridge answered something that is not a vault-agents state (a stub). */
  const [unavailable, setUnavailable] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /** Which chooser is open: the reuse list, or Change agent's list. */
  const [chooser, setChooser] = useState<"reuse" | "change" | null>(null);
  /** The operation in flight, as a label, so every control is disabled with it. */
  const [busy, setBusy] = useState<string | null>(null);

  /**
   * Read this vault's agents. The sequence guard drops an answer that arrives
   * after a vault switch or a newer read — the binding it names belongs to the
   * vault that asked.
   */
  const readSeq = useRef(0);
  const load = useCallback(async () => {
    const seq = ++readSeq.current;
    try {
      const next = await api().vaultAgentsGet();
      if (seq !== readSeq.current) return;
      if (!isVaultAgentsState(next)) {
        // A harness page's bridge is a stub with no such read: the section says
        // so instead of inventing a binding.
        setUnavailable(true);
        return;
      }
      setUnavailable(false);
      setState(next);
      setError(null);
    } catch (err) {
      if (seq !== readSeq.current) return;
      setUnavailable(true);
      setError(err instanceof Error ? err.message : sentenceFor(err));
    }
  }, []);

  // Read on mount and again whenever the open vault changes: the binding, the
  // installed profiles and their `usedBy` vaults are all answers about one vault.
  useEffect(() => {
    void load();
  }, [load, vaultId]);

  const addAgent = useCallback(
    async (input: VaultAgentAddInput, label: string) => {
      setBusy(label);
      setError(null);
      setNotice(null);
      try {
        const result = await api().vaultAgentsAddHermes(input);
        if (!result.ok) {
          setError(sentenceFor(result.error));
          return;
        }
        setChooser(null);
        // Adding binds the agent but does not activate it; the card must show
        // the new profile, and the dock's pill list is re-read because the same
        // binding is what offers Hermes in the switcher.
        await load();
        await refreshHarnesses();
        // Binding is not activation (main preserves the vault's harness), so the
        // sentence says what happened and leaves the switch to the card's own
        // Use Hermes action.
        setNotice(
          input.mode === "fresh"
            ? "A new Hermes agent is bound to this vault. Use Hermes to make it the agent here."
            : `The ${input.profile} agent is bound to this vault. Use Hermes to make it the agent here.`,
        );
      } catch (err) {
        setError(sentenceFor(err));
      } finally {
        setBusy(null);
      }
    },
    [load, refreshHarnesses],
  );

  const removeAgent = useCallback(async () => {
    setBusy("remove");
    setError(null);
    setNotice(null);
    try {
      const result = await api().vaultAgentsRemoveHermes();
      if (!result.ok) {
        setError(sentenceFor(result.error));
        return;
      }
      setChooser(null);
      await load();
      await refreshHarnesses();
      setNotice("Hermes was removed from this vault. It is back on Pi.");
    } catch (err) {
      setError(sentenceFor(err));
    } finally {
      setBusy(null);
    }
  }, [load, refreshHarnesses]);

  const useAgent = useCallback(
    async (target: HarnessId) => {
      setBusy(`switch-${target}`);
      setError(null);
      setNotice(null);
      try {
        await switchHarness(target);
        await load();
        setNotice(
          target === "pi"
            ? "This vault now uses Pi."
            : "This vault now uses Hermes.",
        );
      } catch (err) {
        setError(sentenceFor(err));
      } finally {
        setBusy(null);
      }
    },
    [load, switchHarness],
  );

  if (unavailable) {
    // The page is not broken; it is just not the app (a harness page's stub
    // bridge has no vault-agents read). Say that instead of a red banner.
    return (
      <section className="settings-hermes__block" data-testid="vault-agents">
        <h3 className="settings-hermes__heading">Agents in this vault</h3>
        <p className="settings-hermes__note muted" role="status">
          {error ?? "This page cannot read the vault's agents."}
        </p>
      </section>
    );
  }

  const binding = state?.binding ?? null;
  const activeHarness = harness ?? binding?.harness ?? null;
  const piActive = binding !== null && activeHarness === "pi";
  const boundProfile = binding?.hermesProfile ?? null;
  const bound = boundProfile
    ? state?.installedProfiles.find((profile) => profile.name === boundProfile) ?? null
    : null;
  // `usedBy` is main's list of the vaults already bound to this profile; the
  // warning is about the OTHER ones, so the open vault is dropped by id (main
  // may list the profile's every vault, this vault included).
  const boundUsedBy = otherVaults(bound?.usedBy ?? [], state?.vaultId ?? null);
  const hermesActive = binding !== null && activeHarness === "hermes";
  const disabled = busy !== null;

  return (
    <section className="settings-hermes__block" data-testid="vault-agents">
      <h3 className="settings-hermes__heading">Agents in this vault</h3>
      <p className="settings-hermes__note muted">
        A vault has one Hermes agent. A new vault starts with Pi: add an agent
        for this vault, or explicitly reuse one that already works on another
        vault.
      </p>

      {error ? (
        <p className="form-error" role="alert" data-testid="vault-agent-error">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="form-message" role="status" data-testid="vault-agent-notice">
          {notice}
        </p>
      ) : null}

      {!state ? (
        <p className="settings-hermes__note muted" role="status">
          Reading this vault&apos;s agents…
        </p>
      ) : !state.vaultOpen ? (
        <p className="settings-hermes__note muted" role="status">
          Open a vault to choose which agent it runs on.
        </p>
      ) : (
        <>
          <div className="vault-agents">
            {/* Pi: built in, in every vault, and never anything to add. */}
            <div
              className={
                piActive ? "vault-agent-card vault-agent-card--active" : "vault-agent-card"
              }
              data-testid="vault-agent-pi"
              data-active={piActive || undefined}
            >
              <div className="vault-agent-card__head">
                <span className="vault-agent-card__icon" aria-hidden="true">
                  <Cpu size={15} />
                </span>
                <div className="vault-agent-card__title">
                  <span className="vault-agent-card__name">Pi</span>
                  <span className="vault-agent-card__desc">
                    Built in · always in this vault
                  </span>
                </div>
                {piActive ? (
                  <span
                    className="vault-agent-card__tag"
                    data-testid="vault-agent-pi-active"
                  >
                    <Check size={11} aria-hidden="true" />
                    Active in this vault
                  </span>
                ) : null}
              </div>
              <p className="vault-agent-card__copy">
                The built-in companion. Every vault has it, and it keeps this
                vault&apos;s chats to itself.
              </p>
              {piActive ? null : (
                <div className="settings-hermes__actions">
                  <Button
                    variant="outline"
                    data-testid="vault-agent-use-pi"
                    aria-label="Use Pi in this vault"
                    disabled={disabled}
                    onClick={() => void useAgent("pi")}
                  >
                    Use Pi
                  </Button>
                </div>
              )}
            </div>

            {/* Hermes: bound, or absent with the two explicit ways to add it. */}
            {boundProfile ? (
              <div
                className={
                  hermesActive
                    ? "vault-agent-card vault-agent-card--active"
                    : "vault-agent-card"
                }
                data-testid="vault-agent-hermes"
                data-bound="true"
                data-active={hermesActive || undefined}
              >
                <div className="vault-agent-card__head">
                  <span className="vault-agent-card__icon" aria-hidden="true">
                    <Bot size={15} />
                  </span>
                  <div className="vault-agent-card__title">
                    <span className="vault-agent-card__name">Hermes</span>
                    <span className="vault-agent-card__desc">
                      Profile{" "}
                      {/* The id's text is the profile name and nothing else:
                          the rig reads it to name the agent. */}
                      <code data-testid="vault-agent-hermes-profile">
                        {boundProfile}
                      </code>
                    </span>
                  </div>
                  {hermesActive ? (
                    <span
                      className="vault-agent-card__tag"
                      data-testid="vault-agent-hermes-active"
                    >
                      <Check size={11} aria-hidden="true" />
                      Active in this vault
                    </span>
                  ) : null}
                </div>
                <p
                  className="vault-agent-card__copy"
                  data-testid="vault-agent-hermes-bound"
                >
                  Bound to this vault. Its chats are kept with the profile, not
                  in the vault folder.
                </p>
                {boundUsedBy.length > 0 ? (
                  <p
                    className="vault-agent-card__warning"
                    role="alert"
                    data-testid="vault-agent-shared-warning"
                  >
                    <AlertTriangle size={12} aria-hidden="true" /> This profile is
                    also used by {namesOf(boundUsedBy)}. Memory, skills and
                    knowledge are shared between those vaults and this one.
                  </p>
                ) : null}
                <div className="settings-hermes__actions">
                  {hermesActive ? null : (
                    <Button
                      variant="outline"
                      data-testid="vault-agent-use-hermes"
                      aria-label="Use Hermes in this vault"
                      disabled={disabled}
                      onClick={() => void useAgent("hermes")}
                    >
                      Use Hermes
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    data-testid="vault-agent-change"
                    aria-label="Change this vault's Hermes agent"
                    disabled={disabled}
                    onClick={() => {
                      setError(null);
                      setNotice(null);
                      setChooser(chooser === "change" ? null : "change");
                    }}
                  >
                    Change agent
                  </Button>
                  <Button
                    variant="outline"
                    destructive
                    data-testid="vault-agent-remove-hermes"
                    aria-label="Remove Hermes from this vault"
                    disabled={disabled}
                    onClick={() => void removeAgent()}
                  >
                    Remove from this vault
                  </Button>
                </div>
              </div>
            ) : (
              <div
                className="vault-agent-card vault-agent-card--empty"
                data-testid="vault-agent-hermes"
                data-bound="false"
              >
                <div className="vault-agent-card__head">
                  <span className="vault-agent-card__icon" aria-hidden="true">
                    <Bot size={15} />
                  </span>
                  <div className="vault-agent-card__title">
                    <span className="vault-agent-card__name">Hermes</span>
                    <span
                      className="vault-agent-card__desc"
                      data-testid="vault-agent-hermes-empty"
                    >
                      This vault has no Hermes agent.
                    </span>
                  </div>
                </div>
                <p className="vault-agent-card__copy">
                  A Hermes agent is the external sidekick, with its own profile,
                  memory and skills. Add one that belongs to this vault.
                </p>
                <div className="settings-hermes__actions">
                  <Button
                    variant="primary"
                    data-testid="vault-agent-create"
                    aria-label="Create a new agent for this vault"
                    disabled={disabled}
                    onClick={() => void addAgent({ mode: "fresh" }, "create")}
                  >
                    Create a new agent for this vault
                  </Button>
                  <Button
                    variant="outline"
                    data-testid="vault-agent-reuse"
                    aria-label="Use an existing agent in this vault"
                    disabled={disabled}
                    onClick={() => {
                      setError(null);
                      setNotice(null);
                      setChooser(chooser === "reuse" ? null : "reuse");
                    }}
                  >
                    Use an existing agent…
                  </Button>
                </div>
                <p className="vault-agent-card__note">
                  Reusing an existing agent is not the default: memory, skills
                  and knowledge would be shared with the vaults it already works
                  on.
                </p>
              </div>
            )}
          </div>

          {chooser ? (
            <ExistingAgentChooser
              mode={chooser}
              profiles={state.installedProfiles}
              currentProfile={boundProfile}
              currentVaultId={state.vaultId}
              disabled={disabled}
              onPick={(profile) =>
                void addAgent({ mode: "existing", profile }, "reuse")
              }
              onCancel={() => setChooser(null)}
            />
          ) : null}
        </>
      )}
    </section>
  );
}

/**
 * The installed profiles this machine already has, each with the vaults it
 * already works on.
 *
 * This list is the explicit reuse decision, so the warning is not a footnote:
 * a profile whose `usedBy` is not empty says, before it is picked, which vaults
 * would share its memory, skills and knowledge.
 */
function ExistingAgentChooser({
  mode,
  profiles,
  currentProfile,
  currentVaultId,
  disabled,
  onPick,
  onCancel,
}: {
  mode: "reuse" | "change";
  profiles: VaultAgentProfile[];
  currentProfile: string | null;
  currentVaultId: string | null;
  disabled: boolean;
  onPick: (profile: string) => void;
  onCancel: () => void;
}) {
  return (
    <div className="vault-agent-chooser" data-testid="vault-agent-existing-list">
      <h4 className="vault-agent-chooser__heading">
        {mode === "change"
          ? "Change this vault's Hermes agent"
          : "Use an existing agent in this vault"}
      </h4>
      <p className="vault-agent-chooser__lead muted">
        Reusing an agent is not the default: it shares that agent&apos;s memory,
        skills and knowledge with every vault it already works on.
      </p>
      {profiles.length === 0 ? (
        <p className="settings-hermes__note muted" role="status">
          No Hermes agents are installed on this machine.
        </p>
      ) : (
        <div className="vault-agent-chooser__rows">
          {profiles.map((profile) => {
            const current = profile.name === currentProfile;
            const sharedWith = otherVaults(profile.usedBy, currentVaultId);
            return (
              <button
                key={profile.name}
                type="button"
                className="vault-agent-chooser__row"
                data-testid="vault-agent-existing"
                data-profile={profile.name}
                data-current={current || undefined}
                aria-label={
                  current
                    ? `${profile.name} is the agent this vault uses`
                    : `Use the ${profile.name} agent in this vault`
                }
                disabled={disabled || current}
                onClick={() => onPick(profile.name)}
              >
                <span className="vault-agent-chooser__row-main">
                  <span className="vault-agent-chooser__name">
                    {profile.name}
                    {profile.isDefault ? (
                      <span className="vault-agent-chooser__tag">default</span>
                    ) : null}
                  </span>
                  <span className="vault-agent-chooser__path">{profile.path}</span>
                </span>
                {current ? (
                  <span className="vault-agent-chooser__in-use">
                    <Check size={12} aria-hidden="true" />
                    In use
                  </span>
                ) : (
                  <span className="vault-agent-chooser__pick" aria-hidden="true" />
                )}
                {sharedWith.length > 0 ? (
                  <span
                    className="vault-agent-chooser__warning"
                    data-testid="vault-agent-existing-warning"
                  >
                    Also used by {namesOf(sharedWith)} — memory, skills and
                    knowledge would be shared with those vaults.
                  </span>
                ) : (
                  <span className="vault-agent-chooser__safe">
                    Not used by another vault yet.
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
      <div className="settings-hermes__actions">
        <Button
          variant="ghost"
          data-testid="vault-agent-choose-cancel"
          aria-label="Cancel choosing an existing agent"
          onClick={onCancel}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}

/** The vaults other than this one, so a warning never names the open vault. */
function otherVaults(
  usedBy: VaultAgentProfile["usedBy"],
  currentVaultId: string | null,
): VaultAgentProfile["usedBy"] {
  if (!currentVaultId) return usedBy;
  return usedBy.filter((vault) => vault.vaultId !== currentVaultId);
}

/** "Beta", "Beta and Gamma", "Beta, Gamma and Delta". */
function namesOf(usedBy: VaultAgentProfile["usedBy"]): string {
  const names = usedBy.map((vault) => vault.vaultName);
  if (names.length === 0) return "no other vault";
  if (names.length === 1) return names[0]!;
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** A vault-agents answer, as opposed to a stub's `ok(null)`-shaped reply. */
function isVaultAgentsState(value: unknown): value is VaultAgentsState {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<VaultAgentsState>;
  return Boolean(
    candidate.binding &&
      typeof candidate.binding === "object" &&
      Array.isArray(candidate.installedProfiles),
  );
}

/** Every failure this page reports is a sentence, whatever came back. */
function sentenceFor(err: unknown): string {
  if (typeof err === "string" && err.trim()) {
    const text = err.trim();
    return /[.!?]$/.test(text) ? text : `${text}.`;
  }
  if (err instanceof Error && err.message.trim()) {
    const text = err.message.trim();
    return /[.!?]$/.test(text) ? text : `${text}.`;
  }
  return "The vault's agents could not be changed.";
}
