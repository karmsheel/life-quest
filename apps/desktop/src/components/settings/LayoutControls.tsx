import { useId } from "react";
import { RotateCcw } from "lucide-react";
import { useTheme } from "@/components/theme/ThemeProvider";
import { Button } from "@/components/ui/Button";
import {
  DOMAIN_PLACES,
  DOMAIN_FRAMES,
  DOMAIN_VARIANTS,
  CHAT_DOCK_SIDES,
  NAV_RAIL_PLACES,
  TITLEBAR_SIZES,
  NAV_RAIL_WIDTHS,
  WING_PLACES,
  WING_VARIANTS,
  type ThemeChrome,
  type ThemeChromeOverride,
} from "@/lib/themes/theme-file";

/**
 * Settings → Appearance: where the shell's chrome lives.
 *
 * A theme file proposes where the wing switcher, the area lens and the sidebar
 * sit (and the two switchers' shape), and this section is where the operator can
 * disagree with it. Every pick is layered over the theme (`chromeOverride` in
 * the provider), marked "yours" per component so a themed window and an
 * operator-tuned one are told apart at a glance, and persisted per window.
 * **Reset to theme** hands every component back to the theme the window is
 * wearing.
 *
 * Optional controlled props (D9) let the Customizations studio reuse these rows
 * against a draft theme: `value` is the resolved chrome to show and `onChange`
 * receives patches instead of the provider writing an override. With no props
 * Settings keeps exactly the old behaviour and test ids.
 *
 * The option buttons mirror the shared `SegmentedControl` primitive's markup and
 * classes rather than calling it, for the same reason MaterialControls does:
 * every option needs its own `data-testid` and the label line carries the
 * override marker, neither of which the primitive exposes.
 */

type ComponentKey = keyof ThemeChromeOverride;

export interface LayoutControlsProps {
  /** Controlled chrome: the resolved layout to render (defaults filled). */
  value?: ThemeChrome;
  /** Controlled mode only: a per-component patch from one pick. */
  onChange?: (patch: ThemeChromeOverride) => void;
  /** Prefix for every data-testid; "" leaves the Settings ids untouched. */
  testIdPrefix?: string;
}

const WING_PLACE_LABELS: Record<ThemeChrome["wingSwitcher"]["place"], string> = {
  "rail-top": "Rail top",
  "titlebar-left": "Titlebar left",
  "floating-left": "Floating left",
  hidden: "Hidden",
};
const WING_VARIANT_LABELS: Record<
  ThemeChrome["wingSwitcher"]["variant"],
  string
> = {
  labels: "Labels",
  icons: "Icons",
  compact: "Compact",
};
const DOMAIN_PLACE_LABELS: Record<
  ThemeChrome["domainSwitcher"]["place"],
  string
> = {
  "titlebar-center": "Titlebar centre",
  "left-rail": "Sidebar rail",
  "below-titlebar": "Below titlebar",
  "bottom-center": "Bottom centre",
  "floating-bottom-right": "Floating bottom right",
  hidden: "Hidden",
};
const DOMAIN_VARIANT_LABELS: Record<
  ThemeChrome["domainSwitcher"]["variant"],
  string
> = {
  segmented: "Segmented",
  pill: "Pill",
  icons: "Icons",
  list: "List",
};
const DOMAIN_FRAME_LABELS: Record<
  ThemeChrome["domainSwitcher"]["frame"],
  string
> = {
  pill: "Pill",
  bare: "Bare",
};
const CHAT_DOCK_SIDE_LABELS: Record<ThemeChrome["chatDock"]["side"], string> = {
  left: "Left",
  right: "Right",
};
const NAV_RAIL_PLACE_LABELS: Record<ThemeChrome["navRail"]["place"], string> = {
  left: "Left",
  right: "Right",
  floating: "Floating",
};
const TITLEBAR_SIZE_LABELS: Record<ThemeChrome["titlebar"]["size"], string> = {
  compact: "Compact",
  default: "Default",
  tall: "Tall",
};
const NAV_RAIL_WIDTH_LABELS: Record<ThemeChrome["navRail"]["width"], string> = {
  narrow: "Narrow",
  default: "Default",
  wide: "Wide",
};

interface LayoutRow {
  key: string;
  /** The component this row belongs to — one "yours" marker per component. */
  component: ComponentKey;
  /** data-testid prefix; the option suffix is the raw enum value. */
  testIdPrefix: string;
  label: string;
  options: readonly { value: string; label: string }[];
  selected: string;
  onPick: (value: string) => void;
}

export function LayoutControls({
  value,
  onChange,
  testIdPrefix = "",
}: LayoutControlsProps = {}) {
  const { chrome, chromeOverride, setChromeOverride, resetChromeOverride } =
    useTheme();
  const controlled = value !== undefined;
  const effectiveChrome = value ?? chrome;
  const headingId = useId();
  const labelPrefix = useId();
  const hasOverrides = !controlled && Object.keys(chromeOverride).length > 0;

  const pick = (patch: ThemeChromeOverride) => {
    if (controlled) {
      onChange?.(patch);
      return;
    }
    setChromeOverride(patch);
  };

  /*
   * The rows are built here rather than at module scope because each pick has to
   * reach the owning surface with its component's own shape. One row renders
   * once per option, and the raw enum values ride along as the option values —
   * the words on screen are the words a theme file may use.
   */
  const rows: LayoutRow[] = [
    {
      key: "wing-place",
      component: "wingSwitcher",
      testIdPrefix: "chrome-wing-place",
      label: "Wing switcher place",
      options: WING_PLACES.map((value) => ({
        value,
        label: WING_PLACE_LABELS[value],
      })),
      selected: effectiveChrome.wingSwitcher.place,
      onPick: (value) =>
        pick({
          wingSwitcher: {
            place: value as ThemeChrome["wingSwitcher"]["place"],
          },
        }),
    },
    {
      key: "wing-variant",
      component: "wingSwitcher",
      testIdPrefix: "chrome-wing-variant",
      label: "Wing switcher variant",
      options: WING_VARIANTS.map((value) => ({
        value,
        label: WING_VARIANT_LABELS[value],
      })),
      selected: effectiveChrome.wingSwitcher.variant,
      onPick: (value) =>
        pick({
          wingSwitcher: {
            variant: value as ThemeChrome["wingSwitcher"]["variant"],
          },
        }),
    },
    {
      key: "domain-place",
      component: "domainSwitcher",
      testIdPrefix: "chrome-domain-place",
      label: "Area lens place",
      options: DOMAIN_PLACES.map((value) => ({
        value,
        label: DOMAIN_PLACE_LABELS[value],
      })),
      selected: effectiveChrome.domainSwitcher.place,
      onPick: (value) =>
        pick({
          domainSwitcher: {
            place: value as ThemeChrome["domainSwitcher"]["place"],
          },
        }),
    },
    {
      key: "domain-variant",
      component: "domainSwitcher",
      testIdPrefix: "chrome-domain-variant",
      label: "Area lens variant",
      options: DOMAIN_VARIANTS.map((value) => ({
        value,
        label: DOMAIN_VARIANT_LABELS[value],
      })),
      selected: effectiveChrome.domainSwitcher.variant,
      onPick: (value) =>
        pick({
          domainSwitcher: {
            variant: value as ThemeChrome["domainSwitcher"]["variant"],
          },
        }),
    },
    {
      key: "domain-frame",
      component: "domainSwitcher",
      testIdPrefix: "chrome-domain-frame",
      label: "Area lens frame",
      options: DOMAIN_FRAMES.map((value) => ({
        value,
        label: DOMAIN_FRAME_LABELS[value],
      })),
      selected: effectiveChrome.domainSwitcher.frame,
      onPick: (value) =>
        pick({
          domainSwitcher: {
            frame: value as ThemeChrome["domainSwitcher"]["frame"],
          },
        }),
    },
    {
      key: "titlebar-size",
      component: "titlebar",
      testIdPrefix: "chrome-titlebar-size",
      label: "Titlebar height",
      options: TITLEBAR_SIZES.map((value) => ({
        value,
        label: TITLEBAR_SIZE_LABELS[value],
      })),
      selected: effectiveChrome.titlebar.size,
      onPick: (value) =>
        pick({
          titlebar: { size: value as ThemeChrome["titlebar"]["size"] },
        }),
    },
    {
      key: "chat-side",
      component: "chatDock",
      testIdPrefix: "chrome-chat-side",
      label: "Chat dock side",
      options: CHAT_DOCK_SIDES.map((value) => ({
        value,
        label: CHAT_DOCK_SIDE_LABELS[value],
      })),
      selected: effectiveChrome.chatDock.side,
      onPick: (value) =>
        pick({
          chatDock: { side: value as ThemeChrome["chatDock"]["side"] },
        }),
    },
    {
      key: "nav-place",
      component: "navRail",
      testIdPrefix: "chrome-nav-place",
      label: "Sidebar side",
      options: NAV_RAIL_PLACES.map((value) => ({
        value,
        label: NAV_RAIL_PLACE_LABELS[value],
      })),
      selected: effectiveChrome.navRail.place,
      onPick: (value) =>
        pick({
          navRail: { place: value as ThemeChrome["navRail"]["place"] },
        }),
    },
    {
      key: "nav-width",
      component: "navRail",
      testIdPrefix: "chrome-nav-width",
      label: "Sidebar width",
      options: NAV_RAIL_WIDTHS.map((value) => ({
        value,
        label: NAV_RAIL_WIDTH_LABELS[value],
      })),
      selected: effectiveChrome.navRail.width,
      onPick: (value) =>
        pick({
          navRail: { width: value as ThemeChrome["navRail"]["width"] },
        }),
    },
  ];

  /*
   * A component is "yours" when the override has a branch for it. The marker is
   * drawn on that component's first row so a component picked twice still shows
   * exactly one marker (and one testid) for the E2E rigs. Controlled mode has no
   * overrides to mark: the draft *is* the theme.
   */
  const firstRowOfComponent = new Map<ComponentKey, string>();
  for (const row of rows) {
    if (!firstRowOfComponent.has(row.component)) {
      firstRowOfComponent.set(row.component, row.key);
    }
  }

  return (
    <section
      className="theme-layout"
      aria-labelledby={headingId}
      data-testid={controlled ? `${testIdPrefix}layout-panel` : "theme-layout"}
    >
      <div className="theme-layout__header">
        <div className="theme-layout__heading">
          <h3 className="theme-layout__title" id={headingId}>
            Layout
          </h3>
          <p className="theme-layout__intro">
            {controlled ? (
              <>
                Where the shell&rsquo;s own components sit, as the theme file
                carries it. Picks paint the draft at once; only{" "}
                <strong>Save</strong> writes the file.
              </>
            ) : (
              <>
                A theme proposes where the wing switcher, the area lens and the
                sidebar sit, and you can override any of them. A pick marked
                &ldquo;yours&rdquo; outranks the theme and survives swapping it;{" "}
                <strong>Reset to theme</strong> returns them to the theme&rsquo;s
                layout.
              </>
            )}
          </p>
        </div>
        {controlled ? null : (
          <Button
            variant="outline"
            className="theme-layout__reset"
            data-testid="chrome-reset"
            disabled={!hasOverrides}
            onClick={() => resetChromeOverride()}
          >
            <RotateCcw size={13} aria-hidden />
            Reset to theme
          </Button>
        )}
      </div>

      <div className="theme-layout__rows">
        {rows.map((row) => {
          const overridden = !controlled && row.component in chromeOverride;
          const markerHere =
            overridden && firstRowOfComponent.get(row.component) === row.key;
          const labelId = `${labelPrefix}-${row.key}`;
          return (
            <div
              key={row.key}
              className="settings-card__row theme-layout__row"
            >
              <div className="settings-card__copy">
                <div className="settings-card__label theme-layout__label">
                  <span id={labelId}>{row.label}</span>
                  {markerHere ? (
                    <span
                      className="theme-layout__yours"
                      data-testid={`chrome-${row.component}-yours`}
                      title="You picked this component's layout; it overrides the theme's"
                    >
                      <span
                        className="theme-layout__yours-dot"
                        aria-hidden="true"
                      />
                      yours
                    </span>
                  ) : null}
                </div>
              </div>
              <div
                className="ui-segmented ui-segmented--sm theme-layout__control"
                role="radiogroup"
                aria-labelledby={labelId}
              >
                {row.options.map((option) => {
                  const active = row.selected === option.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      aria-label={`${row.label}: ${option.label}`}
                      className={`ui-segmented__option${active ? " is-active" : ""}`}
                      data-testid={
                        controlled
                          ? `${testIdPrefix}${row.testIdPrefix}-${option.value}`
                          : `${row.testIdPrefix}-${option.value}`
                      }
                      onClick={() => row.onPick(option.value)}
                    >
                      {option.label}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      <p className="theme-layout__note">
        Hidden is a real choice: a theme can hide a switcher, and the preview
        bar, the Settings entry and the window controls stay as the way out.
      </p>
    </section>
  );
}
