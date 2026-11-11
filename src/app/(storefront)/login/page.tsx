import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LoginForm } from "@/components/auth/login-form";
import { getAuthState } from "@/lib/auth/session";
import { safeRedirectPath } from "@/lib/security/request";

export const metadata: Metadata = { title: "Sign in", robots: { index: false } };

const NOTICES: Record<string, string> = {
  session_expired: "Your session has expired. Please sign in again.",
  CredentialsSignin: "That code is incorrect or has expired.",
  OAuthAccountNotLinked: "That email is already linked to another sign-in method.",
  AccessDenied: "Sign-in was refused for this account.",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const callbackUrl = safeRedirectPath(typeof params.callbackUrl === "string" ? params.callbackUrl : null, "/");
  const state = await getAuthState();
  if (state.status === "authenticated") redirect(callbackUrl);

  const reason = typeof params.reason === "string" ? params.reason : typeof params.error === "string" ? params.error : null;
  return (
    <div className="container-site py-16 lg:py-24">
      <LoginForm callbackUrl={callbackUrl} notice={reason ? (NOTICES[reason] ?? "Something went wrong signing you in. Please try again.") : null} />
    </div>
  );
}
