import { Suspense } from "react";
import { AuthForm } from "@/components/auth/AuthForm";

export default function SignUpPage() {
  return (
    <main className="auth-page">
      <div className="auth-card">
        <h1>LifeQuest</h1>
        <p className="muted">Start locally or create an email account</p>
        <Suspense fallback={<p className="muted">Loading…</p>}>
          <AuthForm mode="sign-up" />
        </Suspense>
      </div>
    </main>
  );
}
