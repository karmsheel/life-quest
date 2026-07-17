import { AuthForm } from "@/components/auth/AuthForm";

export default function SignUpPage() {
  return (
    <main className="auth-page">
      <div className="auth-card">
        <h1>LifeQuest</h1>
        <p className="muted">Create your account</p>
        <AuthForm mode="sign-up" />
      </div>
    </main>
  );
}
