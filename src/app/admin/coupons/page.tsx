import { Search, Ticket } from "lucide-react";
import type { Metadata } from "next";
import { CouponManager } from "@/components/admin/coupons/coupon-manager";
import { Card, EmptyState, inputClass, LinkTabs, PageHeader } from "@/components/admin/ui";
import { Button } from "@/components/ui/button";
import { requireAdminPage } from "@/lib/admin/page-guard";
import { getCouponScopeOptions, listCoupons, type CouponState } from "@/server/admin/coupons.service";

export const metadata: Metadata = { title: "Coupons" };
export const dynamic = "force-dynamic";

const STATES: Array<{ key: CouponState | "all"; label: string }> = [
  { key: "all", label: "All" },
  { key: "active", label: "Active" },
  { key: "scheduled", label: "Scheduled" },
  { key: "expired", label: "Expired" },
  { key: "exhausted", label: "Used up" },
  { key: "disabled", label: "Disabled" },
];

export default async function CouponsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireAdminPage("coupons:manage", "/admin/coupons");
  const params = await searchParams;
  const state = STATES.find((entry) => entry.key === params.state && entry.key !== "all")?.key as CouponState | undefined;
  const q = params.q?.slice(0, 40);
  const [coupons, scope] = await Promise.all([listCoupons({ q, state }), getCouponScopeOptions()]);
  const href = (key: string) => {
    const search = new URLSearchParams();
    if (q) search.set("q", q);
    if (key !== "all") search.set("state", key);
    const text = search.toString();
    return text ? `/admin/coupons?${text}` : "/admin/coupons";
  };

  return (
    <>
      <PageHeader title="Coupons" description="Percentage and flat discounts with spend thresholds, usage caps, schedules and category / brand scope. Validated server-side at checkout." />
      <div className="mb-4">
        <LinkTabs items={STATES.map((entry) => ({ key: entry.key, label: entry.label, href: href(entry.key) }))} active={state ?? "all"} />
      </div>
      <form className="mb-4 flex gap-2" role="search">
        {state && <input type="hidden" name="state" value={state} />}
        <div className="relative min-w-[240px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
          <input name="q" defaultValue={q} placeholder="Search code or description" className={`${inputClass} pl-9`} aria-label="Search coupons" />
        </div>
        <Button type="submit" variant="outline" size="sm">
          Search
        </Button>
      </form>
      {coupons.length === 0 && !q && !state ? (
        <Card>
          <EmptyState icon={<Ticket className="size-8" />} title="No coupons yet">
            Create the first one with “New coupon”.
          </EmptyState>
          <div className="flex justify-center pb-4">
            <CouponManager coupons={[]} scope={scope} createOnly />
          </div>
        </Card>
      ) : (
        <CouponManager coupons={coupons} scope={scope} />
      )}
    </>
  );
}
