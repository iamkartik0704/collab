import Image from "next/image";
import { ImageOff } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Product artwork. SVG artwork is served as-is; raster images go through the Next.js
 * optimiser (AVIF/WebP, responsive sizes).
 */
export function ProductImage({
  src,
  alt,
  sizes,
  priority = false,
  className,
}: {
  src: string | null;
  alt: string;
  sizes: string;
  priority?: boolean;
  className?: string;
}) {
  if (!src) {
    return (
      <div className={cn("flex size-full items-center justify-center text-line-2", className)} role="img" aria-label={alt}>
        <ImageOff className="size-10" />
      </div>
    );
  }
  return (
    <Image
      src={src}
      alt={alt}
      fill
      sizes={sizes}
      priority={priority}
      unoptimized={src.endsWith(".svg")}
      className={cn("object-contain", className)}
    />
  );
}
