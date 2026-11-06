import hermesIcon from "@/assets/girl_steampunk.svg";
import piIcon from "@/assets/pi-agent.jpg";

/**
 * The agents' marks, by id.
 *
 * A new agent gets a block by adding its artwork here; an id with no artwork
 * still renders (its initial), so a third harness never arrives invisible.
 */
const AGENT_ICONS: Record<string, string> = {
  hermes: hermesIcon,
  pi: piIcon,
};

export function agentIcon(id: string): string | null {
  return AGENT_ICONS[id] ?? null;
}
