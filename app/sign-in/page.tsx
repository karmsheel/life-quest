import { AuthForm } from "@/components/auth/AuthForm";

type PageProps = {
  searchParams?: Promise<{ error?: string }>;
};

export default async function SignInPage({ searchParams }: PageProps) {
  const params = (await searchParams) ?? {};
  const initialError =
    params.error === "local"
      ? "Could not start the local account. Check the server log and try again."
      : null;

  return (
    <main className="auth-page">
      <div className="auth-card">
        <h1>LifeQuest</h1>
        <p className="muted">Continue locally or sign in</p>
        <AuthForm mode="sign-in" initialError={initialError} />
      </div>
    </main>
  );
}
