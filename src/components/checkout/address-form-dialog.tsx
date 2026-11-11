"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { ApiClientError, apiFetch } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { addressSchema, INDIAN_STATES, type AddressInput, type SavedAddress } from "@/schemas/account";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { FieldError, Input, Label } from "@/components/ui/input";

const EMPTY: AddressInput = { type: "HOME", label: "", fullName: "", phone: "", line1: "", line2: "", landmark: "", city: "", state: "Karnataka", postalCode: "", isDefault: false };

function toInput(address: SavedAddress): AddressInput {
  return {
    type: address.type,
    label: address.label ?? "",
    fullName: address.fullName,
    phone: address.phone.replace(/^\+91/, ""),
    line1: address.line1,
    line2: address.line2 ?? "",
    landmark: address.landmark ?? "",
    city: address.city,
    state: (INDIAN_STATES as readonly string[]).includes(address.state) ? (address.state as AddressInput["state"]) : "Karnataka",
    postalCode: address.postalCode,
    isDefault: address.isDefault,
  };
}

/** Create / edit an address. Validation is the same Zod schema the API enforces. */
export function AddressFormDialog({
  open,
  onOpenChange,
  editing,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: SavedAddress | null;
  onSaved: (address: SavedAddress) => void;
}) {
  const queryClient = useQueryClient();
  const form = useForm<AddressInput>({ resolver: zodResolver(addressSchema), defaultValues: EMPTY });
  const { register, handleSubmit, formState, reset, setError } = form;

  useEffect(() => {
    if (open) reset(editing ? toInput(editing) : EMPTY);
  }, [open, editing, reset]);

  const save = useMutation({
    mutationFn: (values: AddressInput) =>
      editing
        ? apiFetch<{ address: SavedAddress }>(`/api/account/addresses/${editing.id}`, { method: "PATCH", body: values })
        : apiFetch<{ address: SavedAddress }>("/api/account/addresses", { method: "POST", body: values }),
    onSuccess: ({ address }) => {
      void queryClient.invalidateQueries({ queryKey: ["addresses"] });
      onSaved(address);
      onOpenChange(false);
    },
    onError: (error) => setError("root", { message: error instanceof ApiClientError ? error.message : "Could not save the address." }),
  });

  const field = (name: keyof AddressInput) => ({ ...register(name), invalid: Boolean(formState.errors[name]), id: `address-${name}` });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={editing ? "Edit address" : "Add new address"} description="Deliveries are available across India.">
        <form onSubmit={handleSubmit((values) => save.mutate(values))} className="grid gap-4 sm:grid-cols-2" noValidate>
          <fieldset className="sm:col-span-2">
            <legend className="mb-1.5 text-sm font-medium">Address type</legend>
            <div className="flex gap-2">
              {(["HOME", "OFFICE", "OTHER"] as const).map((type) => (
                <label key={type} className="cursor-pointer">
                  <input type="radio" value={type} {...register("type")} className="peer sr-only" />
                  <span className="block rounded-md border border-line-2 px-4 py-2 text-xs font-semibold peer-checked:border-ink peer-checked:bg-ink peer-checked:text-white peer-focus-visible:ring-2 peer-focus-visible:ring-ink">
                    {type}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          <div className="sm:col-span-2">
            <Label htmlFor="address-fullName">Full name</Label>
            <Input autoComplete="name" {...field("fullName")} />
            <FieldError message={formState.errors.fullName?.message} />
          </div>
          <div>
            <Label htmlFor="address-phone">Mobile number</Label>
            <Input type="tel" inputMode="tel" autoComplete="tel-national" placeholder="98765 43210" {...field("phone")} />
            <FieldError message={formState.errors.phone?.message} />
          </div>
          <div>
            <Label htmlFor="address-postalCode">PIN code</Label>
            <Input inputMode="numeric" autoComplete="postal-code" maxLength={6} {...field("postalCode")} />
            <FieldError message={formState.errors.postalCode?.message} />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="address-line1">Flat, house no., building, street</Label>
            <Input autoComplete="address-line1" {...field("line1")} />
            <FieldError message={formState.errors.line1?.message} />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="address-line2">Area, sector, village (optional)</Label>
            <Input autoComplete="address-line2" {...field("line2")} />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="address-landmark">Landmark (optional)</Label>
            <Input {...field("landmark")} />
          </div>
          <div>
            <Label htmlFor="address-city">City</Label>
            <Input autoComplete="address-level2" {...field("city")} />
            <FieldError message={formState.errors.city?.message} />
          </div>
          <div>
            <Label htmlFor="address-state">State</Label>
            <select
              id="address-state"
              {...register("state")}
              className={cn("h-12 w-full rounded-[7px] border border-line-2 bg-white px-3 text-sm focus:border-ink focus:outline-none", formState.errors.state && "border-danger")}
            >
              {INDIAN_STATES.map((state) => (
                <option key={state} value={state}>
                  {state}
                </option>
              ))}
            </select>
            <FieldError message={formState.errors.state?.message} />
          </div>
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input type="checkbox" {...register("isDefault")} className="size-4 accent-black" /> Make this my default address
          </label>
          <div className="sm:col-span-2">
            <FieldError message={formState.errors.root?.message} />
            <Button type="submit" size="lg" block loading={save.isPending} className="mt-2">
              {editing ? "Save changes" : "Add address"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
