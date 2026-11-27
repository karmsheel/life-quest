import { VISION_DOCUMENT_KINDS } from "@lifequest/vault-core/pure";
import { DoctrineIndex } from "@/components/doctrine/DoctrineIndex";
import { VisionBoardPanel } from "@/components/images/VisionBoardPanel";
import { WingEyebrow } from "@/components/shell/WingEyebrow";

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
      <header className="doctrine-page__header">
        <WingEyebrow page="Vision" />
        <h1 className="stub-page__title">Vision</h1>
        <p className="stub-page__desc muted">
          What each area is reaching for, and the board those pictures sit on.
        </p>
      </header>
      <DoctrineIndex
        kinds={[...VISION_DOCUMENT_KINDS]}
        basePath="/vision"
        layout="cards"
      />
      <VisionBoardPanel />
    </div>
  );
}
