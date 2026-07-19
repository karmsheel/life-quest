import { useActiveDomain } from "@/components/shell/useActiveDomain";

export default function HomePage() {
  const activeDomain = useActiveDomain();

  return (
    <div className="stub-page">
      <h1 className="stub-page__title">Home</h1>
      <p className="stub-page__desc muted">
        Composer coming soon.
        {activeDomain
          ? ` Active domain: ${activeDomain.meta.name}.`
          : " Select or create a domain to begin."}{" "}
        Use the nav to move through Dream → Chart → Track → Act.
      </p>
    </div>
  );
}
