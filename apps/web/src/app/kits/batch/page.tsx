import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { AppShell } from "@/components/AppShell";
import { BatchUploadForm } from "@/components/BatchUploadForm";
import { SESSION_COOKIE } from "@/lib/auth-guard";

const API_ORIGIN = process.env.API_ORIGIN ?? "http://localhost:4000";

async function loadCurrentUser(): Promise<{ id: string; email: string } | null> {
  const jar = await cookies();
  const session = jar.get(SESSION_COOKIE)?.value;
  if (!session) return null;

  try {
    const res = await fetch(`${API_ORIGIN}/auth/me`, {
      headers: { cookie: `${SESSION_COOKIE}=${session}` },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { user: { id: string; email: string } };
    return data.user;
  } catch {
    return null;
  }
}

export default async function BatchKitsPage() {
  const user = await loadCurrentUser();
  if (!user) {
    redirect("/login?next=%2Fkits%2Fbatch");
  }

  return (
    <AppShell email={user.email}>
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">Batch upload</h1>
        <p className="mt-1 text-sm text-zinc-600">
          Upload a JSON or CSV file of job descriptions. Preview and fix row
          errors, then start generation jobs (POST /kits/batch).
        </p>
      </div>
      <BatchUploadForm />
    </AppShell>
  );
}
