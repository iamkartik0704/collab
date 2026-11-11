import { AdminAuditAction } from "@prisma/client";
import type { Metadata } from "next";
import { AuditLogViewer } from "@/components/admin/audit/audit-log-viewer";
import { inputClass, PageHeader, selectClass } from "@/components/admin/ui";
import { Button } from "@/components/ui/button";
import { dayBound, humanize } from "@/lib/admin/format";
import { requireAdminPage } from "@/lib/admin/page-guard";
import { getAuditFilterOptions, listAuditLog } from "@/server/admin/audit-log.service";

export const metadata: Metadata = { title: "Audit log" };
export const dynamic = "force-dynamic";

export default async function AuditLogPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireAdminPage("audit:read", "/admin/audit-log");
  const params = await searchParams;
  const action = Object.values(AdminAuditAction).find((value) => value === params.action);
  const filters = {
    action,
    entityType: params.entityType?.slice(0, 60) || undefined,
    entityId: params.entityId?.trim().slice(0, 64) || undefined,
    actorId: params.actorId?.slice(0, 64) || undefined,
    from: dayBound(params.from, false),
    to: dayBound(params.to, true),
  };
  const [first, options] = await Promise.all([
    listAuditLog({ ...filters, from: filters.from ? new Date(filters.from) : undefined, to: filters.to ? new Date(filters.to) : undefined, limit: 50 }),
    getAuditFilterOptions(),
  ]);
  const apiQuery = new URLSearchParams(Object.entries(filters).filter((entry): entry is [string, string] => Boolean(entry[1]))).toString();

  return (
    <>
      <PageHeader
        title="Audit log"
        description="Every admin mutation, written in the same transaction as the change itself. The table is append-only at the database level; entries cannot be edited or deleted."
      />
      <form className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-[repeat(6,minmax(0,1fr))_auto] lg:items-end" role="search">
        <label>
          <span className="mb-1 block text-xs text-muted-2">Action</span>
          <select name="action" defaultValue={action ?? ""} className={`${selectClass} w-full`}>
            <option value="">All actions</option>
            {Object.values(AdminAuditAction).map((value) => (
              <option key={value} value={value}>
                {humanize(value)}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="mb-1 block text-xs text-muted-2">Entity</span>
          <select name="entityType" defaultValue={filters.entityType ?? ""} className={`${selectClass} w-full`}>
            <option value="">All entities</option>
            {options.entityTypes.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="mb-1 block text-xs text-muted-2">Entity id</span>
          <input name="entityId" defaultValue={filters.entityId} className={inputClass} />
        </label>
        <label>
          <span className="mb-1 block text-xs text-muted-2">Staff member</span>
          <select name="actorId" defaultValue={filters.actorId ?? ""} className={`${selectClass} w-full`}>
            <option value="">Anyone</option>
            {options.actors.map((actor) => (
              <option key={actor.id} value={actor.id}>
                {actor.name ?? actor.email}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="mb-1 block text-xs text-muted-2">From</span>
          <input type="date" name="from" defaultValue={params.from} className={inputClass} />
        </label>
        <label>
          <span className="mb-1 block text-xs text-muted-2">To</span>
          <input type="date" name="to" defaultValue={params.to} className={inputClass} />
        </label>
        <Button type="submit" variant="outline" size="sm">
          Apply
        </Button>
      </form>
      <AuditLogViewer key={apiQuery} initial={first} apiQuery={apiQuery} />
    </>
  );
}
