"use client";

import * as RadioGroupPrimitive from "@radix-ui/react-radio-group";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, X } from "lucide-react";
import { useState } from "react";
import { apiFetch } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import type { SavedAddress } from "@/schemas/account";
import { AddressFormDialog } from "./address-form-dialog";

export function useAddresses(initial: SavedAddress[]) {
  return useQuery({
    queryKey: ["addresses"],
    queryFn: () => apiFetch<{ addresses: SavedAddress[] }>("/api/account/addresses").then((data) => data.addresses),
    initialData: initial,
    staleTime: 60_000,
  });
}

export function AddressStep({ initial, selectedId, onSelect }: { initial: SavedAddress[]; selectedId: string | null; onSelect: (id: string | null) => void }) {
  const queryClient = useQueryClient();
  const { data: addresses } = useAddresses(initial);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<SavedAddress | null>(null);

  const remove = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/account/addresses/${id}`, { method: "DELETE" }),
    onSuccess: async (_data, id) => {
      await queryClient.invalidateQueries({ queryKey: ["addresses"] });
      if (selectedId === id) onSelect(null);
    },
  });

  return (
    <section aria-labelledby="address-title">
      <h2 id="address-title" className="text-xl font-semibold">
        Select Address
      </h2>
      <RadioGroupPrimitive.Root value={selectedId ?? ""} onValueChange={onSelect} className="mt-8 space-y-6" aria-label="Saved addresses">
        {addresses.map((address) => (
          <div key={address.id} className={cn("flex items-start gap-4 rounded-[7px] bg-surface p-6 transition-shadow", selectedId === address.id && "ring-1 ring-ink")}>
            <RadioGroupPrimitive.Item
              value={address.id}
              id={`addr-${address.id}`}
              className="mt-1 flex size-5 shrink-0 items-center justify-center rounded-full border-2 border-ink bg-white"
            >
              <RadioGroupPrimitive.Indicator className="size-2.5 rounded-full bg-ink" />
            </RadioGroupPrimitive.Item>
            <label htmlFor={`addr-${address.id}`} className="min-w-0 flex-1 cursor-pointer">
              <span className="flex flex-wrap items-center gap-3">
                <span className="text-lg font-medium">{address.label || address.fullName}</span>
                <span className="rounded bg-ink px-2 py-1 text-[10px] font-semibold uppercase leading-none text-white">{address.type}</span>
                {address.isDefault && <span className="text-xs text-muted-2">Default</span>}
              </span>
              <span className="mt-2 block text-[15px]">
                {address.fullName}, {address.line1}
                {address.line2 ? `, ${address.line2}` : ""}
                {address.landmark ? `, near ${address.landmark}` : ""}, {address.city}, {address.state} {address.postalCode}
              </span>
              <span className="mt-1 block text-[15px] text-muted-2">{address.phone}</span>
            </label>
            <div className="flex shrink-0 gap-3">
              <button
                type="button"
                onClick={() => {
                  setEditing(address);
                  setDialogOpen(true);
                }}
                aria-label={`Edit address ${address.label || address.line1}`}
                className="rounded p-1 hover:bg-white"
              >
                <Pencil className="size-5" />
              </button>
              <button
                type="button"
                onClick={() => remove.mutate(address.id)}
                disabled={remove.isPending}
                aria-label={`Delete address ${address.label || address.line1}`}
                className="rounded p-1 hover:bg-white"
              >
                <X className="size-5" />
              </button>
            </div>
          </div>
        ))}
      </RadioGroupPrimitive.Root>

      <div className="mt-12 flex items-center gap-4">
        <span className="h-px flex-1 border-t border-dashed border-ink/60" aria-hidden />
        <button
          type="button"
          onClick={() => {
            setEditing(null);
            setDialogOpen(true);
          }}
          className="flex flex-col items-center gap-1 text-sm font-medium"
        >
          <span className="flex size-6 items-center justify-center rounded-full bg-ink text-white">
            <Plus className="size-4" />
          </span>
          Add New Address
        </button>
        <span className="h-px flex-1 border-t border-dashed border-ink/60" aria-hidden />
      </div>

      <AddressFormDialog open={dialogOpen} onOpenChange={setDialogOpen} editing={editing} onSaved={(address) => onSelect(address.id)} />
    </section>
  );
}
