"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Mail, MessageCircle } from "lucide-react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ApiClientError, apiFetch } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { FieldError, Input, Label } from "@/components/ui/input";

type Channel = "EMAIL" | "WHATSAPP";

const SIGN_IN_ERRORS: Record<string, string> = {
  invalid_code: "That code is incorrect or has expired. Request a new one.",
  rate_limited: "Too many attempts. Please wait a few minutes and try again.",
  account_disabled: "This account has been disabled. Contact support.",
};

/** Passwordless sign-in: one-time code by email or WhatsApp, or Google. */
export function LoginForm({ callbackUrl, notice }: { callbackUrl: string; notice: string | null }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [channel, setChannel] = useState<Channel>("EMAIL");
  const [target, setTarget] = useState("");
  const [code, setCode] = useState("");
  const [stage, setStage] = useState<"request" | "verify">("request");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const requestCode = async () => {
    setError(null);
    setPending(true);
    try {
      await apiFetch("/api/auth/otp/request", { method: "POST", body: { channel, target } });
      setStage("verify");
      setCode("");
    } catch (failure) {
      setError(failure instanceof ApiClientError ? failure.message : "Could not send the code.");
    } finally {
      setPending(false);
    }
  };

  const verify = async () => {
    setError(null);
    setPending(true);
    try {
      const result = await signIn("otp", { channel, target, code, redirect: false });
      if (!result || result.error) {
        setError(SIGN_IN_ERRORS[result?.code ?? ""] ?? SIGN_IN_ERRORS.invalid_code!);
        return;
      }
      await queryClient.invalidateQueries();
      router.replace(callbackUrl);
      router.refresh();
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-[420px]">
      <h1 className="text-3xl font-semibold">Sign in to Collab</h1>
      <p className="mt-2 text-sm text-muted-2">No password needed — we’ll send you a one-time code.</p>
      {notice && (
        <p role="status" className="mt-4 rounded-md bg-surface px-4 py-3 text-sm">
          {notice}
        </p>
      )}

      <div role="tablist" aria-label="Sign-in method" className="mt-8 grid grid-cols-2 rounded-lg bg-surface p-1">
        {(
          [
            ["EMAIL", "Email", Mail],
            ["WHATSAPP", "WhatsApp", MessageCircle],
          ] as const
        ).map(([value, label, Icon]) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={channel === value}
            onClick={() => {
              setChannel(value);
              setStage("request");
              setTarget("");
              setError(null);
            }}
            className={cn("flex h-10 items-center justify-center gap-2 rounded-md text-sm font-medium transition-colors", channel === value ? "bg-white shadow-sm" : "text-muted-2")}
          >
            <Icon className="size-4" aria-hidden /> {label}
          </button>
        ))}
      </div>

      {stage === "request" ? (
        <form
          className="mt-6 space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void requestCode();
          }}
        >
          <div>
            <Label htmlFor="otp-target">{channel === "EMAIL" ? "Email address" : "WhatsApp number"}</Label>
            <Input
              id="otp-target"
              type={channel === "EMAIL" ? "email" : "tel"}
              inputMode={channel === "EMAIL" ? "email" : "tel"}
              autoComplete={channel === "EMAIL" ? "email" : "tel"}
              placeholder={channel === "EMAIL" ? "you@example.com" : "98765 43210"}
              value={target}
              onChange={(event) => setTarget(event.target.value)}
              required
            />
          </div>
          <FieldError message={error ?? undefined} />
          <Button type="submit" size="lg" block loading={pending} disabled={target.trim().length < 3}>
            Send code
          </Button>
        </form>
      ) : (
        <form
          className="mt-6 space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void verify();
          }}
        >
          <div>
            <Label htmlFor="otp-code">Enter the 6-digit code sent to {target}</Label>
            <Input
              id="otp-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="\d{6}"
              maxLength={6}
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
              className="text-center font-mono text-xl tracking-[0.5em]"
              autoFocus
              required
            />
          </div>
          <FieldError message={error ?? undefined} />
          <Button type="submit" size="lg" block loading={pending} disabled={code.length !== 6}>
            Verify and sign in
          </Button>
          <div className="flex justify-between text-sm">
            <button type="button" className="text-muted-2 underline-offset-4 hover:underline" onClick={() => setStage("request")}>
              Change {channel === "EMAIL" ? "email" : "number"}
            </button>
            <button type="button" className="font-medium underline-offset-4 hover:underline" onClick={() => void requestCode()} disabled={pending}>
              Resend code
            </button>
          </div>
        </form>
      )}

      <div className="my-8 flex items-center gap-4 text-xs uppercase tracking-wide text-muted">
        <span className="h-px flex-1 bg-line" /> or <span className="h-px flex-1 bg-line" />
      </div>
      <Button variant="outline" size="lg" block onClick={() => void signIn("google", { callbackUrl })}>
        <svg viewBox="0 0 24 24" className="size-5" aria-hidden>
          <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1Z" />
          <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z" />
          <path fill="#FBBC05" d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84Z" />
          <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15A10.96 10.96 0 0 0 12 1 11 11 0 0 0 2.18 7.06l3.66 2.84C6.71 7.3 9.14 5.38 12 5.38Z" />
        </svg>
        Continue with Google
      </Button>
      <p className="mt-6 text-center text-xs text-muted-2">By continuing you agree to our terms of use and privacy policy.</p>
    </div>
  );
}
