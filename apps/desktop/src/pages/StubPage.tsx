export default function StubPage({ title }: { title: string }) {
  return (
    <div className="stub-page">
      <h1 className="stub-page__title">{title}</h1>
      <p className="stub-page__desc muted">Coming soon.</p>
    </div>
  );
}
