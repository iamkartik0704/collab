"use client";

import { Copy, Pencil, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Badge, Card, EmptyState, inputClass, Table, Td, Th } from "@/components/admin/ui";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/controls";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { formatDateTime, formatInteger, parseRupees, rupeesText, type Tone } from "@/lib/admin/format";
import { apiFetch, ApiClientError } from "@/lib/api-client";
import { cn, formatMoney } from "@/lib/utils";
import { couponInputSchema, type CouponFormValues } from "@/schemas/admin";
import type { AdminCouponRow, CouponState } from "@/server/admin/coupons.service";

interface ScopeOptions {
  categories: Array<{ id: string; name: string }>;
  brands: Array<{ id: string; name: string }>;
}

interface FormState {
  code: string;
  description: string;
  discountType: "PERCENTAGE" | "FLAT";
  percent: string;
  maxDiscount: string;
  amountOff: string;
  minCart: string;
  usageLimitTotal: string;
  usageLimitPerUser: string;
  firstOrderOnly: boolean;
  startsAt: string;
  expiresAt: string;
  isActive: boolean;
  categoryIds: string[];
  brandIds: string[];
}

const STATE_BADGE: Record<CouponState, { tone: Tone; label: string }> = {
  active: { tone: "success", label: "Active" },
  scheduled: { tone: "info", label: "Scheduled" },
  expired: { tone: "neutral", label: "Expired" },
  exhausted: { tone: "warning", label: "Used up" },
  disabled: { tone: "neutral", label: "Disabled" },
};

/** Date -> value for <input type="datetime-local"> in the browser's zone. */
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function emptyForm(): FormState {
  return {
    code: "",
    description: "",
    discountType: "PERCENTAGE",
    percent: "10",
    maxDiscount: "",
    amountOff: "",
    minCart: "0",
    usageLimitTotal: "",
    usageLimitPerUser: "1",
    firstOrderOnly: false,
    startsAt: toLocalInput(new Date().toISOString()),
    expiresAt: "",
    isActive: true,
    categoryIds: [],
    brandIds: [],
  };
}

function fromRow(row: AdminCouponRow): FormState {
  return {
    code: row.code,
    description: row.description ?? "",
    discountType: row.discountType,
    percent: row.percentOffBps === null ? "" : String(row.percentOffBps / 100),
    maxDiscount: rupeesText(row.maxDiscountMinor),
    amountOff: rupeesText(row.amountOffMinor),
    minCart: rupeesText(row.minCartValueMinor),
    usageLimitTotal: row.usageLimitTotal === null ? "" : String(row.usageLimitTotal),
    usageLimitPerUser: row.usageLimitPerUser === null ? "" : String(row.usageLimitPerUser),
    firstOrderOnly: row.firstOrderOnly,
    startsAt: toLocalInput(row.startsAt),
    expiresAt: toLocalInput(row.expiresAt),
    isActive: row.isActive,
    categoryIds: row.categoryIds,
    brandIds: row.brandIds,
  };
}

function toValues(form: FormState): CouponFormValues {
  const minorOrNull = (text: string) => {
    const value = parseRupees(text);
    return value === null ? null : value;
  };
  const intOrNull = (text: string) => (text.trim() === "" ? null : Number(text));
  const percent = form.percent.trim() === "" ? null : Math.round(Number(form.percent) * 100);
  return {
    code: form.code,
    description: form.description,
    discountType: form.discountType,
    percentOffBps: form.discountType === "PERCENTAGE" ? percent : null,
    maxDiscountMinor: form.discountType === "PERCENTAGE" ? minorOrNull(form.maxDiscount) : null,
    amountOffMinor: form.discountType === "FLAT" ? minorOrNull(form.amountOff) : null,
    minCartValueMinor: minorOrNull(form.minCart) ?? 0,
    usageLimitTotal: intOrNull(form.usageLimitTotal),
    usageLimitPerUser: intOrNull(form.usageLimitPerUser),
    firstOrderOnly: form.firstOrderOnly,
    startsAt: form.startsAt ? new Date(form.startsAt).toISOString() : new Date().toISOString(),
    expiresAt: form.expiresAt ? new Date(form.expiresAt).toISOString() : null,
    isActive: form.isActive,
    categoryIds: form.categoryIds,
    brandIds: form.brandIds,
  };
}

function discountText(row: AdminCouponRow): string {
  if (row.discountType === "FLAT") return `${formatMoney(row.amountOffMinor ?? 0)} off`;
  const pct = `${(row.percentOffBps ?? 0) / 100}% off`;
  return row.maxDiscountMinor ? `${pct} (max ${formatMoney(row.maxDiscountMinor)})` : pct;
}

export function CouponManager({ coupons, scope, createOnly = false }: { coupons: AdminCouponRow[]; scope: ScopeOptions; createOnly?: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = useState<AdminCouponRow | "new" | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((current) => ({ ...current, [key]: value }));
  const toggle = (key: "categoryIds" | "brandIds", id: string) =>
    setForm((current) => ({ ...current, [key]: current[key].includes(id) ? current[key].filter((entry) => entry !== id) : [...current[key], id] }));

  const openNew = (template?: AdminCouponRow) => {
    setForm(template ? { ...fromRow(template), code: `${template.code}-COPY`.slice(0, 40), startsAt: toLocalInput(new Date().toISOString()) } : emptyForm());
    setEditing("new");
    setErrors({});
    setServerError(null);
  };
  const openEdit = (row: AdminCouponRow) => {
    setForm(fromRow(row));
    setEditing(row);
    setErrors({});
    setServerError(null);
  };

  async function save() {
    setServerError(null);
    const values = toValues(form);
    const parsed = couponInputSchema.safeParse(values);
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((issue) => [String(issue.path[0] ?? "form"), issue.message])));
      return;
    }
    setErrors({});
    setSaving(true);
    try {
      const existing = editing && editing !== "new" ? editing : null;
      await apiFetch(existing ? `/api/admin/coupons/${existing.id}` : "/api/admin/coupons", { method: existing ? "PATCH" : "POST", body: values });
      setEditing(null);
      setNotice(existing ? `Saved ${parsed.data.code}.` : `Created ${parsed.data.code}.`);
      router.refresh();
    } catch (failure) {
      setServerError(failure instanceof ApiClientError ? failure.message : "Could not save the coupon.");
    } finally {
      setSaving(false);
    }
  }

  async function remove(row: AdminCouponRow) {
    const prompt = row.timesRedeemed > 0 ? `${row.code} has been used, so it will be disabled rather than deleted. Continue?` : `Delete ${row.code}? This cannot be undone.`;
    if (!window.confirm(prompt)) return;
    try {
      const result = await apiFetch<{ outcome: "deleted" | "disabled" }>(`/api/admin/coupons/${row.id}`, { method: "DELETE" });
      setNotice(result.outcome === "deleted" ? `Deleted ${row.code}.` : `${row.code} was disabled (it has order history).`);
      router.refresh();
    } catch (failure) {
      setNotice(failure instanceof ApiClientError ? failure.message : "Could not delete the coupon.");
    }
  }

  const newButton = (
    <Button type="button" size="sm" onClick={() => openNew()}>
      <Plus className="size-4" aria-hidden /> New coupon
    </Button>
  );
  const codeLocked = editing !== null && editing !== "new" && editing.timesRedeemed > 0;

  const dialog = (
    <Dialog open={editing !== null} onOpenChange={(next) => !next && setEditing(null)}>
      {editing !== null && (
        <DialogContent title={editing === "new" ? "New coupon" : `Edit ${editing.code}`} className="max-w-2xl">
          {serverError && (
            <p role="alert" className="mb-4 rounded-md bg-[#fdecea] px-3 py-2 text-sm text-danger">
              {serverError}
            </p>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Code" error={errors.code} hint={codeLocked ? "Locked: this coupon has been used." : "Customers type this at checkout."}>
              <input value={form.code} onChange={(event) => set("code", event.target.value.toUpperCase())} disabled={codeLocked} className={cn(inputClass, "font-mono uppercase")} maxLength={40} />
            </Field>
            <Field label="Description" error={errors.description} hint="Internal; also shown in the cart.">
              <input value={form.description} onChange={(event) => set("description", event.target.value)} className={inputClass} maxLength={200} />
            </Field>

            <fieldset className="sm:col-span-2">
              <legend className="mb-1.5 text-sm font-medium">Discount</legend>
              <div className="grid grid-cols-2 gap-1 rounded-[7px] bg-surface p-1 sm:w-80" role="radiogroup" aria-label="Discount type">
                {(
                  [
                    ["PERCENTAGE", "Percentage"],
                    ["FLAT", "Flat amount"],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={form.discountType === value}
                    onClick={() => set("discountType", value)}
                    className={cn("rounded-[5px] px-2 py-1.5 text-sm font-medium", form.discountType === value ? "bg-white shadow-sm" : "text-muted-2 hover:text-ink")}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </fieldset>
            {form.discountType === "PERCENTAGE" ? (
              <>
                <Field label="Percent off" error={errors.percentOffBps}>
                  <input inputMode="decimal" value={form.percent} onChange={(event) => set("percent", event.target.value)} className={inputClass} />
                </Field>
                <Field label="Maximum discount (₹)" error={errors.maxDiscountMinor} hint="Leave empty for no cap.">
                  <input inputMode="decimal" value={form.maxDiscount} onChange={(event) => set("maxDiscount", event.target.value)} className={inputClass} />
                </Field>
              </>
            ) : (
              <Field label="Amount off (₹)" error={errors.amountOffMinor}>
                <input inputMode="decimal" value={form.amountOff} onChange={(event) => set("amountOff", event.target.value)} className={inputClass} />
              </Field>
            )}
            <Field label="Minimum cart value (₹)" error={errors.minCartValueMinor}>
              <input inputMode="decimal" value={form.minCart} onChange={(event) => set("minCart", event.target.value)} className={inputClass} />
            </Field>
            <Field label="Total uses" error={errors.usageLimitTotal} hint="Empty = unlimited.">
              <input type="number" min={1} value={form.usageLimitTotal} onChange={(event) => set("usageLimitTotal", event.target.value)} className={inputClass} />
            </Field>
            <Field label="Uses per customer" error={errors.usageLimitPerUser} hint="Empty = unlimited.">
              <input type="number" min={1} value={form.usageLimitPerUser} onChange={(event) => set("usageLimitPerUser", event.target.value)} className={inputClass} />
            </Field>
            <Field label="Starts" error={errors.startsAt}>
              <input type="datetime-local" value={form.startsAt} onChange={(event) => set("startsAt", event.target.value)} className={inputClass} />
            </Field>
            <Field label="Expires" error={errors.expiresAt} hint="Empty = never.">
              <input type="datetime-local" value={form.expiresAt} onChange={(event) => set("expiresAt", event.target.value)} className={inputClass} />
            </Field>

            <div className="space-y-2 sm:col-span-2">
              <label className="flex items-center gap-2.5 text-sm">
                <Checkbox checked={form.firstOrderOnly} onCheckedChange={(value) => set("firstOrderOnly", value === true)} /> First order only
              </label>
              <label className="flex items-center gap-2.5 text-sm">
                <Checkbox checked={form.isActive} onCheckedChange={(value) => set("isActive", value === true)} /> Enabled
              </label>
            </div>

            <ScopePicker label="Limit to categories" options={scope.categories} selected={form.categoryIds} onToggle={(id) => toggle("categoryIds", id)} />
            <ScopePicker label="Limit to brands" options={scope.brands} selected={form.brandIds} onToggle={(id) => toggle("brandIds", id)} />
            <p className="text-xs text-muted-2 sm:col-span-2">With no category or brand selected the coupon applies to the whole catalogue. With both, an item must match one of each.</p>
          </div>
          <div className="mt-6 flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button type="button" size="sm" onClick={() => void save()} loading={saving}>
              {editing === "new" ? "Create coupon" : "Save coupon"}
            </Button>
          </div>
        </DialogContent>
      )}
    </Dialog>
  );

  if (createOnly) {
    return (
      <>
        {newButton}
        {dialog}
      </>
    );
  }

  return (
    <>
      {notice && (
        <p role="status" className="mb-4 rounded-[var(--radius-card)] border border-line bg-white px-4 py-2.5 text-sm">
          {notice}
        </p>
      )}
      <Card bodyClassName="p-0" title={`${coupons.length} coupon${coupons.length === 1 ? "" : "s"}`} actions={newButton}>
        {coupons.length === 0 ? (
          <EmptyState title="No coupons match" />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Code</Th>
                <Th>Status</Th>
                <Th>Discount</Th>
                <Th>Scope</Th>
                <Th align="right">Used</Th>
                <Th align="right">Discount given</Th>
                <Th>Window</Th>
                <Th>
                  <span className="sr-only">Actions</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {coupons.map((row) => {
                const badge = STATE_BADGE[row.state];
                return (
                  <tr key={row.id} className="hover:bg-tint-1">
                    <Td>
                      <span className="block font-mono text-xs font-semibold">{row.code}</span>
                      {row.description && <span className="block max-w-[220px] truncate text-xs text-muted-2">{row.description}</span>}
                    </Td>
                    <Td>
                      <Badge tone={badge.tone}>{badge.label}</Badge>
                    </Td>
                    <Td className="text-sm">
                      {discountText(row)}
                      <span className="block text-xs text-muted-2">
                        {row.minCartValueMinor > 0 ? `Min ${formatMoney(row.minCartValueMinor)}` : "No minimum"}
                        {row.firstOrderOnly && " · first order"}
                      </span>
                    </Td>
                    <Td className="max-w-[200px] truncate text-xs text-muted-2">
                      <span title={row.scope}>{row.scope}</span>
                    </Td>
                    <Td align="right" className="tabular-nums">
                      {formatInteger(row.timesRedeemed)}
                      {row.usageLimitTotal !== null && <span className="text-muted-2"> / {formatInteger(row.usageLimitTotal)}</span>}
                    </Td>
                    <Td align="right" className="tabular-nums">
                      {formatMoney(row.discountGivenMinor)}
                    </Td>
                    <Td className="whitespace-nowrap text-xs text-muted-2">
                      {formatDateTime(row.startsAt)}
                      <span className="block">{row.expiresAt ? `→ ${formatDateTime(row.expiresAt)}` : "→ no expiry"}</span>
                    </Td>
                    <Td align="right">
                      <div className="flex justify-end gap-1">
                        <IconButton label={`Edit ${row.code}`} onClick={() => openEdit(row)}>
                          <Pencil className="size-3.5" />
                        </IconButton>
                        <IconButton label={`Duplicate ${row.code}`} onClick={() => openNew(row)}>
                          <Copy className="size-3.5" />
                        </IconButton>
                        <IconButton label={`Delete ${row.code}`} onClick={() => void remove(row)} danger>
                          <Trash2 className="size-3.5" />
                        </IconButton>
                      </div>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
      {dialog}
    </>
  );
}

function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string | undefined; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium">{label}</span>
      {children}
      {error ? (
        <span role="alert" className="mt-1 block text-xs text-danger">
          {error}
        </span>
      ) : (
        hint && <span className="mt-1 block text-xs text-muted-2">{hint}</span>
      )}
    </label>
  );
}

function ScopePicker({ label, options, selected, onToggle }: { label: string; options: Array<{ id: string; name: string }>; selected: string[]; onToggle: (id: string) => void }) {
  return (
    <fieldset>
      <legend className="mb-1.5 text-sm font-medium">
        {label} {selected.length > 0 && <span className="font-normal text-muted-2">({selected.length})</span>}
      </legend>
      <div className="max-h-40 space-y-1.5 overflow-y-auto rounded-[7px] border border-line-2 p-2.5">
        {options.map((option) => (
          <label key={option.id} className="flex items-center gap-2 text-sm">
            <Checkbox checked={selected.includes(option.id)} onCheckedChange={() => onToggle(option.id)} /> {option.name}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function IconButton({ label, onClick, danger, children }: { label: string; onClick: () => void; danger?: boolean; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} title={label} className={cn("rounded-md p-1.5 text-muted-2 hover:bg-surface hover:text-ink", danger && "hover:bg-[#fdecea] hover:text-danger")}>
      {children}
    </button>
  );
}
