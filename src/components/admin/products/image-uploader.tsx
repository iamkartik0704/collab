"use client";

import { ArrowDown, ArrowUp, ImagePlus, Loader2, Star, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { selectClass } from "@/components/admin/ui";
import { apiFetch, ApiClientError } from "@/lib/api-client";
import { cn } from "@/lib/utils";

export interface UploadedImage {
  storageKey: string;
  url: string;
  alt: string;
  width: number;
  height: number;
  color: string | null;
  isPrimary: boolean;
}

interface PendingUpload {
  id: string;
  name: string;
  progress: number;
  error: string | null;
}

const ACCEPTED = ["image/jpeg", "image/png", "image/webp", "image/avif"] as const;
const MAX_BYTES = 8 * 1024 * 1024;

interface PresignResponse {
  upload: { url: string; fields: Record<string, string>; key: string; publicUrl: string };
}

async function readDimensions(file: File): Promise<{ width: number; height: number }> {
  const bitmap = await createImageBitmap(file);
  const size = { width: bitmap.width, height: bitmap.height };
  bitmap.close();
  return size;
}

/** multipart POST straight to the bucket with upload progress (fetch has no upload progress). */
function postToBucket(url: string, fields: Record<string, string>, file: File, onProgress: (ratio: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    for (const [key, value] of Object.entries(fields)) form.append(key, value);
    form.append("file", file); // must be the last field of an S3 POST policy upload
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.upload.onprogress = (event) => event.lengthComputable && onProgress(event.loaded / event.total);
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Upload rejected by storage (${xhr.status})`)));
    xhr.onerror = () => reject(new Error("Network error while uploading"));
    xhr.send(form);
  });
}

/**
 * Product gallery editor. Files go browser -> bucket through a presigned POST (the server pins
 * key, type and size); the server re-checks every new key against the bucket when saving.
 */
export function ImageUploader({
  images,
  onChange,
  productId,
  colors,
  defaultAlt,
}: {
  images: UploadedImage[];
  onChange: (images: UploadedImage[]) => void;
  productId: string | null;
  colors: string[];
  defaultAlt: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<PendingUpload[]>([]);
  const [dragging, setDragging] = useState(false);
  const latest = useRef(images);
  latest.current = images;

  const update = (id: string, patch: Partial<PendingUpload>) => setPending((list) => list.map((item) => (item.id === id ? { ...item, ...patch } : item)));

  async function upload(file: File) {
    const id = crypto.randomUUID();
    setPending((list) => [...list, { id, name: file.name, progress: 0, error: null }]);
    try {
      if (!(ACCEPTED as readonly string[]).includes(file.type)) throw new Error("Use JPEG, PNG, WebP or AVIF");
      if (file.size > MAX_BYTES) throw new Error("Images must be 8 MB or smaller");
      const dimensions = await readDimensions(file);
      const { upload: target } = await apiFetch<PresignResponse>("/api/admin/uploads/presign", {
        method: "POST",
        body: { contentType: file.type, sizeBytes: file.size, ...(productId ? { productId } : {}) },
      });
      await postToBucket(target.url, target.fields, file, (ratio) => update(id, { progress: ratio }));
      const next = [
        ...latest.current,
        { storageKey: target.key, url: target.publicUrl, alt: defaultAlt, width: dimensions.width, height: dimensions.height, color: null, isPrimary: latest.current.length === 0 },
      ];
      onChange(next);
      setPending((list) => list.filter((item) => item.id !== id));
    } catch (error) {
      update(id, { error: error instanceof ApiClientError || error instanceof Error ? error.message : "Upload failed" });
    }
  }

  function handleFiles(files: FileList | null) {
    if (!files) return;
    for (const file of Array.from(files).slice(0, 20)) void upload(file);
  }

  const patch = (index: number, change: Partial<UploadedImage>) => onChange(images.map((image, i) => (i === index ? { ...image, ...change } : image)));
  const move = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= images.length) return;
    const next = [...images];
    [next[index], next[target]] = [next[target]!, next[index]!];
    onChange(next);
  };

  return (
    <div>
      <div
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          handleFiles(event.dataTransfer.files);
        }}
        className={cn("flex flex-col items-center justify-center gap-2 rounded-[var(--radius-card)] border-2 border-dashed px-6 py-8 text-center transition-colors", dragging ? "border-ink bg-surface" : "border-line-2")}
      >
        <ImagePlus className="size-7 text-muted" aria-hidden />
        <p className="text-sm">
          Drag images here or{" "}
          <button type="button" onClick={() => inputRef.current?.click()} className="font-medium underline underline-offset-4">
            browse
          </button>
        </p>
        <p className="text-xs text-muted-2">JPEG, PNG, WebP or AVIF · up to 8 MB each · square images look best</p>
        <input ref={inputRef} type="file" accept={ACCEPTED.join(",")} multiple className="sr-only" onChange={(event) => { handleFiles(event.target.files); event.target.value = ""; }} aria-label="Upload product images" />
      </div>

      {pending.length > 0 && (
        <ul className="mt-3 space-y-2" aria-live="polite">
          {pending.map((item) => (
            <li key={item.id} className="flex items-center gap-3 rounded-md bg-surface px-3 py-2 text-xs">
              {item.error ? <span className="text-danger">✕</span> : <Loader2 className="size-3.5 animate-spin" aria-hidden />}
              <span className="min-w-0 flex-1 truncate">{item.name}</span>
              {item.error ? (
                <>
                  <span className="text-danger">{item.error}</span>
                  <button type="button" className="underline" onClick={() => setPending((list) => list.filter((entry) => entry.id !== item.id))}>
                    Dismiss
                  </button>
                </>
              ) : (
                <span className="tabular-nums text-muted-2">{Math.round(item.progress * 100)}%</span>
              )}
            </li>
          ))}
        </ul>
      )}

      {images.length > 0 && (
        <ul className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {images.map((image, index) => (
            <li key={image.storageKey} className={cn("rounded-[var(--radius-card)] border p-3", image.isPrimary ? "border-ink" : "border-line")}>
              <div className="relative aspect-square overflow-hidden rounded bg-surface">
                {/* eslint-disable-next-line @next/next/no-img-element -- admin preview of arbitrary bucket URLs */}
                <img src={image.url} alt={image.alt} className="size-full object-contain" />
                {image.isPrimary && <span className="absolute left-2 top-2 rounded bg-ink px-1.5 py-0.5 text-[10px] font-semibold uppercase text-white">Primary</span>}
              </div>
              <label className="mt-2 block text-xs font-medium">
                Alt text
                <input value={image.alt} maxLength={200} onChange={(event) => patch(index, { alt: event.target.value })} className="mt-1 h-9 w-full rounded border border-line-2 px-2 text-xs focus:border-ink focus:outline-none" />
              </label>
              <label className="mt-2 block text-xs font-medium">
                Shown for colour
                <select value={image.color ?? ""} onChange={(event) => patch(index, { color: event.target.value || null })} className={`${selectClass} mt-1 h-9 w-full text-xs`}>
                  <option value="">All colours</option>
                  {colors.map((color) => (
                    <option key={color} value={color}>
                      {color}
                    </option>
                  ))}
                </select>
              </label>
              <div className="mt-2 flex items-center justify-between text-xs">
                <button type="button" onClick={() => onChange(images.map((other, i) => ({ ...other, isPrimary: i === index })))} className="flex items-center gap-1 font-medium disabled:text-muted" disabled={image.isPrimary}>
                  <Star className="size-3.5" aria-hidden /> Make primary
                </button>
                <span className="flex gap-1">
                  <button type="button" onClick={() => move(index, -1)} className="rounded p-1 hover:bg-surface" aria-label="Move earlier">
                    <ArrowUp className="size-3.5" />
                  </button>
                  <button type="button" onClick={() => move(index, 1)} className="rounded p-1 hover:bg-surface" aria-label="Move later">
                    <ArrowDown className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const next = images.filter((_, i) => i !== index);
                      if (image.isPrimary && next[0]) next[0] = { ...next[0], isPrimary: true };
                      onChange(next);
                    }}
                    className="rounded p-1 text-danger hover:bg-surface"
                    aria-label={`Remove image ${index + 1}`}
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </span>
              </div>
              <p className="mt-1 text-[11px] text-muted">
                {image.width}×{image.height}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
