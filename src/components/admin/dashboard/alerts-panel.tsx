"use client";

import { useMutation } from "@tanstack/react-query";
import { BellOff } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Badge, EmptyState } from "@/components/admin/ui";
import { relativeTime } from "@/lib/admin/format";
import { apiFetch } from "@/lib/api-client";

export interface AlertItem {
  id: string;
  type: string;
  severity: "INFO" | "WARNING" | "CRITICAL";
  title: string;
  message: string;
  createdAt: string;
}

const SEVERITY_TONE = { INFO: "info", WARNING: "warning", CRITICAL: "danger" } as const;

export function AlertsPanel({ alerts }: { alerts: AlertItem[] }) {
  const router = useRouter();
  const acknowledge = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/admin/alerts/${id}/acknowledge`, { method: "POST" }),
    onSuccess: () => router.refresh(),
  });

  if (alerts.length === 0) {
    return (
      <EmptyState icon={<BellOff className="size-8" />} title="No open alerts">
        Low-stock, payment and job-failure alerts appear here.
      </EmptyState>
    );
  }
  return (
    <ul className="divide-y divide-line">
      {alerts.map((alert) => (
        <li key={alert.id} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={SEVERITY_TONE[alert.severity]}>{alert.severity.toLowerCase()}</Badge>
              <p className="truncate text-sm font-medium">{alert.title}</p>
            </div>
            <p className="mt-1 text-xs text-muted-2">{alert.message}</p>
            <p className="mt-1 text-[11px] text-muted">{relativeTime(alert.createdAt)}</p>
          </div>
          <button
            type="button"
            onClick={() => acknowledge.mutate(alert.id)}
            disabled={acknowledge.isPending && acknowledge.variables === alert.id}
            className="shrink-0 rounded-md border border-line-2 px-2.5 py-1 text-xs font-medium hover:border-ink disabled:opacity-50"
          >
            Acknowledge
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Re-renders the server component on an interval (dashboard data is cached for 60 s). */
export function AutoRefresh({ seconds }: { seconds: number }) {
  const router = useRouter();
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, seconds * 1000);
    return () => clearInterval(timer);
  }, [router, seconds]);
  return null;
}
