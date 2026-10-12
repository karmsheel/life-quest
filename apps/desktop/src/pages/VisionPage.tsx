import { VISION_DOCUMENT_KINDS } from "@lifequest/vault-core/pure";
import { DoctrineIndex } from "@/components/doctrine/DoctrineIndex";

export default function VisionPage() {
  return (
    <div className="doctrine-page">
      <h1>Vision</h1>
      <DoctrineIndex
        kinds={[...VISION_DOCUMENT_KINDS]}
        basePath="/vision"
        layout="cards"
      />
    </div>
  );
}
