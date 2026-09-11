import { DREAM_DOCUMENT_KINDS } from "@lifequest/vault-core/pure";
import { DoctrineIndex } from "@/components/doctrine/DoctrineIndex";

export default function DreamPage() {
  return (
    <div className="dream-page">
      <h1>Dream</h1>
      <DoctrineIndex
        kinds={[...DREAM_DOCUMENT_KINDS]}
        howHref="dream"
        layout="cards"
      />
    </div>
  );
}
