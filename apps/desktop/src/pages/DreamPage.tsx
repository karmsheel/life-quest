import { DREAM_DOCUMENT_KINDS } from "@lifequest/vault-core/pure";
import { DoctrineIndex } from "@/components/doctrine/DoctrineIndex";
import { WingEyebrow } from "@/components/shell/WingEyebrow";

export default function DreamPage() {
  return (
    <div className="doctrine-page">
      <header className="doctrine-page__header">
        <WingEyebrow page="Dream" />
        <h1 className="stub-page__title">Dream</h1>
        <p className="stub-page__desc muted">
          Beliefs, purpose, and strategy for each area.
        </p>
      </header>
      <DoctrineIndex
        kinds={[...DREAM_DOCUMENT_KINDS]}
        basePath="/dream"
        layout="cards"
      />
    </div>
  );
}
