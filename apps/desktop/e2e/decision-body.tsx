/**
 * E2E harness page for the Decision card body (`components/decisions/DecisionBody`).
 *
 * One page, because the card is one component: `decision-body.electron.mjs`
 * renders the same filed body twice — once as the propose path files it, once as
 * the read path hands it over — and reads the table the operator actually sees.
 *
 * The real component and the real CSS, no IPC bridge: DecisionBody is a pure
 * presentational component, so its only inputs are the target body plus the
 * goal/domain lookups the inbox passes in.
 *
 * `renderDecisionBody` bumps `decisionBodyCommits` from an effect, i.e. only
 * after React has committed. A driver waits on that rather than on a frame: a
 * hidden Electron window suspends rAF, so a frame-based wait never returns and
 * the rig hangs with no failure to read.
 */
import { StrictMode, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import type { CSSProperties } from "react";
import type { DocumentTarget } from "@lifequest/vault-core";
import { DecisionBody } from "@/components/decisions/DecisionBody";
import "@/styles/global.css";

type RenderInput = {
  target: DocumentTarget;
  body: unknown;
  previous: string | null;
};

type HarnessWindow = Window & {
  decisionBodyReady?: boolean;
  decisionBodyCommits?: number;
  renderDecisionBody?: (input: RenderInput) => boolean;
};

/** The inbox is a 52rem column inside the shell's content area; keep the width. */
const CENTER: CSSProperties = {
  padding: 24,
  display: "flex",
  justifyContent: "center",
  alignItems: "flex-start",
  minHeight: "100%",
};

const harness = window as HarnessWindow;

function Harness({ input }: { input: RenderInput }) {
  const commits = useRef(0);
  useEffect(() => {
    commits.current += 1;
    harness.decisionBodyCommits = commits.current;
  }, [input]);
  return (
    <div style={CENTER}>
      <div className="decisions-inbox">
        <ul className="decisions-inbox__list">
          <li className="decision-card">
            <DecisionBody
              target={input.target}
              proposed={JSON.stringify(input.body, null, 2)}
              previous={input.previous}
              goalName={() => null}
              domainName={(slug) => slug}
            />
          </li>
        </ul>
      </div>
    </div>
  );
}

const root = createRoot(document.getElementById("root")!);

harness.renderDecisionBody = (input) => {
  root.render(
    <StrictMode>
      <Harness input={input} />
    </StrictMode>,
  );
  return true;
};

harness.decisionBodyReady = true;
