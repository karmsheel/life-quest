"use client";

import { StubPage } from "@/components/shell/StubPage";
import { useShell } from "@/components/shell/ShellProvider";

export default function ProfilePage() {
  const { user } = useShell();

  return (
    <StubPage
      title="Profile"
      description="Your account identity for this LifeQuest session."
    >
      {user ? (
        <dl className="profile-dl">
          <div>
            <dt className="muted">Name</dt>
            <dd>{user.name || "—"}</dd>
          </div>
          <div>
            <dt className="muted">Email</dt>
            <dd>{user.email}</dd>
          </div>
        </dl>
      ) : (
        <p className="muted">Not signed in.</p>
      )}
    </StubPage>
  );
}
