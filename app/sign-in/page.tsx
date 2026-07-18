import { Suspense } from "react";
import { AuthForm } from "@/components/auth/AuthForm";

export default function SignInPage() {
  return (
    <main className="auth-page">
      <div className="auth-card">
        <h1>LifeQuest</h1>
        <p className="muted">Continue locally or sign in</p>
        <Suspense fallback={<p className="muted">Loading…</p>}>
          <AuthForm mode="sign-in" />
        </Suspense>
      </div>
    </main>
  );
}
