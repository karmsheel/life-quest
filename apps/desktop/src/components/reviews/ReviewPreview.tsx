import { useMemo } from "react";
import type { ReviewRecord } from "@lifequest/vault-core";
import { MarkdownView } from "@/components/documents/MarkdownView";
import { Button } from "@/components/ui/Button";

type Props = {
  record: ReviewRecord | null;
  scope: "overall" | string;
  domainName: string | null;
  liveDomains: { slug: string; meta: { name: string } }[];
  onSetActiveSlug: (slug: string) => void;
};

type SectionHeading = {
  level: number;
  text: string;
  content: string[];
  parentH2: string | null;
};

const OVERALL_H2 = ["Look-back", "Keep", "Change", "Next-period intent"];

function splitSections(body: string): SectionHeading[] {
  const lines = body.split("\n");
  const sections: SectionHeading[] = [];
  let current: SectionHeading | null = null;
  let currentH2: string | null = null;

  for (const line of lines) {
    const m = /^(#{1,6})\s+(.*)$/.exec(line);
    if (m) {
      if (current) sections.push(current);
      const level = m[1]!.length;
      const text = m[2]!.trim();
      current = { level, text, content: [], parentH2: level >= 3 ? currentH2 : null };
      if (level === 2) currentH2 = text;
    } else if (current) {
      current.content.push(line);
    }
  }
  if (current) sections.push(current);
  return sections;
}

function extractBlock(body: string, targetH2: string, sub: string): string | null {
  const sections = splitSections(body);
  let capturing = false;
  let lines: string[] = [];
  for (const s of sections) {
    if (s.level === 2 && s.text === targetH2) {
      capturing = true;
      continue;
    }
    if (capturing && s.level === 2) break;
    if (capturing && s.text === sub) {
      lines = s.content;
      break;
    }
  }
  return capturing ? lines.join("\n") : null;
}

function extractH2Block(body: string, target: string): string | null {
  const sections = splitSections(body);
  for (const s of sections) {
    if (s.level === 2 && s.text === target) return s.content.join("\n");
  }
  return null;
}

export function ReviewPreview({
  record,
  scope,
  domainName,
  liveDomains,
  onSetActiveSlug,
}: Props) {
  const sections = useMemo(
    () => (record ? splitSections(record.bodyMarkdown) : []),
    [record],
  );

  if (!record) {
    return (
      <p className="muted">
        No review yet for this period. Start the interview or edit to begin.
      </p>
    );
  }

  const isOverall = scope === "overall";

  if (isOverall) {
    const hasContent = OVERALL_H2.some((h) => {
      const c = extractH2Block(record.bodyMarkdown, h);
      return c && c.trim().length > 0;
    });

    const domainSlugs = Object.keys(record.scopes).filter((s) => s !== "overall");
    const extraSlugs = domainSlugs.filter(
      (s) => !liveDomains.some((d) => d.slug === s),
    );

    return (
      <div className="review-preview">
        {OVERALL_H2.map((h) => {
          const content = extractH2Block(record.bodyMarkdown, h);
          const body = content && content.trim().length > 0 ? content.trim() : null;
          return (
            <section key={h} className="review-preview__section">
              <h2 className="review-preview__heading">{h}</h2>
              {body ? (
                <MarkdownView markdown={body} slug={`review-${record.cadence}-${record.period}`} />
              ) : (
                <p className="muted review-preview__empty">—</p>
              )}
            </section>
          );
        })}

        {domainSlugs.length > 0 ? (
          <section className="review-preview__domains">
            <h2 className="review-preview__heading">Domains</h2>
            <ul className="review-preview__list">
              {liveDomains.map((d) => {
                const scopeState = record.scopes[d.slug];
                const status: "Missing" | "Draft" | "Done" = !scopeState
                  ? "Missing"
                  : scopeState.status === "done"
                    ? "Done"
                    : "Draft";
                return (
                  <li key={d.slug} className="review-preview__list-item">
                    <span className="review-preview__domain-name">{d.meta.name}</span>
                    <span className={`review-preview__status review-preview__status--${status.toLowerCase()}`}>
                      {status}
                    </span>
                    {scopeState ? (
                      <Button variant="outline" onClick={() => onSetActiveSlug(d.slug)}>
                        Open
                      </Button>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </li>
                );
              })}
              {extraSlugs.map((slug) => {
                const scopeState = record.scopes[slug];
                if (!scopeState) return null;
                return (
                  <li key={slug} className="review-preview__list-item">
                    <span className="review-preview__domain-name">{slug}</span>
                    <span className={`review-preview__status review-preview__status--${scopeState.status === "done" ? "done" : "draft"}`}>
                      {scopeState.status === "done" ? "Done" : "Draft"}
                    </span>
                    <Button variant="outline" onClick={() => onSetActiveSlug(slug)}>
                      Open
                    </Button>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}

        {!hasContent ? (
          <p className="muted review-preview__empty-overall">
            Overall headings are planted. Start the overall interview to fill them.
          </p>
        ) : null}
      </div>
    );
  }

  // Domain scope
  const targetName = domainName ?? scope;
  const scopeState = record.scopes[scope];
  const h2Sections = sections.filter((s) => s.level === 2 && s.text === targetName);

  if (h2Sections.length === 0 || !scopeState) {
    return (
      <p className="muted">
        {targetName} section not started yet. Start the domain interview to begin.
      </p>
    );
  }

  return (
    <div className="review-preview">
      <h2 className="review-preview__heading domain">{targetName}</h2>
      {OVERALL_H2.map((h) => {
        const content = extractBlock(record.bodyMarkdown, targetName, h);
        const body = content && content.trim().length > 0 ? content : null;
        return (
          <section key={h} className="review-preview__section">
            <h3 className="review-preview__subheading">{h}</h3>
            {body ? (
              <MarkdownView markdown={body} slug={`review-${record.cadence}-${record.period}`} />
            ) : (
              <p className="muted review-preview__empty">—</p>
            )}
          </section>
        );
      })}
    </div>
  );
}
