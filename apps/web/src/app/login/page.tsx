import { AuthForm } from "@/components/AuthForm";

type PageProps = {
  searchParams: Promise<{ next?: string }>;
};

export default async function LoginPage({ searchParams }: PageProps) {
  const params = await searchParams;
  return (
    <main
      id="main"
      className="flex min-h-screen items-center justify-center px-4 py-12"
    >
      <AuthForm mode="login" nextPath={params.next} />
    </main>
  );
}
