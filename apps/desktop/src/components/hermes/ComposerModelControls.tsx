import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { COMPOSER_REASONING_EFFORTS } from "../../../electron/companion-client.ts";
import type {
  CompanionModelCatalog,
  CompanionModelChoice,
  CompanionRuntimeOverride,
} from "@/vite-env";

/**
 * The thread composer's runtime row: which model the next turn runs on, and how
 * hard it should think.
 *
 * This is the dock's own version of the two pills in the Hermes Desktop
 * composer (`apps/desktop/src/app/chat/composer/model-pill.tsx` and
 * `reasoning-pill.tsx`), narrowed to what this transport can carry. Both picks
 * ride the turn itself — `POST /api/sessions/{id}/chat/stream` reads `model`,
 * `provider` and `model_options.reasoning` — so nothing here is stored on the
 * chat; the app keeps only the operator's standing preference, and a chat
 * opened in Hermes Desktop is untouched by it.
 *
 * Three states are load-bearing:
 *  - No catalog (gateway down, or a profile with no providers) → the whole row
 *    is absent, so the dock is exactly what it was before this feature.
 *  - No pick → the pill names the profile's own default and the turn carries no
 *    override at all, so default behaviour is byte-identical to before.
 *  - A pick → the pill carries `data-override="true"`, the same "this is yours,
 *    not the default" marker the Desktop pill puts on a pinned model.
 */

const EFFORT_LABELS: Record<string, string> = {
  off: "Off",
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "X-High",
  max: "Max",
};

/** Last path segment of a model id: `stealth/space-bunny-alpha` → the alpha. */
function shortModelLabel(model: string): string {
  const id = model.trim();
  const slash = id.lastIndexOf("/");
  const tail = slash >= 0 ? id.slice(slash + 1) : id;
  // The `:free` suffix is a routing tag, not part of the name a person reads.
  return tail.replace(/:free$/, "") || id;
}

function effortLabel(effort: string | undefined): string {
  const key = (effort ?? "").trim().toLowerCase();
  if (!key) return "Default";
  return EFFORT_LABELS[key] ?? key;
}

/** The catalog's own entry for a model, so the pills can branch on the
 *  gateway's capability flags rather than the app's guesses. */
function findChoice(
  catalog: CompanionModelCatalog,
  provider: string,
  model: string,
): CompanionModelChoice | null {
  if (!model.trim()) return null;
  for (const entry of catalog.providers) {
    if (provider && entry.slug !== provider) continue;
    const found = entry.models.find((choice) => choice.id === model);
    if (found) return found;
  }
  return null;
}

function providerName(catalog: CompanionModelCatalog, slug: string): string {
  const entry = catalog.providers.find((p) => p.slug === slug);
  return entry?.name ?? slug ?? "";
}

export function ComposerModelControls({
  catalog,
  disabled,
  pick,
  onChange,
}: {
  catalog: CompanionModelCatalog | null;
  disabled: boolean;
  pick: CompanionRuntimeOverride;
  onChange: (next: CompanionRuntimeOverride) => void;
}) {
  const [openMenu, setOpenMenu] = useState<"model" | "reasoning" | null>(null);
  const [providerSlug, setProviderSlug] = useState("");
  const rowRef = useRef<HTMLDivElement>(null);

  /**
   * Open or close one pill's menu. The model list always opens on *this* chat's
   * provider: browsing another provider's models on one chat must not decide what
   * the next chat's menu shows, now that the pick belongs to the chat.
   */
  const toggleMenu = (menu: "model" | "reasoning") => {
    if (menu === "model" && openMenu !== "model") setProviderSlug("");
    setOpenMenu(openMenu === menu ? null : menu);
  };

  const pickedProvider = (pick.provider ?? "").trim();
  const pickedModel = (pick.model ?? "").trim();
  const effectiveProvider = pickedProvider || catalog?.current.provider || "";
  const effectiveModel = pickedModel || catalog?.current.model || "";
  const choice = catalog ? findChoice(catalog, effectiveProvider, effectiveModel) : null;
  const listProvider = providerSlug || effectiveProvider || catalog?.providers[0]?.slug || "";
  const list = catalog?.providers.find((p) => p.slug === listProvider);
  /**
   * The catalogue serves a provider's models oldest-first; the operator reads
   * this list most-recent-first, so the models are shown reversed. "Automatic"
   * is not one of them — it is the escape hatch back to the profile's default —
   * so it stays above them either way.
   */
  const modelRows = [...(list?.models ?? [])].reverse();

  // A pill must not stay open once the composer is unusable — the row is
  // disabled while a turn streams, and a menu left hanging over a live turn
  // would offer a pick that could not be applied to it.
  useEffect(() => {
    if (disabled) setOpenMenu(null);
  }, [disabled]);

  // The row keeps the panel's own menu idiom (see the chat and chain rows):
  // Escape and a click outside close it, the trigger toggles it.
  useEffect(() => {
    if (!openMenu) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setOpenMenu(null);
    };
    const onDown = (event: MouseEvent) => {
      if (rowRef.current?.contains(event.target as Node)) return;
      setOpenMenu(null);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [openMenu]);

  if (!catalog || catalog.providers.length === 0) return null;

  const defaultLabel = catalog.current.model
    ? shortModelLabel(catalog.current.model)
    : "gateway default";

  const chooseModel = (slug: string, id: string) => {
    onChange({ ...pick, provider: slug, model: id });
    setOpenMenu(null);
  };

  const chooseAutomatic = () => {
    const next: CompanionRuntimeOverride = { ...pick };
    delete next.model;
    delete next.provider;
    onChange(next);
    setOpenMenu(null);
  };

  const chooseEffort = (effort: string) => {
    const next: CompanionRuntimeOverride = { ...pick };
    if (!effort) delete next.reasoningEffort;
    else next.reasoningEffort = effort;
    onChange(next);
    setOpenMenu(null);
  };

  const modelTitle = pickedModel
    ? `Model: ${effectiveModel} on ${providerName(catalog, effectiveProvider)} — click to change`
    : `Model: the profile's own default (${effectiveModel || "unknown"}) — click to choose another`;

  const canDisableReasoning = choice?.canDisableReasoning === true;
  // Mirrors the Desktop reasoning pill: it is present whenever the catalog says
  // the model has a reasoning control at all, and whether thinking may be
  // switched off is a narrower question, answered inside the menu.
  const supportsReasoning = choice?.reasoning === true;

  return (
    <div className="chat-panel__composer-controls" ref={rowRef}>
      <button
        type="button"
        className="chat-panel__pill"
        aria-label={modelTitle}
        title={modelTitle}
        aria-haspopup="menu"
        aria-expanded={openMenu === "model"}
        data-override={pickedModel ? "true" : "false"}
        disabled={disabled}
        onClick={() => toggleMenu("model")}
      >
        <span className="chat-panel__pill-label">
          {pickedModel ? shortModelLabel(pickedModel) : defaultLabel}
        </span>
        {pickedModel ? <span className="chat-panel__pill-dot" aria-hidden /> : null}
        <ChevronDown size={11} aria-hidden />
      </button>

      {openMenu === "model" ? (
        <div
          className="chat-panel__composer-menu chat-panel__composer-menu--model"
          role="menu"
          aria-label="Choose a model"
        >
          <div className="chat-panel__menu-providers" role="group" aria-label="Providers">
            {catalog.providers.map((provider) => (
              <button
                key={provider.slug}
                type="button"
                role="menuitemradio"
                aria-checked={provider.slug === listProvider}
                aria-label={`${provider.name}${provider.authenticated ? "" : " (not signed in)"}`}
                className="chat-panel__menu-provider"
                data-authenticated={provider.authenticated ? "true" : "false"}
                disabled={!provider.authenticated}
                onClick={() => setProviderSlug(provider.slug)}
              >
                {provider.name}
              </button>
            ))}
          </div>
          <ul className="chat-panel__menu-models">
            <li>
              <button
                type="button"
                role="menuitemradio"
                aria-checked={!pickedModel}
                aria-label={`Automatic, the profile's default model ${defaultLabel}`}
                onClick={chooseAutomatic}
              >
                Automatic
                <span className="chat-panel__menu-meta">
                  {catalog.current.provider
                    ? `${providerName(catalog, catalog.current.provider)} · ${defaultLabel}`
                    : defaultLabel}
                </span>
              </button>
            </li>
            {modelRows.map((model) => {
              const active = Boolean(pickedModel) && model.id === pickedModel;
              return (
                <li key={model.id}>
                  <button
                    type="button"
                    role="menuitemradio"
                    aria-checked={active}
                    aria-label={model.id}
                    onClick={() => chooseModel(list?.slug ?? listProvider, model.id)}
                  >
                    {shortModelLabel(model.id)}
                    {model.reasoning ? (
                      <span className="chat-panel__menu-meta">
                        {model.fast ? "thinking · fast" : "thinking"}
                      </span>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      {supportsReasoning ? (
        <button
          type="button"
          className="chat-panel__pill"
          aria-label={`Thinking level: ${effortLabel(pick.reasoningEffort)} — click to change`}
          title={`Thinking level: ${effortLabel(pick.reasoningEffort)}`}
          aria-haspopup="menu"
          aria-expanded={openMenu === "reasoning"}
          data-override={pick.reasoningEffort ? "true" : "false"}
          disabled={disabled}
          onClick={() => toggleMenu("reasoning")}
        >
          <span className="chat-panel__pill-label">{effortLabel(pick.reasoningEffort)}</span>
          <ChevronDown size={11} aria-hidden />
        </button>
      ) : null}

      {openMenu === "reasoning" ? (
        <div
          className="chat-panel__composer-menu chat-panel__composer-menu--reasoning"
          role="menu"
          aria-label="Choose a thinking level"
        >
          <ul className="chat-panel__menu-models">
            <li>
              <button
                type="button"
                role="menuitemradio"
                aria-checked={!pick.reasoningEffort}
                aria-label="Default thinking level"
                onClick={() => chooseEffort("")}
              >
                Default
                <span className="chat-panel__menu-meta">gateway default</span>
              </button>
            </li>
            {COMPOSER_REASONING_EFFORTS.map((effort) => {
              // `off` is only offered where the catalog says this model may stop
              // thinking; the rest of the ladder is clamped by the route itself.
              if (effort === "off" && !canDisableReasoning) return null;
              return (
                <li key={effort}>
                  <button
                    type="button"
                    role="menuitemradio"
                    aria-checked={pick.reasoningEffort === effort}
                    aria-label={`Thinking level ${EFFORT_LABELS[effort] ?? effort}`}
                    onClick={() => chooseEffort(effort)}
                  >
                    {EFFORT_LABELS[effort] ?? effort}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
