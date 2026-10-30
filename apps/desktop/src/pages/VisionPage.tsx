import { VISION_DOCUMENT_KINDS } from "@lifequest/vault-core/pure";
import { DoctrineIndex } from "@/components/doctrine/DoctrineIndex";
import { VisionBoardPanel } from "@/components/images/VisionBoardPanel";

/**
 * Vision, under Define: the doctrine card per domain, and below it the one
 * vision board written in blocks.
 *
 * The board is here rather than on Images because this is the page about the
 * life being reached for; Images is the vault's picture library, and the board's
 * picker reads it from here.
 */
export default function VisionPage() {
  return (
    <div className="doctrine-page">
      <h1>Vision</h1>
      <DoctrineIndex
        kinds={[...VISION_DOCUMENT_KINDS]}
        basePath="/vision"
        layout="cards"
      />
      <VisionBoardPanel />
    </div>
  );
}
