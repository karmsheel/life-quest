import { useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Button } from "@/components/ui/Button";
import { AgentPickerControls } from "@/components/settings/AgentPickerControls";
import { DomainPickerControls } from "@/components/settings/DomainPickerControls";
import { BackgroundControls } from "@/components/settings/BackgroundControls";
import { LayoutControls } from "@/components/settings/LayoutControls";
import { MaterialControls } from "@/components/settings/MaterialControls";
import { SceneControls } from "@/components/settings/SceneControls";
import {
  parseThemeFile,
  resolveChrome,
  resolveMaterial,
  resolveScene,
  type ThemeFile,
} from "@/lib/themes/theme-file";
import { CompositionStudio } from "./CompositionStudio";
import { PaletteStudio } from "./PaletteStudio";
import { compositionSummary } from "./composition-draft";
import {
  withChromePatch,
  withMaterialPatch,
  withScenePatch,
} from "./draft-theme";

/**
 * The Customizations studio's Fields view — the whole look, without JSON.
 *
 * One draft `ThemeFile` is the source of truth. A section strip swaps which
 * layer is on screen (Composition, Components, Chrome, Material, Scene,
 * Palette) so the editor stays navigable at 1280×800 instead of becoming one
 * long scroll; every control edits the draft through the same `onChange`, the
 * page paints it via the provider's `setDraftTheme`, and only the Save button
 * at the foot of the studio reaches main. Nothing here writes, keeps or
 * previews on its own.
 *
 * The Chrome, Material and Scene sections are the Settings Appearance controls
 * in controlled mode (D9): same rows, same words, `studio-` ids, and the draft
 * passed as `value` so no operator override is touched. The Components section
 * is the same deal for the area lens and the agent picker: it writes the
 * file's `chrome.domainPicker` and `chrome.agentPicker`, so the lens and the
 * dock painted behind the studio preview every pick. The Scene tab stacks the picture layer
 * under the drawn-sky rows; both edit the draft's `scene.background`, so a
 * picture authored here lands in the file exactly as one picked in Settings
 * would. Composition has its own schematic editor; Palette is the studio's only
 * new control surface, and it runs the parser's own contrast check so Save can
 * never be pressed on a palette the shell would refuse.
 */
export type StudioSection =
  | "composition"
  | "components"
  | "chrome"
  | "material"
  | "scene"
  | "palette";

/*
 * Components sits directly after Composition: both author something visible on
 * the chat page itself (the widgets, and the picker inside the composer),
 * before the strip turns to the shell-wide layers. It still writes `chrome`,
 * which is why its panel is the `chrome` layer's sibling rather than a crate of
 * its own.
 */
const SECTION_ORDER: readonly StudioSection[] = [
  "composition",
  "components",
  "chrome",
  "material",
  "scene",
  "palette",
];

const SECTION_LABELS: Record<StudioSection, string> = {
  composition: "Composition",
  components: "Components",
  chrome: "Chrome",
  material: "Material",
  scene: "Scene",
  palette: "Palette",
};

const SECTION_INTROS: Record<Exclude<StudioSection, "composition">, string> = {
  components:
    "Two components, each a shipped mode or your own combination of closed axes. The area lens writes `chrome.domainPicker` (arrangement, mark, labels, chips). The dock's agent picker writes `chrome.agentPicker` (roster, labels, ring, size). Both are data the renderer already draws, never code. The studio paints the draft, so the lens and the picker change as you pick; that is the preview. Where the lens sits stays in Chrome.",
  chrome:
    "Where the shell's own components sit and which variant they wear. This section writes the file's `chrome` layer, not a Settings override.",
  material:
    "The six named material steps. This section writes the file's `material` layer; Settings' own picks still outrank a theme after it is kept.",
  scene:
    "The decoration layer: a named sky, its intensity, the page/card frames, the picture layer under the sky rows, and how much of it all shows through the Sidebar and Chat bar. Written to the file, never injected as CSS — a picture names a file already stored in this installation's profile.",
  palette:
    "The two palettes a file may carry. A palette is whole — every required colour or none — and every text pair is checked before Save.",
};

interface StudioFieldsProps {
  /** The parsed theme being drafted; the page owns it and its painting. */
  draft: ThemeFile;
  /** Replace the draft (a new object) after one edit. */
  onChange: (next: ThemeFile) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
  /** Main's refusal for the last save attempt, when there was one. */
  refusal?: string | null;
}

export function StudioFields({
  draft,
  onChange,
  onSave,
  onCancel,
  saving,
  refusal,
}: StudioFieldsProps) {
  const [section, setSection] = useState<StudioSection>("composition");
  const tablistRef = useRef<HTMLDivElement | null>(null);
  const verdict = parseThemeFile(draft);

  const onTabKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const index = SECTION_ORDER.indexOf(section);
    const direction = event.key === "ArrowRight" ? 1 : -1;
    const next =
      SECTION_ORDER[
        (index + direction + SECTION_ORDER.length) % SECTION_ORDER.length
      ]!;
    setSection(next);
    const tabs = tablistRef.current?.querySelectorAll<HTMLButtonElement>(
      '[role="tab"]',
    );
    tabs?.[SECTION_ORDER.indexOf(next)]?.focus();
  };

  const validText = draft.composition
    ? `Valid customization — ${compositionSummary(draft.composition.widgets)}.`
    : "Valid customization — no composition; Save writes the file as it stands.";

  return (
    <section
      className="studio"
      aria-label="Theme studio"
      data-testid="customization-studio"
    >
      <div
        ref={tablistRef}
        className="customizations-page__tabs studio__sections"
        role="tablist"
        aria-label="Studio section"
      >
        {SECTION_ORDER.map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={section === id}
            tabIndex={section === id ? 0 : -1}
            className={`customizations-page__tab${section === id ? " is-active" : ""}`}
            data-testid={`studio-section-tab-${id}`}
            onClick={() => setSection(id)}
            onKeyDown={onTabKeyDown}
          >
            {SECTION_LABELS[id]}
          </button>
        ))}
      </div>

      <div className="studio__panel">
        {section === "composition" ? (
          <div role="tabpanel" aria-label="Composition section">
            <CompositionStudio draft={draft} onChange={onChange} />
          </div>
        ) : null}

        {section === "components" ? (
          <section
            role="tabpanel"
            aria-label="Components section"
            data-testid="studio-components"
          >
            <p className="studio__section-intro">{SECTION_INTROS.components}</p>
            <DomainPickerControls
              value={resolveChrome(draft.chrome).domainPicker}
              onChange={(patch) => onChange(withChromePatch(draft, patch))}
              testIdPrefix="studio-"
            />
            <AgentPickerControls
              value={resolveChrome(draft.chrome).agentPicker}
              onChange={(patch) => onChange(withChromePatch(draft, patch))}
              testIdPrefix="studio-"
            />
          </section>
        ) : null}

        {section === "chrome" ? (
          <section
            role="tabpanel"
            aria-label="Chrome section"
            data-testid="studio-chrome"
          >
            <p className="studio__section-intro">{SECTION_INTROS.chrome}</p>
            <LayoutControls
              value={resolveChrome(draft.chrome)}
              onChange={(patch) => onChange(withChromePatch(draft, patch))}
              testIdPrefix="studio-"
            />
          </section>
        ) : null}

        {section === "material" ? (
          <section
            role="tabpanel"
            aria-label="Material section"
            data-testid="studio-material"
          >
            <p className="studio__section-intro">{SECTION_INTROS.material}</p>
            <MaterialControls
              value={resolveMaterial(draft.material)}
              onChange={(patch) => onChange(withMaterialPatch(draft, patch))}
              testIdPrefix="studio-"
            />
          </section>
        ) : null}

        {section === "scene" ? (
          <section
            role="tabpanel"
            aria-label="Scene section"
            data-testid="studio-scene"
          >
            <p className="studio__section-intro">{SECTION_INTROS.scene}</p>
            <SceneControls
              value={resolveScene(draft.scene)}
              onChange={(patch) => onChange(withScenePatch(draft, patch))}
              testIdPrefix="studio-"
            />
            <BackgroundControls
              value={resolveScene(draft.scene)}
              onChange={(patch) => onChange(withScenePatch(draft, patch))}
              testIdPrefix="studio-"
            />
          </section>
        ) : null}

        {section === "palette" ? (
          <section
            role="tabpanel"
            aria-label="Palette section"
            data-testid="studio-palette"
          >
            <p className="studio__section-intro">{SECTION_INTROS.palette}</p>
            <PaletteStudio draft={draft} onChange={onChange} />
          </section>
        ) : null}
      </div>

      <div className="studio__actions">
        <Button
          variant="primary"
          data-testid="studio-save"
          disabled={!verdict.ok || saving}
          onClick={onSave}
        >
          {saving ? "Saving…" : "Save"}
        </Button>
        <Button variant="ghost" data-testid="studio-cancel" onClick={onCancel}>
          Cancel
        </Button>
      </div>
      <p
        className={verdict.ok ? "studio__valid" : "form-error"}
        role={verdict.ok ? "status" : "alert"}
        data-testid="studio-status"
      >
        {!verdict.ok ? verdict.error : refusal ? refusal : validText}
      </p>
    </section>
  );
}
