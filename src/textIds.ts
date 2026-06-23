export interface KebabIdOptions {
  readonly fallback?: string;
  readonly maxLength?: number;
}

export const toKebabId = (value: string, options: KebabIdOptions = {}): string => {
  const fallback = options.fallback ?? "default";
  const maxLength = options.maxLength ?? 40;
  const normalized = value.toLowerCase().replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, maxLength);
  return normalized || fallback;
};
