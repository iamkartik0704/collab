import type { Prisma, ProductStatus } from "@prisma/client";
import { Errors } from "@/lib/api/errors";
import { db, isUniqueConstraintError, withTransaction, type TransactionClient } from "@/lib/db";
import { resolveImageUrl } from "@/lib/images";
import { logger } from "@/lib/logger";
import { PostCommitEffects } from "@/lib/post-commit";
import { CacheTags, invalidateCacheTags } from "@/lib/redis";
import { deleteObject, headObject, IMAGE_CONTENT_TYPES, MAX_IMAGE_BYTES } from "@/lib/storage/s3";
import { storageLabel } from "@/lib/utils";
import { HIGHLIGHT_ICONS, type ProductFormValues, type ProductInput } from "@/schemas/admin";
import { adjustStock, updateLowStockThreshold } from "@/server/inventory/reservation.service";
import { enqueueProductReindex } from "@/queues";
import { writeAudit } from "./audit";
import type { AdminContext } from "./context";

/**
 * Product & multi-variant SKU builder. One save = one transaction: product fields, the variant
 * matrix (create / update / archive / revive), opening stock, images and the audit trail.
 */

export const ADMIN_PAGE_SIZE = 20;

/** Where uploaded product images live; anything else is rejected at save time. */
export const PRODUCT_UPLOAD_PREFIX = "products/";

// ============================================================================ list

export interface AdminProductRow {
  id: string;
  slug: string;
  name: string;
  status: ProductStatus;
  brand: string;
  category: string;
  imageUrl: string | null;
  variantCount: number;
  minPriceMinor: number | null;
  maxPriceMinor: number | null;
  available: number;
  lowStockVariants: number;
  updatedAt: Date;
}

export interface AdminProductFilters {
  q?: string | undefined;
  status?: ProductStatus | undefined;
  categoryId?: string | undefined;
  page: number;
}

export async function listAdminProducts(filters: AdminProductFilters): Promise<{ rows: AdminProductRow[]; total: number; page: number; pageCount: number }> {
  const q = filters.q?.trim();
  const where: Prisma.ProductWhereInput = {
    deletedAt: null,
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.categoryId ? { categoryId: filters.categoryId } : {}),
    ...(q
      ? {
          OR: [
            { name: { contains: q, mode: "insensitive" } },
            { slug: { contains: q.toLowerCase() } },
            { variants: { some: { sku: { contains: q.toUpperCase() } } } },
          ],
        }
      : {}),
  };
  const total = await db.product.count({ where });
  const pageCount = Math.max(1, Math.ceil(total / ADMIN_PAGE_SIZE));
  const page = Math.min(Math.max(1, filters.page), pageCount);
  const products = await db.product.findMany({
    where,
    orderBy: { updatedAt: "desc" },
    skip: (page - 1) * ADMIN_PAGE_SIZE,
    take: ADMIN_PAGE_SIZE,
    select: {
      id: true,
      slug: true,
      name: true,
      status: true,
      updatedAt: true,
      brand: { select: { name: true } },
      category: { select: { name: true } },
      images: { orderBy: [{ isPrimary: "desc" }, { sortOrder: "asc" }], take: 1, select: { storageKey: true } },
      variants: {
        where: { deletedAt: null },
        select: { priceMinor: true, isActive: true, inventory: { select: { quantityAvailable: true, lowStockThreshold: true } } },
      },
    },
  });
  return {
    total,
    page,
    pageCount,
    rows: products.map((product) => {
      const active = product.variants.filter((variant) => variant.isActive);
      const prices = active.map((variant) => variant.priceMinor);
      return {
        id: product.id,
        slug: product.slug,
        name: product.name,
        status: product.status,
        brand: product.brand.name,
        category: product.category.name,
        imageUrl: resolveImageUrl(product.images[0]?.storageKey),
        variantCount: product.variants.length,
        minPriceMinor: prices.length ? Math.min(...prices) : null,
        maxPriceMinor: prices.length ? Math.max(...prices) : null,
        available: active.reduce((sum, variant) => sum + (variant.inventory?.quantityAvailable ?? 0), 0),
        lowStockVariants: active.filter(
          (variant) => variant.inventory && variant.inventory.quantityAvailable <= variant.inventory.lowStockThreshold,
        ).length,
        updatedAt: product.updatedAt,
      };
    }),
  };
}

// ============================================================================ form data

export interface ProductFormOptions {
  brands: Array<{ id: string; name: string }>;
  categories: Array<{ id: string; name: string; specGroups: string[] }>;
}

/** Spec groups suggested per category (from the facet template + groups used by its products). */
export async function getProductFormOptions(): Promise<ProductFormOptions> {
  const [brands, categories, specRows] = await Promise.all([
    db.brand.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.category.findMany({ orderBy: { sortOrder: "asc" }, select: { id: true, name: true, specTemplate: true } }),
    db.product.findMany({ where: { deletedAt: null }, select: { categoryId: true, specs: true } }),
  ]);
  const groupsByCategory = new Map<string, Set<string>>();
  for (const row of specRows) {
    if (row.specs && typeof row.specs === "object" && !Array.isArray(row.specs)) {
      const set = groupsByCategory.get(row.categoryId) ?? new Set<string>();
      Object.keys(row.specs).forEach((group) => set.add(group));
      groupsByCategory.set(row.categoryId, set);
    }
  }
  return {
    brands,
    categories: categories.map((category) => {
      const set = groupsByCategory.get(category.id) ?? new Set<string>();
      const template = category.specTemplate as { facets?: Array<{ group?: unknown }> } | null;
      template?.facets?.forEach((facet) => typeof facet.group === "string" && set.add(facet.group));
      return { id: category.id, name: category.name, specGroups: [...set] };
    }),
  };
}

export interface EditableProduct {
  id: string;
  slug: string;
  values: ProductFormValues;
  /** storageKey -> displayable URL, for previews of existing images. */
  imageUrls: Record<string, string>;
  /** Variant id -> live stock, for the read-only stock column of existing SKUs. */
  stock: Record<string, { onHand: number; reserved: number; available: number }>;
}

function asSpecs(value: Prisma.JsonValue): Record<string, Record<string, string>> {
  const specs: Record<string, Record<string, string>> = {};
  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const [group, fields] of Object.entries(value)) {
      if (fields && typeof fields === "object" && !Array.isArray(fields)) {
        specs[group] = Object.fromEntries(Object.entries(fields).map(([key, v]) => [key, String(v)]));
      }
    }
  }
  return specs;
}

function asHighlights(value: Prisma.JsonValue): ProductFormValues["highlightSpecs"] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const { icon, label, value: text } = item as Record<string, unknown>;
    return typeof icon === "string" && (HIGHLIGHT_ICONS as readonly string[]).includes(icon) && typeof label === "string" && typeof text === "string"
      ? [{ icon: icon as (typeof HIGHLIGHT_ICONS)[number], label, value: text }]
      : [];
  });
}

export async function getProductForEdit(id: string): Promise<EditableProduct | null> {
  const product = await db.product.findFirst({
    where: { id, deletedAt: null },
    include: {
      variants: { where: { deletedAt: null }, orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }], include: { inventory: true } },
      images: { orderBy: [{ isPrimary: "desc" }, { sortOrder: "asc" }], include: { variant: { select: { color: true } } } },
    },
  });
  if (!product) return null;

  // Several rows may share one file (e.g. per-variant seed artwork): show each file once.
  const seen = new Set<string>();
  const images = product.images.filter((image) => !seen.has(image.storageKey) && seen.add(image.storageKey));

  return {
    id: product.id,
    slug: product.slug,
    imageUrls: Object.fromEntries(images.map((image) => [image.storageKey, resolveImageUrl(image.storageKey)!])),
    stock: Object.fromEntries(
      product.variants.map((variant) => [
        variant.id,
        {
          onHand: variant.inventory?.quantityOnHand ?? 0,
          reserved: variant.inventory?.quantityReserved ?? 0,
          available: variant.inventory?.quantityAvailable ?? 0,
        },
      ]),
    ),
    values: {
      name: product.name,
      slug: product.slug,
      subtitle: product.subtitle,
      summary: product.summary,
      description: product.description,
      brandId: product.brandId,
      categoryId: product.categoryId,
      status: product.status,
      isFeatured: product.isFeatured,
      warrantyMonths: product.warrantyMonths,
      hsnCode: product.hsnCode,
      gstRateBps: product.gstRateBps,
      metaTitle: product.metaTitle,
      metaDescription: product.metaDescription,
      specs: asSpecs(product.specs),
      highlightSpecs: asHighlights(product.highlightSpecs),
      variants: product.variants.map((variant) => ({
        id: variant.id,
        sku: variant.sku,
        barcode: variant.barcode,
        color: variant.color,
        colorHex: variant.colorHex,
        storageGb: variant.storageGb,
        ramGb: variant.ramGb,
        priceMinor: variant.priceMinor,
        compareAtPriceMinor: variant.compareAtPriceMinor,
        costPriceMinor: variant.costPriceMinor,
        weightGrams: variant.weightGrams,
        isActive: variant.isActive,
        isDefault: variant.isDefault,
        initialStock: 0,
        lowStockThreshold: variant.inventory?.lowStockThreshold ?? 5,
      })),
      images: images.map((image, index) => ({
        storageKey: image.storageKey,
        alt: image.alt,
        width: image.width,
        height: image.height,
        color: image.variant?.color ?? null,
        isPrimary: image.isPrimary || (index === 0 && !images.some((other) => other.isPrimary)),
      })),
    },
  };
}

// ============================================================================ save

export function variantTitle(variant: { color: string | null; storageGb: number | null; ramGb: number | null }): string {
  const parts = [variant.color, variant.storageGb ? storageLabel(variant.storageGb) : null, variant.ramGb ? `${variant.ramGb}GB RAM` : null];
  return parts.filter(Boolean).join(" / ") || "Standard";
}

type SavedProduct = Prisma.ProductGetPayload<{
  include: { variants: { include: { inventory: true } }; images: true; category: { select: { slug: true } }; brand: { select: { slug: true } } };
}>;

/** Compact, diff-friendly view of a product for the audit log. */
function auditView(product: SavedProduct | null) {
  if (!product) return null;
  return {
    name: product.name,
    slug: product.slug,
    status: product.status,
    brandId: product.brandId,
    categoryId: product.categoryId,
    subtitle: product.subtitle,
    isFeatured: product.isFeatured,
    warrantyMonths: product.warrantyMonths,
    hsnCode: product.hsnCode,
    gstRateBps: product.gstRateBps,
    descriptionLength: product.description.length,
    specs: product.specs,
    highlightSpecs: product.highlightSpecs,
    variants: product.variants
      .filter((variant) => !variant.deletedAt)
      .map((variant) => ({
        sku: variant.sku,
        title: variant.title,
        priceMinor: variant.priceMinor,
        compareAtPriceMinor: variant.compareAtPriceMinor,
        costPriceMinor: variant.costPriceMinor,
        isActive: variant.isActive,
        isDefault: variant.isDefault,
      }))
      .sort((a, b) => a.sku.localeCompare(b.sku)),
    images: [...new Set(product.images.map((image) => image.storageKey))].sort(),
  };
}

async function loadSaved(tx: TransactionClient, id: string): Promise<SavedProduct | null> {
  return tx.product.findUnique({
    where: { id },
    include: {
      variants: { include: { inventory: true }, orderBy: { createdAt: "asc" } },
      images: true,
      category: { select: { slug: true } },
      brand: { select: { slug: true } },
    },
  });
}

/** Validates a newly attached upload against what actually landed in the bucket. */
async function verifyUpload(storageKey: string): Promise<void> {
  if (!storageKey.startsWith(PRODUCT_UPLOAD_PREFIX) || storageKey.includes("..")) {
    throw Errors.unprocessable("invalid_image", "An image was not uploaded through the product uploader.");
  }
  const object = await headObject(storageKey);
  if (!object) {
    throw Errors.unprocessable("image_missing", "An uploaded image could not be found. Upload it again.");
  }
  if (!object.contentType || !(object.contentType in IMAGE_CONTENT_TYPES) || object.sizeBytes > MAX_IMAGE_BYTES) {
    throw Errors.unprocessable("invalid_image", "An uploaded file is not a supported image.");
  }
}

export async function saveProduct(ctx: AdminContext, productId: string | null, input: ProductInput): Promise<{ id: string; slug: string }> {
  // Object-storage checks happen before the transaction (network calls must not hold row locks).
  const existingKeys = productId
    ? new Set((await db.productImage.findMany({ where: { productId }, select: { storageKey: true } })).map((image) => image.storageKey))
    : new Set<string>();
  for (const image of input.images) {
    if (!existingKeys.has(image.storageKey)) await verifyUpload(image.storageKey);
  }

  const effects = new PostCommitEffects();
  const invalidate = new Set<string>([CacheTags.catalog(), CacheTags.home()]);
  let removedKeys: string[] = [];

  let saved: { id: string; slug: string };
  try {
    saved = await withTransaction(
      async (tx) => {
        const [brand, category] = await Promise.all([
          tx.brand.findUnique({ where: { id: input.brandId }, select: { id: true, slug: true } }),
          tx.category.findUnique({ where: { id: input.categoryId }, select: { id: true, slug: true } }),
        ]);
        if (!brand) throw Errors.unprocessable("invalid_brand", "Choose a valid brand.");
        if (!category) throw Errors.unprocessable("invalid_category", "Choose a valid category.");

        let before: SavedProduct | null = null;
        if (productId) {
          // Serialises concurrent saves of the same product.
          const locked = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM "Product" WHERE id = ${productId} AND "deletedAt" IS NULL FOR UPDATE`;
          if (locked.length === 0) throw Errors.notFound("Product");
          before = await loadSaved(tx, productId);
        }

        const skus = input.variants.map((variant) => variant.sku);
        const taken = await tx.productVariant.findMany({
          where: { sku: { in: skus }, ...(productId ? { productId: { not: productId } } : {}) },
          select: { sku: true },
        });
        if (taken.length > 0) {
          throw Errors.conflict("sku_taken", `SKU already used by another product: ${taken.map((row) => row.sku).join(", ")}`, {
            skus: taken.map((row) => row.sku),
          });
        }

        const fields = {
          name: input.name,
          slug: input.slug,
          subtitle: input.subtitle,
          summary: input.summary,
          description: input.description,
          brandId: brand.id,
          categoryId: category.id,
          status: input.status,
          isFeatured: input.isFeatured,
          warrantyMonths: input.warrantyMonths,
          hsnCode: input.hsnCode,
          gstRateBps: input.gstRateBps,
          metaTitle: input.metaTitle,
          metaDescription: input.metaDescription,
          specs: input.specs,
          highlightSpecs: input.highlightSpecs,
        } satisfies Prisma.ProductUncheckedUpdateInput;

        const publishNow = input.status === "ACTIVE" && !before?.publishedAt;
        const product = before
          ? await tx.product.update({ where: { id: before.id }, data: { ...fields, ...(publishNow ? { publishedAt: new Date() } : {}) }, select: { id: true, slug: true } })
          : await tx.product.create({ data: { ...fields, publishedAt: publishNow ? new Date() : null }, select: { id: true, slug: true } });

        // ---------------------------------------------------------------- variants
        const current = new Map((before?.variants ?? []).map((variant) => [variant.id, variant]));
        const archivedBySku = new Map((before?.variants ?? []).filter((variant) => variant.deletedAt).map((variant) => [variant.sku, variant]));
        const keepIds = new Set<string>();

        // Partial unique index: at most one default per product, so clear first.
        await tx.productVariant.updateMany({ where: { productId: product.id, isDefault: true }, data: { isDefault: false } });

        const variantIdBySku = new Map<string, string>();
        for (const variant of input.variants) {
          const data = {
            sku: variant.sku,
            barcode: variant.barcode ?? null,
            title: variantTitle(variant),
            color: variant.color,
            colorHex: variant.colorHex,
            storageGb: variant.storageGb,
            ramGb: variant.ramGb,
            priceMinor: variant.priceMinor,
            compareAtPriceMinor: variant.compareAtPriceMinor,
            costPriceMinor: variant.costPriceMinor,
            weightGrams: variant.weightGrams,
            isActive: variant.isActive,
            isDefault: false,
          };

          const existing = variant.id ? current.get(variant.id) : archivedBySku.get(variant.sku);
          if (variant.id && (!existing || existing.deletedAt)) {
            throw Errors.unprocessable("invalid_variant", `Variant ${variant.sku} does not belong to this product.`);
          }

          if (existing) {
            keepIds.add(existing.id);
            await tx.productVariant.update({ where: { id: existing.id }, data: { ...data, deletedAt: null } });
            variantIdBySku.set(variant.sku, existing.id);
            if (existing.priceMinor !== variant.priceMinor || existing.compareAtPriceMinor !== variant.compareAtPriceMinor) {
              await writeAudit(tx, ctx, {
                action: "PRICE_CHANGE",
                entityType: "ProductVariant",
                entityId: existing.id,
                before: { sku: existing.sku, priceMinor: existing.priceMinor, compareAtPriceMinor: existing.compareAtPriceMinor },
                after: { sku: variant.sku, priceMinor: variant.priceMinor, compareAtPriceMinor: variant.compareAtPriceMinor },
              });
            }
            if (!existing.inventory) {
              await tx.inventoryItem.create({ data: { variantId: existing.id, lowStockThreshold: variant.lowStockThreshold } });
            } else if (existing.inventory.lowStockThreshold !== variant.lowStockThreshold) {
              await updateLowStockThreshold(tx, { variantId: existing.id, threshold: variant.lowStockThreshold, effects });
            }
            continue;
          }

          const created = await tx.productVariant.create({ data: { ...data, productId: product.id }, select: { id: true } });
          variantIdBySku.set(variant.sku, created.id);
          await tx.inventoryItem.create({ data: { variantId: created.id, lowStockThreshold: variant.lowStockThreshold } });
          if (variant.initialStock > 0) {
            const change = await adjustStock(tx, {
              variantId: created.id,
              mode: "delta",
              quantity: variant.initialStock,
              reason: "PURCHASE_ORDER_RECEIVED",
              note: "Opening stock (SKU builder)",
              actorId: ctx.actor.id,
              effects,
            });
            await writeAudit(tx, ctx, { action: "STOCK_ADJUSTMENT", entityType: "InventoryItem", entityId: created.id, before: change.before, after: change.after, reason: "Opening stock" });
          }
        }

        // Variants dropped from the matrix are archived, never deleted: orders reference them.
        for (const variant of current.values()) {
          if (!variant.deletedAt && !keepIds.has(variant.id)) {
            await tx.productVariant.update({ where: { id: variant.id }, data: { deletedAt: new Date(), isActive: false, isDefault: false } });
          }
        }

        const defaultSku = input.variants.find((variant) => variant.isDefault)!.sku;
        await tx.productVariant.update({ where: { id: variantIdBySku.get(defaultSku)! }, data: { isDefault: true } });

        // ---------------------------------------------------------------- images
        // Gallery rows are rebuilt from the form (nothing references image ids). An image tagged
        // with a colour is linked to that colour's first variant; the storefront matches by colour.
        const variantIdByColor = new Map<string, string>();
        for (const variant of input.variants) {
          if (variant.color && variant.isActive && !variantIdByColor.has(variant.color)) {
            variantIdByColor.set(variant.color, variantIdBySku.get(variant.sku)!);
          }
        }
        await tx.productImage.deleteMany({ where: { productId: product.id } });
        const hasPrimary = input.images.some((image) => image.isPrimary);
        if (input.images.length > 0) {
          await tx.productImage.createMany({
            data: input.images.map((image, index) => ({
              productId: product.id,
              storageKey: image.storageKey,
              alt: image.alt,
              width: image.width,
              height: image.height,
              sortOrder: index,
              isPrimary: hasPrimary ? image.isPrimary : index === 0,
              variantId: image.color ? (variantIdByColor.get(image.color) ?? null) : null,
            })),
          });
        }
        const keptKeys = new Set(input.images.map((image) => image.storageKey));
        removedKeys = [...existingKeys].filter((key) => !keptKeys.has(key) && key.startsWith(PRODUCT_UPLOAD_PREFIX));

        const after = await loadSaved(tx, product.id);
        await writeAudit(tx, ctx, {
          action: before ? "UPDATE" : "CREATE",
          entityType: "Product",
          entityId: product.id,
          before: auditView(before),
          after: auditView(after),
        });

        invalidate.add(CacheTags.product(product.id));
        invalidate.add(CacheTags.category(category.slug));
        if (before) invalidate.add(CacheTags.category(before.category.slug));
        return product;
      },
      { timeoutMs: 30_000 },
    );
  } catch (error) {
    if (isUniqueConstraintError(error, "slug")) throw Errors.conflict("slug_taken", "Another product already uses this URL slug.");
    if (isUniqueConstraintError(error, "sku")) throw Errors.conflict("sku_taken", "One of these SKUs is already in use.");
    if (isUniqueConstraintError(error, "barcode")) throw Errors.conflict("barcode_taken", "One of these barcodes is already in use.");
    throw error;
  }

  await effects.flush();
  await invalidateCacheTags([...invalidate]).catch((error: unknown) => logger.warn({ err: error }, "cache invalidation after product save failed"));
  await enqueueProductReindex(saved.id).catch((error: unknown) => logger.warn({ err: error, productId: saved.id }, "could not queue product re-index"));
  for (const key of removedKeys) {
    // Unreferenced uploads are removed after commit; a failure only leaves an orphaned object.
    const stillUsed = await db.productImage.count({ where: { storageKey: key } });
    if (stillUsed === 0) await deleteObject(key).catch((error: unknown) => logger.warn({ err: error, key }, "could not delete removed product image"));
  }
  return saved;
}

/** Archives a product (hidden from the storefront; history and orders keep working). */
export async function archiveProduct(ctx: AdminContext, productId: string): Promise<void> {
  const category = await withTransaction(async (tx) => {
    const product = await tx.product.findFirst({ where: { id: productId, deletedAt: null }, select: { id: true, status: true, category: { select: { slug: true } } } });
    if (!product) throw Errors.notFound("Product");
    if (product.status === "ARCHIVED") return product.category.slug;
    await tx.product.update({ where: { id: productId }, data: { status: "ARCHIVED" } });
    await writeAudit(tx, ctx, { action: "UPDATE", entityType: "Product", entityId: productId, before: { status: product.status }, after: { status: "ARCHIVED" }, reason: "archived" });
    return product.category.slug;
  });
  await invalidateCacheTags([CacheTags.product(productId), CacheTags.catalog(), CacheTags.home(), CacheTags.category(category)]).catch(() => undefined);
}
