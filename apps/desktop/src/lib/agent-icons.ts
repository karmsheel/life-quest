import hermesIcon from "@/assets/girl_steampunk.svg";

/**
 * An agent's mark: artwork with its own colours, or a glyph drawn in the
 * theme's ink.
 *
 * A glyph is a black-and-white treatment: one fill (`currentColor`), no brand
 * palette, so the mark follows `--fg` in both themes instead of disappearing
 * into the block it sits on.
 */
export type AgentMark =
  | { kind: "image"; src: string }
  | { kind: "glyph"; viewBox: string; paths: readonly string[] };

/**
 * Pi's mark: the path data of the press kit's primary logo
 * (https://pi.dev/press-kit → https://pi.dev/logo.svg), drawn as one ink.
 *
 * The shipped logo is three colour fills on an 800-unit canvas; the block in
 * the switcher is a compact badge, so it wears the same geometry in black and
 * white. The drawing occupies the canvas's middle ~59%, which is why the block
 * draws it enlarged but still wholly inside the circle.
 */
const PI_MARK: AgentMark = {
  kind: "glyph",
  viewBox: "0 0 800 800",
  paths: [
    "M165.29 165.29H517.36V400H400V282.65H165.29Z",
    "M165.29 282.65H282.65V400H400V517.36H282.65V634.72H165.29Z",
    "M517.36 400H634.72V634.72H517.36Z",
  ],
};

/**
 * The agents' marks, by id.
 *
 * A new agent gets a block by adding its mark here; an id with no mark still
 * renders (its initial), so a third harness never arrives invisible.
 */
const AGENT_MARKS: Record<string, AgentMark> = {
  hermes: { kind: "image", src: hermesIcon },
  pi: PI_MARK,
};

export function agentMark(id: string): AgentMark | null {
  return AGENT_MARKS[id] ?? null;
}
