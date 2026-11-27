import { agentMark } from "@/lib/agent-icons";

/**
 * An agent's block mark: artwork as an image, or a black-and-white glyph drawn
 * in the theme's ink.
 *
 * Both the switcher's blocks and the Settings roster draw through this, so the
 * answering agent wears the same mark wherever it is listed. An agent with no
 * mark still gets a block: its initial, so a third harness never arrives
 * invisible. The image carries `alt=""` because the block's control already
 * names the agent.
 */
export function AgentMark({
  id,
  name,
  className,
  initialClassName,
}: {
  id: string;
  name: string;
  className: string;
  initialClassName?: string;
}) {
  const mark = agentMark(id);
  if (!mark) {
    return (
      <span className={initialClassName} aria-hidden>
        {name.trim().charAt(0).toUpperCase() || "?"}
      </span>
    );
  }
  if (mark.kind === "image") {
    return (
      <img
        className={className}
        src={mark.src}
        alt=""
        draggable={false}
        data-agent-mark={id}
      />
    );
  }
  return (
    <svg
      className={className}
      viewBox={mark.viewBox}
      focusable="false"
      aria-hidden="true"
      data-agent-mark={id}
    >
      {mark.paths.map((path) => (
        <path key={path} d={path} fill="currentColor" />
      ))}
    </svg>
  );
}
