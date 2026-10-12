import { DREAM_DOCUMENT_KINDS } from "@lifequest/vault-core/pure";
import { DoctrineIndex } from "@/components/doctrine/DoctrineIndex";

export default function DreamPage() {
  return (
    <div className="doctrine-page">
      <h1>Dream</h1>
      <DoctrineIndex
        kinds={[...DREAM_DOCUMENT_KINDS]}
        basePath="/dream"
        layout="cards"
      />
    </div>
  );
}
