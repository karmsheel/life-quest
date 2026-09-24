import { useMemo } from "react";
import { DOCUMENT_KIND_LABELS } from "@lifequest/vault-core/pure";
import { useVault } from "@/state/VaultProvider";
import { useDomainLens } from "@/components/shell/useActiveDomain";
import { DoctrineCard } from "./DoctrineCard";

const DOCTRINE_ROWS = (["premise", "what", "why", "how"] as const).map((kind) => ({
  kind,
  label: DOCUMENT_KIND_LABELS[kind],
}));

export function DoctrineProgressCard() {
  const { snapshot } = useVault();
  const lens = useDomainLens();

  const filteredDomains = useMemo(() => {
    return (snapshot?.domains ?? [])
      .filter((d) => {
        if (d.meta.archivedAt) return false;
        if (lens.kind === "overview") return true;
        return d.slug === lens.slug;
      })
      .slice()
      .sort((a, b) => a.meta.sortOrder - b.meta.sortOrder);
  }, [snapshot, lens]);

  const doctrineTotal = filteredDomains.length * DOCTRINE_ROWS.length;
  const lockedCount = useMemo(() => {
    return filteredDomains.reduce((n, domain) => {
      return (
        n + DOCTRINE_ROWS.filter((r) => domain.documents[r.kind]?.locked).length
      );
    }, 0);
  }, [filteredDomains]);

  const progressPct =
    doctrineTotal === 0 ? 0 : Math.round((lockedCount / doctrineTotal) * 100);

  return (
    <div className="home-doctrine-pin">
      <div className="home-dashboard__progress" title={`${lockedCount} of ${doctrineTotal} locked`}>
        <span className="muted home-dashboard__progress-label">
          {lockedCount}/{doctrineTotal} locked
        </span>
        <div className="home-progress-bar">
          <div
            className="home-progress-bar__fill"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </div>
      <DoctrineCard />
    </div>
  );
}
