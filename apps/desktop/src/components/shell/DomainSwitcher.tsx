import { useMemo, useState } from "react";
import { useVault } from "@/state/VaultProvider";
import { useActiveDomain } from "./useActiveDomain";

export function DomainSwitcher() {
  const { snapshot, setActiveSlug, refresh, booting } = useVault();
  const activeDomain = useActiveDomain();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const domains = useMemo(() => {
    if (!snapshot) return [];
    return snapshot.domains
      .filter((d) => !d.meta.archivedAt)
      .slice()
      .sort((a, b) => a.meta.sortOrder - b.meta.sortOrder);
  }, [snapshot]);

  async function onChange(nextSlug: string) {
    if (!nextSlug || nextSlug === activeDomain?.slug) return;
    setPending(true);
    setError(null);
    try {
      await setActiveSlug(nextSlug);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to switch domain");
    } finally {
      setPending(false);
    }
  }

  if (booting && domains.length === 0) {
    return (
      <div className="domain-switcher muted" aria-busy="true">
        Loading domains…
      </div>
    );
  }

  if (domains.length === 0) {
    return <div className="domain-switcher muted">No domains</div>;
  }

  return (
    <div className="domain-switcher">
      <label className="domain-switcher__label" htmlFor="domain-switcher-select">
        Domain
      </label>
      <select
        id="domain-switcher-select"
        className="domain-switcher__select"
        value={activeDomain?.slug ?? ""}
        disabled={pending}
        onChange={(e) => void onChange(e.target.value)}
        aria-label="Active domain"
        style={
          activeDomain?.meta.color
            ? { borderColor: activeDomain.meta.color }
            : undefined
        }
      >
        {domains.map((d) => (
          <option key={d.slug} value={d.slug}>
            {d.meta.name}
          </option>
        ))}
      </select>
      {error ? (
        <span className="domain-switcher__error" role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}
