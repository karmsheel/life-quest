import { DoctrineIndex } from "@/components/doctrine/DoctrineIndex";

export default function DreamPage() {
  return (
    <div className="dream-page">
      <h1>Dream</h1>
      <DoctrineIndex kinds={["why", "what"]} />
    </div>
  );
}
