import { AuthForm } from "@/components/auth/AuthForm";

export default function SignInPage() {
  return (
    <main className="auth-page">
      <div className="auth-card">
        <h1>LifeQuest</h1>
        <p className="muted">Sign in to continue</p>
        <AuthForm mode="sign-in" />
      </div>
    </main>
  );
}
