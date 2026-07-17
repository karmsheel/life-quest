"use client";

import { useShell } from "@/components/shell/ShellProvider";

export function ProfileContent() {
  const { user, loading } = useShell();

  return (
    <div className="profile-content">
      <header className="profile-content__header">
        <h1 className="stub-page__title">Profile</h1>
        <p className="stub-page__desc muted">
          Your account identity for this LifeQuest session. Editing is not
          available in the skeleton.
        </p>
      </header>

      {loading ? (
        <p className="muted">Loading profile…</p>
      ) : user ? (
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
    </div>
  );
}
