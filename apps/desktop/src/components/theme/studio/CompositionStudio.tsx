import { useId, useState } from "react";
import { Button } from "@/components/ui/Button";
import {
  MAX_COMPOSITION_CAPTION,
  MAX_COMPOSITION_LABEL,
  MAX_COMPOSITION_LIST_ITEMS,
  MAX_COMPOSITION_WIDGETS,
  parseThemeFile,
  type CompositionClockFormat,
  type CompositionDataSource,
  type CompositionLayout,
  type CompositionPolarRadius,
  type CompositionRegion,
  type CompositionRoute,
  type CompositionTextSource,
  type CompositionTone,
  type CompositionWidget,
  type CompositionWidgetType,
  type ThemeFile,
} from "@/lib/themes/theme-file";
import {
  CLOCK_FORMATS,
  DATA_SOURCE_LABELS,
  LAYOUT_LABELS,
  POLAR_RADIUS_LABELS,
  REGION_HINTS,
  REGION_LABELS,
  ROUTE_LABELS,
  STUDIO_CAPS,
  STUDIO_OFFERS,
  TEXT_SOURCE_LABELS,
  TONE_LABELS,
  WIDGET_TYPE_LABELS,
  compositionSummary,
  dataKindOf,
  defaultWidget,
  moveOrbitWidgetsToMasthead,
  moveWidget,
  regionNeedsPolar,
  retypeWidget,
  studioCompositionOf,
  textSourcesFor,
  withStudioComposition,
  type StudioComposition,
} from "./composition-draft";

/**
 * The Extensions studio's Fields view — slice S2: composition, without JSON.
 *
 * Two surfaces, one source of truth. The schematic draws the shell's five
 * regions and the chips on them; the form below edits the selected widget. The
 * form is authoritative: the schematic is a map, the files and every control
 * live underneath, and every change rebuilds a `ThemeFile` the shared parser
 * accepts. Nothing here writes a file — the page paints the draft through the
 * provider and only Save reaches main.
 *
 * The design keeps two promises the parser makes:
 *  - a widget that cannot draw is never produced (defaults per type, legal enum
 *    values only, `page.orbit` forces the polar layout it requires);
 *  - the studio cannot invent keys. The theme it hands back is the parsed file
 *    plus a `composition` built field by field.
 */
interface CompositionStudioProps {
  /** The parsed theme the page is drafting. */
  draft: ThemeFile;
  /** Paint a new draft. The page owns the provider's `setDraftTheme`. */
  onChange: (next: ThemeFile) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
}

export function CompositionStudio({
  draft,
  onChange,
  onSave,
  onCancel,
  saving,
}: CompositionStudioProps) {
  const studio = studioCompositionOf(draft);
  const idPrefix = useId();
  const [selected, setSelected] = useState<number | null>(
    studio.widgets.length > 0 ? 0 : null,
  );
  const [addType, setAddType] = useState<CompositionWidgetType>("badge");
  const [addRegion, setAddRegion] = useState<CompositionRegion>("page.masthead");
  /** A one-line account of an automatic move the operator should know about. */
  const [notice, setNotice] = useState<string | null>(null);

  /*
   * Widgets are addressed by array index, so a stale selection after a removal
   * or a reorder is clamped rather than trusted: the form always shows a widget
   * that exists, or none.
   */
  const selectedIndex =
    selected !== null && selected < studio.widgets.length ? selected : null;
  const selectedWidget =
    selectedIndex === null ? null : studio.widgets[selectedIndex];
  const verdict = parseThemeFile(draft);
  const atCap = studio.widgets.length >= MAX_COMPOSITION_WIDGETS;

  const commit = (next: StudioComposition) =>
    onChange(withStudioComposition(draft, next));

  /** Change one field on the selected widget; the widget stays otherwise identical. */
  const patchSelected = (changes: Record<string, unknown>) => {
    if (selectedIndex === null) return;
    commit({
      ...studio,
      widgets: studio.widgets.map((widget, index) =>
        index === selectedIndex
          ? ({ ...widget, ...changes } as CompositionWidget)
          : widget,
      ),
    });
  };

  function addWidget() {
    if (atCap) return;
    // page.orbit only exists in the polar layout: picking it here switches the
    // layout with the add, so the new widget is legal from its first paint.
    const layout: CompositionLayout = regionNeedsPolar(addRegion)
      ? "polar"
      : studio.layout;
    const widgets = [...studio.widgets, defaultWidget(addType, addRegion)];
    commit({ ...studio, layout, widgets });
    setSelected(widgets.length - 1);
    setNotice(
      regionNeedsPolar(addRegion) && studio.layout !== "polar"
        ? "Switched to the polar layout: the page orbit only draws there."
        : null,
    );
  }

  function removeWidget() {
    if (selectedIndex === null) return;
    const widgets = studio.widgets.filter((_, index) => index !== selectedIndex);
    commit({ ...studio, widgets });
    setSelected(widgets.length === 0 ? null : Math.min(selectedIndex, widgets.length - 1));
  }

  function reorderWidget(direction: -1 | 1) {
    if (selectedIndex === null) return;
    const widgets = moveWidget(studio.widgets, selectedIndex, direction);
    commit({ ...studio, widgets });
    setSelected(Math.max(0, Math.min(selectedIndex + direction, widgets.length - 1)));
  }

  function changeLayout(layout: CompositionLayout) {
    if (layout === studio.layout) return;
    let widgets = studio.widgets;
    let moved = 0;
    if (layout !== "polar") {
      const result = moveOrbitWidgetsToMasthead(widgets);
      widgets = result.widgets;
      moved = result.moved;
    }
    commit({ ...studio, layout, widgets });
    setNotice(
      moved > 0
        ? `Moved ${moved} widget${moved === 1 ? "" : "s"} from the page orbit to the page masthead: only the polar layout draws the orbit.`
        : null,
    );
  }

  function changeRegion(region: CompositionRegion) {
    if (selectedIndex === null) return;
    const needsPolar = regionNeedsPolar(region);
    const layout: CompositionLayout =
      needsPolar && studio.layout !== "polar" ? "polar" : studio.layout;
    commit({
      ...studio,
      layout,
      widgets: studio.widgets.map((widget, index) =>
        index === selectedIndex ? ({ ...widget, region } as CompositionWidget) : widget,
      ),
    });
    setNotice(
      needsPolar && studio.layout !== "polar"
        ? "Switched to the polar layout: the page orbit only draws there."
        : null,
    );
  }

  const dataKind = selectedWidget ? dataKindOf(selectedWidget.type) : "none";
  const selectedData =
    selectedWidget && "data" in selectedWidget ? String(selectedWidget.data) : "";
  const selectedTone = selectedWidget?.tone ?? "";

  return (
    <section
      className="studio"
      aria-label="Composition studio"
      data-testid="extension-studio"
    >
      {/* Schematic — a map of the shell's five regions. The chips are real
          buttons (a focusable control inside aria-hidden content is an
          accessibility defect), and the live summary reads the same state. */}
      <div className="studio__schematic" data-testid="extension-studio-schematic">
        <div className="studio__schematic-copy">
          <h3 className="studio__title">Composition</h3>
          <p className="studio__note">
            A theme places a few small widgets on the shell&rsquo;s named
            regions. The schematic is a map — the form below is the source of
            truth, and nothing here can place code, markup or a URL.
          </p>
        </div>
        <ul className="studio__regions">
          {STUDIO_OFFERS.regions.map((region) => {
            const chips = studio.widgets
              .map((widget, index) => ({ widget, index }))
              .filter(({ widget }) => widget.region === region);
            return (
              <li
                key={region}
                className="studio__region"
                data-testid={`studio-region-${region}`}
                aria-label={REGION_LABELS[region]}
              >
                <span className="studio__region-name" aria-hidden="true">
                  {region}
                </span>
                <div className="studio__chips">
                  {chips.length === 0 ? (
                    <span className="studio__region-empty">empty</span>
                  ) : (
                    chips.map(({ widget, index }) => (
                      <button
                        key={index}
                        type="button"
                        className="studio__chip"
                        data-testid="studio-widget-chip"
                        data-index={index}
                        data-selected={index === selectedIndex ? "true" : "false"}
                        aria-pressed={index === selectedIndex}
                        aria-label={`Select ${WIDGET_TYPE_LABELS[widget.type]} "${widget.label}" on ${REGION_LABELS[region]}`}
                        onClick={() => setSelected(index)}
                      >
                        {WIDGET_TYPE_LABELS[widget.type]}
                        {widget.label ? ` · ${widget.label}` : ""}
                      </button>
                    ))
                  )}
                </div>
                <p
                  className="studio__hint"
                  data-testid={`studio-hint-${region}`}
                >
                  {REGION_HINTS[region]}
                </p>
              </li>
            );
          })}
        </ul>
        <p
          className="studio__summary"
          role="status"
          data-testid="studio-summary"
        >
          {compositionSummary(studio.widgets)}
        </p>
      </div>

      {/* Layout */}
      <fieldset className="studio__group">
        <legend className="studio__legend">Layout</legend>
        <div className="studio__radios">
          {STUDIO_OFFERS.layouts.map((layout) => (
            <label key={layout} className="studio__radio">
              <input
                type="radio"
                name={`${idPrefix}-layout`}
                value={layout}
                checked={studio.layout === layout}
                data-testid={`studio-layout-${layout}`}
                onChange={() => changeLayout(layout)}
              />
              {LAYOUT_LABELS[layout]}
            </label>
          ))}
        </div>
        {studio.layout === "grid" ? (
          <label className="studio__field">
            <span>Columns</span>
            <select
              data-testid="studio-layout-columns"
              value={studio.columns}
              onChange={(event) =>
                commit({ ...studio, columns: Number(event.target.value) as 2 | 3 })
              }
            >
              <option value={2}>2 columns</option>
              <option value={3}>3 columns</option>
            </select>
          </label>
        ) : null}
        {studio.layout === "polar" ? (
          <label className="studio__field">
            <span>Ring radius</span>
            <select
              data-testid="studio-layout-radius"
              value={studio.radius}
              onChange={(event) =>
                commit({
                  ...studio,
                  radius: event.target.value as CompositionPolarRadius,
                })
              }
            >
              {STUDIO_OFFERS.polarRadii.map((radius) => (
                <option key={radius} value={radius}>
                  {POLAR_RADIUS_LABELS[radius]}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <p className="studio__hint" data-testid="studio-layout-note">
          Stack wraps in reading order; grid fixes two or three columns; polar
          places widgets on a ring, top first and clockwise, each still a plain
          tabbable widget. Reduced motion stops the ring&rsquo;s breathing.
        </p>
        {notice ? (
          <p
            className="studio__notice"
            role="status"
            data-testid="studio-layout-notice"
          >
            {notice}
          </p>
        ) : null}
      </fieldset>

      {/* The selected widget's form */}
      <fieldset className="studio__group studio__group--widget">
        <legend className="studio__legend">Widget</legend>
        {selectedWidget === null || selectedIndex === null ? (
          <p className="studio__empty" data-testid="studio-widget-empty">
            No widget selected — add one below, or pick a chip in the schematic.
          </p>
        ) : (
          <>
            <div className="studio__widget-toolbar">
              <span className="studio__widget-index">
                Widget {selectedIndex + 1} of {studio.widgets.length}
              </span>
              <Button
                variant="ghost"
                data-testid="studio-widget-up"
                disabled={selectedIndex === 0}
                aria-label="Move widget earlier"
                onClick={() => reorderWidget(-1)}
              >
                Up
              </Button>
              <Button
                variant="ghost"
                data-testid="studio-widget-down"
                disabled={selectedIndex === studio.widgets.length - 1}
                aria-label="Move widget later"
                onClick={() => reorderWidget(1)}
              >
                Down
              </Button>
              <Button
                variant="ghost"
                data-testid="studio-widget-remove"
                aria-label="Remove this widget"
                onClick={removeWidget}
              >
                Remove
              </Button>
            </div>

            <div className="studio__fields">
              <label className="studio__field">
                <span>Type</span>
                <select
                  data-testid="studio-widget-type"
                  value={selectedWidget.type}
                  onChange={(event) => {
                    if (selectedIndex === null) return;
                    const type = event.target.value as CompositionWidgetType;
                    commit({
                      ...studio,
                      widgets: studio.widgets.map((widget, index) =>
                        index === selectedIndex
                          ? retypeWidget(widget, type)
                          : widget,
                      ),
                    });
                  }}
                >
                  {STUDIO_OFFERS.widgetTypes.map((type) => (
                    <option key={type} value={type}>
                      {WIDGET_TYPE_LABELS[type]}
                    </option>
                  ))}
                </select>
              </label>

              <label className="studio__field">
                <span>Region</span>
                <select
                  data-testid="studio-widget-region"
                  value={selectedWidget.region}
                  onChange={(event) =>
                    changeRegion(event.target.value as CompositionRegion)
                  }
                >
                  {STUDIO_OFFERS.regions.map((region) => (
                    <option key={region} value={region}>
                      {REGION_LABELS[region]}
                    </option>
                  ))}
                </select>
              </label>

              <label className="studio__field studio__field--wide">
                <span>
                  Label <span className="studio__count">{selectedWidget.label.length}/{MAX_COMPOSITION_LABEL}</span>
                </span>
                <input
                  type="text"
                  data-testid="studio-widget-label"
                  maxLength={MAX_COMPOSITION_LABEL}
                  value={selectedWidget.label}
                  onChange={(event) =>
                    patchSelected({
                      label: event.target.value.slice(0, MAX_COMPOSITION_LABEL),
                    })
                  }
                />
              </label>

              {dataKind === "count" ? (
                <label className="studio__field">
                  <span>Data</span>
                  <select
                    data-testid="studio-widget-data"
                    value={selectedData}
                    onChange={(event) =>
                      patchSelected({
                        data: event.target.value as CompositionDataSource,
                      })
                    }
                  >
                    {STUDIO_OFFERS.dataSources.map((source) => (
                      <option key={source} value={source}>
                        {DATA_SOURCE_LABELS[source]}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}

              {dataKind === "text" ? (
                <label className="studio__field">
                  <span>Data</span>
                  <select
                    data-testid="studio-widget-text"
                    value={selectedData}
                    onChange={(event) =>
                      patchSelected({
                        data: event.target.value as CompositionTextSource,
                      })
                    }
                  >
                    {textSourcesFor(selectedWidget.type).map((source) => (
                      <option key={source} value={source}>
                        {TEXT_SOURCE_LABELS[source]}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}

              {dataKind === "route" ? (
                <label className="studio__field">
                  <span>Goes to</span>
                  <select
                    data-testid="studio-widget-route"
                    value={
                      selectedWidget.type === "quickAction"
                        ? selectedWidget.route
                        : "home"
                    }
                    onChange={(event) =>
                      patchSelected({
                        route: event.target.value as CompositionRoute,
                      })
                    }
                  >
                    {STUDIO_OFFERS.routes.map((route) => (
                      <option key={route} value={route}>
                        {ROUTE_LABELS[route]}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}

              {selectedWidget.type === "meter" ? (
                <label className="studio__field">
                  <span>Maximum</span>
                  <input
                    type="number"
                    min={1}
                    max={1000}
                    step={1}
                    data-testid="studio-widget-max"
                    value={selectedWidget.max}
                    onChange={(event) => {
                      const max = Number(event.target.value);
                      // Only integers 1–1000 exist; anything else is ignored
                      // rather than written, so the draft never goes invalid.
                      if (!Number.isInteger(max) || max < 1 || max > 1000) return;
                      patchSelected({ max });
                    }}
                  />
                </label>
              ) : null}

              {selectedWidget.type === "list" ? (
                <label className="studio__field">
                  <span>Rows</span>
                  <select
                    data-testid="studio-widget-limit"
                    value={selectedWidget.limit ?? 3}
                    onChange={(event) =>
                      patchSelected({ limit: Number(event.target.value) })
                    }
                  >
                    {Array.from(
                      { length: MAX_COMPOSITION_LIST_ITEMS },
                      (_, index) => index + 1,
                    ).map((limit) => (
                      <option key={limit} value={limit}>
                        {limit} {limit === 1 ? "row" : "rows"}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}

              {selectedWidget.type === "clock" ? (
                <label className="studio__field">
                  <span>Clock</span>
                  <select
                    data-testid="studio-widget-format"
                    value={selectedWidget.format ?? "24h"}
                    onChange={(event) =>
                      patchSelected({
                        format: event.target.value as CompositionClockFormat,
                      })
                    }
                  >
                    {CLOCK_FORMATS.map((format) => (
                      <option key={format} value={format}>
                        {format}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}

              {selectedWidget.type === "brief" ? (
                <label className="studio__field studio__field--wide">
                  <span>
                    Caption{" "}
                    <span className="studio__count">
                      {(selectedWidget.caption ?? "").length}/
                      {MAX_COMPOSITION_CAPTION}
                    </span>
                  </span>
                  <input
                    type="text"
                    data-testid="studio-widget-caption"
                    maxLength={MAX_COMPOSITION_CAPTION}
                    value={selectedWidget.caption ?? ""}
                    onChange={(event) =>
                      patchSelected({
                        caption: event.target.value.slice(
                          0,
                          MAX_COMPOSITION_CAPTION,
                        ),
                      })
                    }
                  />
                </label>
              ) : null}

              <label className="studio__field">
                <span>Tone</span>
                <select
                  data-testid="studio-widget-tone"
                  value={selectedTone}
                  onChange={(event) => {
                    const tone = event.target.value;
                    patchSelected(
                      tone === ""
                        ? { tone: undefined }
                        : { tone: tone as CompositionTone },
                    );
                  }}
                >
                  <option value="">Inherit from theme</option>
                  {STUDIO_OFFERS.tones.map((tone) => (
                    <option key={tone} value={tone}>
                      {TONE_LABELS[tone]}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </>
        )}
      </fieldset>

      {/* Add a widget — closed type and region sets, capped at eight. */}
      <fieldset className="studio__group">
        <legend className="studio__legend">Add a widget</legend>
        <div className="studio__fields">
          <label className="studio__field">
            <span>Type</span>
            <select
              data-testid="studio-add-type"
              value={addType}
              onChange={(event) =>
                setAddType(event.target.value as CompositionWidgetType)
              }
            >
              {STUDIO_OFFERS.widgetTypes.map((type) => (
                <option key={type} value={type}>
                  {WIDGET_TYPE_LABELS[type]}
                </option>
              ))}
            </select>
          </label>
          <label className="studio__field">
            <span>Region</span>
            <select
              data-testid="studio-add-region"
              value={addRegion}
              onChange={(event) =>
                setAddRegion(event.target.value as CompositionRegion)
              }
            >
              {STUDIO_OFFERS.regions.map((region) => (
                <option key={region} value={region}>
                  {REGION_LABELS[region]}
                </option>
              ))}
            </select>
          </label>
          <div className="studio__field studio__field--action">
            <Button
              variant="outline"
              data-testid="studio-add-widget"
              disabled={atCap}
              onClick={addWidget}
            >
              Add widget
            </Button>
          </div>
        </div>
        <p className="studio__hint" data-testid="studio-add-note">
          {atCap
            ? `Eight widgets is the cap (${STUDIO_CAPS.widgets}) — remove one to add another.`
            : `${studio.widgets.length} of ${STUDIO_CAPS.widgets} widgets placed.`}
        </p>
      </fieldset>

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
        {verdict.ok
          ? studio.widgets.length === 0
            ? "Valid extension — no composition; saving keeps the file without widgets."
            : `Valid extension — ${compositionSummary(studio.widgets)}.`
          : verdict.error}
      </p>
    </section>
  );
}
