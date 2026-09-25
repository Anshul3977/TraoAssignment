import { AuthForm } from "@/components/AuthForm";

export default function RegisterPage() {
  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-12">
      <AuthForm mode="register" />
    </div>
  );
}
