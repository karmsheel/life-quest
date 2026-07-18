import { AuthForm } from "@/components/auth/AuthForm";

export default function SignInPage() {
  return (
    <main className="auth-page">
      <div className="auth-card">
        <h1>LifeQuest</h1>
        <p className="muted">Continue locally or sign in</p>
        <AuthForm mode="sign-in" />
      </div>
    </main>
  );
}
