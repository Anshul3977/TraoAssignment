import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { AppShell } from "@/components/AppShell";
import { KitBriefRoleBuilder } from "@/components/KitBriefRoleBuilder";
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

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function KitBuilderPage({ params }: PageProps) {
  const { id } = await params;
  const user = await loadCurrentUser();
  if (!user) {
    redirect(`/login?next=${encodeURIComponent(`/kits/${id}`)}`);
  }

  return (
    <AppShell email={user.email}>
      <KitBriefRoleBuilder kitId={id} />
    </AppShell>
  );
}
