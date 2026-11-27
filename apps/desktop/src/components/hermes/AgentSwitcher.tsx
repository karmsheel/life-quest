import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { AgentMark } from "@/components/ui/AgentMark";
import { useOptionalTheme } from "@/components/theme/ThemeProvider";
import {
  DEFAULT_AGENT_PICKER,
  resolveAgentPicker,
  type AgentPickerChoiceMode,
  type AgentPickerRecipe,
} from "../../../shared/agent-picker.ts";
import { useOptionalAgents } from "@/state/AgentsProvider";
import { useOptionalCompanion } from "@/state/CompanionProvider";
import type { HarnessId } from "@/vite-env";

/**
 * Which agent answers next, drawn from the picker's resolved recipe.
 *
 * The picker's *shape* is not this component's business. It is four closed axes
 * — a roster, labels, a ring and a mark size — and the app ships three named
 * modes over them (`shared/agent-picker.ts`): `one-mark` (the default: one disc
 * and a chevron, roster behind a menu), `named-chip` (the same trigger with the
 * answering agent's name beside it) and `quiet-stack` (both discs inline in the
 * composer, no capsule). A theme can also ship a `custom` combination of the
 * axes. This file only turns the resolved recipe into markup and `data-*`
 * attributes; the stylesheet owns the pixels, which is what lets a new mode be
 * a data change plus one CSS block rather than another component.
 *
 * Two rosters, one control:
 *
 *  - `menu` — a trigger in the composer's gutter opens a roster of names and
 *    blurbs. It costs a click, which is why the quiet modes choose it.
 *  - `inline` — one quiet option per agent in the composer's leading cluster,
 *    so switching is one click. `ChatPanel` owns *where* this mounts (it reads
 *    the same hook below); this component owns what it looks like.
 *
 * A switch is not a boot: the ring moves on the click and the target wears the
 * quiet pending mark until its ensure answers. Neither roster, nor the rest of
 * the app, is taken away for that — an agent is a service the studio talks to,
 * not a page it navigates to, so changing one must not read as a reconnection.
 * The one exception is the very first connect: until a companion has answered at
 * all, the agents other than the active one are disabled, because there is no
 * studio yet to switch inside.
 */

/**
 * The recipe the dock actually draws, and the mode name it came from.
 *
 * The four axes cannot tell `one-mark` from a hand-written copy of its own axes,
 * so the root reports both: the rigs and the Studio need to prove *which choice*
 * a theme made, not only what it resolved to.
 */
export type ResolvedAgentPicker = {
  mode: AgentPickerChoiceMode;
  recipe: AgentPickerRecipe;
};

/**
 * Read the picker's recipe from the worn theme.
 *
 * `useOptionalTheme` rather than `useTheme` because the dock is also mounted on
 * its own by the E2E harness pages: the real `ChatPanel`, the real stylesheet,
 * no shell around it. The picker belongs to the panel, so it has to draw there
 * too, and with no provider the honest fallback is the shipped default — the
 * same `one-mark` a fresh profile wears. The only place that decides what a
 * mode means is `resolveAgentPicker`; this hook just gets it the choice.
 */
export function useAgentPicker(): ResolvedAgentPicker {
  const choice = useOptionalTheme()?.chrome.agentPicker ?? DEFAULT_AGENT_PICKER;
  return { mode: choice.mode, recipe: resolveAgentPicker(choice) };
}

/**
 * One agent's mark, in the disc that clips it.
 *
 * The disc is not decoration: the portraits are drawn full-bleed and Pi is
 * scaled past its box, so the circle is what keeps both inside the ring (see
 * the stylesheet's mark rules). `AgentMark` still owns the artwork, the
 * light/dark treatment and the initial-only fallback.
 */
function AgentPickerMark({ id, name }: { id: string; name: string }) {
  return (
    <span className="agent-switcher__disc" aria-hidden>
      <AgentMark
        id={id}
        name={name}
        className={`agent-switcher__mark agent-switcher__mark--${id}`}
        initialClassName="agent-switcher__initial"
      />
    </span>
  );
}

export function AgentSwitcher() {
  const agents = useOptionalAgents();
  const companion = useOptionalCompanion();
  const { mode, recipe } = useAgentPicker();
  const [menuOpen, setMenuOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const visibleAgents = agents?.visibleAgents ?? [];
  const harness = companion?.harness ?? null;
  const switchHarness = companion?.switchHarness;
  const switching = companion?.switching ?? null;
  const ensuring = companion?.ensuring ?? false;

  // The dock's own menu idiom (see ComposerModelControls): Escape and a click
  // outside close it, and Escape hands focus back to the trigger so a keyboard
  // operator is not dropped at the top of the dock when the row unmounts. The
  // listeners live only while the menu is open — a closed picker must not keep
  // a document listener alive in a dock that is always on screen.
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setMenuOpen(false);
      triggerRef.current?.focus();
    };
    const onDown = (event: MouseEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return;
      setMenuOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [menuOpen]);

  // A harness page mounts the dock with neither provider: nothing to switch.
  // The same is true before the agent list arrives on a real launch.
  if (!companion || !switchHarness || visibleAgents.length === 0) return null;

  const isActive = (agent: (typeof visibleAgents)[number]) =>
    agent.active || agent.id === harness;
  /* The trigger's own agent: the one answering, or — on a list that has not
     settled its active flag yet — the first offered agent. The trigger must
     always be able to name *someone*, because it is the only way into the
     roster when the roster is a menu. */
  const activeAgent = visibleAgents.find(isActive) ?? visibleAgents[0];

  const pendingFor = (id: string) => switching === id;
  /** Title and accessible name: the agent, what it is for, or what it is doing. */
  const agentTitle = (agent: (typeof visibleAgents)[number]) =>
    pendingFor(agent.id)
      ? `${agent.name} — coming up`
      : `${agent.name} — ${agent.blurb}`;

  const attributes = {
    "data-mode": mode,
    "data-roster": recipe.roster,
    "data-labels": recipe.labels,
    "data-ring": recipe.ring,
    "data-size": recipe.size,
    "data-testid": "agent-picker",
  } as const;

  if (recipe.roster === "inline") {
    return (
      <div
        ref={rootRef}
        className="agent-switcher"
        role="radiogroup"
        aria-label="Agent"
        {...attributes}
      >
        {visibleAgents.map((agent) => {
          const id = agent.id as HarnessId;
          const active = isActive(agent);
          const pending = pendingFor(agent.id);
          /* `labels: "agent"` names only the one who answers — the point of the
             axis is that the roster says who is speaking without naming the
             alternative; `"all"` names every row. `"none"` is the quiet stack
             the shipped preset wears. */
          const named =
            recipe.labels === "all" || (recipe.labels === "agent" && active);
          return (
            <button
              key={agent.id}
              type="button"
              role="radio"
              aria-checked={active}
              aria-label={agentTitle(agent)}
              aria-busy={pending || undefined}
              title={agentTitle(agent)}
              data-agent={agent.id}
              data-pending={pending ? "true" : undefined}
              data-testid={`agent-picker-option-${agent.id}`}
              className="agent-switcher__option"
              // Only the first connect disables a choice: a switch is the app
              // working, and a control that goes dead under the pointer is the
              // jitter this surface exists to avoid.
              disabled={ensuring && !active}
              onClick={() => {
                if (!active) void switchHarness(id);
              }}
            >
              <AgentPickerMark id={agent.id} name={agent.name} />
              {named ? (
                <span className="agent-switcher__name">{agent.name}</span>
              ) : null}
            </button>
          );
        })}
      </div>
    );
  }

  const activePending = pendingFor(activeAgent.id);
  return (
    <div ref={rootRef} className="agent-switcher" {...attributes}>
      <button
        ref={triggerRef}
        type="button"
        className="agent-switcher__trigger"
        data-testid="agent-picker-trigger"
        data-agent={activeAgent.id}
        data-pending={activePending ? "true" : undefined}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        aria-busy={activePending || undefined}
        aria-label={agentTitle(activeAgent)}
        title={agentTitle(activeAgent)}
        disabled={ensuring && !isActive(activeAgent)}
        onClick={() => setMenuOpen((open) => !open)}
      >
        <AgentPickerMark id={activeAgent.id} name={activeAgent.name} />
        {recipe.labels !== "none" ? (
          <span className="agent-switcher__name">{activeAgent.name}</span>
        ) : null}
        <ChevronDown className="agent-switcher__chevron" size={11} aria-hidden />
      </button>

      {menuOpen ? (
        <div
          className="agent-switcher__menu"
          role="menu"
          aria-label="Choose an agent"
          data-testid="agent-picker-menu"
        >
          {visibleAgents.map((agent) => {
            const id = agent.id as HarnessId;
            const active = isActive(agent);
            const pending = pendingFor(agent.id);
            return (
              <button
                key={agent.id}
                type="button"
                role="menuitemradio"
                aria-checked={active}
                aria-label={agentTitle(agent)}
                title={agentTitle(agent)}
                data-agent={agent.id}
                data-pending={pending ? "true" : undefined}
                data-testid={`agent-picker-option-${agent.id}`}
                className="agent-switcher__option"
                disabled={ensuring && !active}
                onClick={() => {
                  // Clicking the agent already answering is a dismissal, not a
                  // switch: nothing to send to the companion, the menu just
                  // closes.
                  setMenuOpen(false);
                  if (!active) void switchHarness(id);
                }}
              >
                <AgentPickerMark id={agent.id} name={agent.name} />
                {/* The menu always names the agent and says what it is for:
                    from a menu, the rows *are* the roster, so a mark alone
                    would be a guess rather than a choice. */}
                <span className="agent-switcher__option-copy">
                  <span className="agent-switcher__name">{agent.name}</span>
                  <span className="agent-switcher__blurb">{agent.blurb}</span>
                </span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
