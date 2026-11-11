import Link from "next/link";
import { Logo } from "@/components/layout/logo";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 px-6 text-center">
      <Logo />
      <p className="text-8xl font-extralight">404</p>
      <h1 className="text-2xl font-semibold">This page isn’t here</h1>
      <p className="max-w-md text-muted-2">The link may be broken or the product may no longer be available.</p>
      <div className="flex gap-3">
        <Button asChild variant="outline" size="lg">
          <Link href="/catalog">Browse catalog</Link>
        </Button>
        <Button asChild size="lg">
          <Link href="/">Go home</Link>
        </Button>
      </div>
    </main>
  );
}
