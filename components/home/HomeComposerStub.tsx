"use client";

import { FormEvent, useState } from "react";
import { toast } from "sonner";
import { DocumentStatusBadge } from "@/components/documents/DocumentStatusBadge";
import { useShell } from "@/components/shell/ShellProvider";
import type { DocumentKind } from "@/lib/document-kinds.ts";

const PROGRESS: {
  kind: DocumentKind;
  label: string;
  room: string;
}[] = [
  { kind: "why", label: "Why", room: "Dream" },
  { kind: "what", label: "What", room: "Chart" },
  { kind: "how", label: "How", room: "Track" },
];

export function HomeComposerStub() {
  const { activeDomain, documents, loading } = useShell();
  const [text, setText] = useState("");

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    toast("Journey wiring coming soon");
  }

  function statusFor(kind: DocumentKind) {
    return documents.find((d) => d.kind === kind)?.status ?? "draft";
  }

  return (
    <div className="home-composer">
      <header className="home-composer__header">
        <h1 className="stub-page__title">Home</h1>
        <p className="stub-page__desc muted">
          Capture intent here later. Use the nav to move through Dream → Chart →
          Track → Act
          {activeDomain ? ` for ${activeDomain.name}` : ""}.
        </p>
      </header>

      {!loading && activeDomain ? (
        <div className="home-composer__chips" aria-label="Document progress">
          {PROGRESS.map((p) => (
            <div key={p.kind} className="home-composer__chip">
              <span className="home-composer__chip-label">
                {p.label}
                <span className="muted"> · {p.room}</span>
              </span>
              <DocumentStatusBadge status={statusFor(p.kind)} />
            </div>
          ))}
        </div>
      ) : null}

      <form className="home-composer__form" onSubmit={onSubmit}>
        <label className="home-composer__field">
          <span className="home-composer__field-label">What&apos;s on your mind?</span>
          <textarea
            className="home-composer__textarea"
            rows={8}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Sketch a goal, a reflection, or a next step…"
          />
        </label>
        <div className="home-composer__actions">
          <button type="submit" className="doc-btn doc-btn--primary">
            Submit
          </button>
        </div>
      </form>
    </div>
  );
}
