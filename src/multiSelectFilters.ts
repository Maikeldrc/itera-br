const MULTI_FILTER_SEPARATOR = "\u001f";

export function encodeMultiFilter(values: string[]) {
  return Array.from(new Set(values.map(value => String(value ?? "").trim()).filter(Boolean))).join(MULTI_FILTER_SEPARATOR);
}

export function decodeMultiFilter(value: string | string[] | null | undefined) {
  if (Array.isArray(value)) return value.map(item => String(item ?? "").trim()).filter(Boolean);
  const text = String(value ?? "").trim();
  if (!text) return [];
  if (text.includes(MULTI_FILTER_SEPARATOR)) return text.split(MULTI_FILTER_SEPARATOR).map(item => item.trim()).filter(Boolean);
  return [text];
}

export function multiFilterMatches(rowValue: unknown, filterValue: string | string[] | null | undefined) {
  const selected = decodeMultiFilter(filterValue);
  if (selected.length === 0) return true;
  return selected.includes(String(rowValue ?? "").trim());
}

export function multiFilterIntersects(rowValues: unknown[], filterValue: string | string[] | null | undefined) {
  const selected = decodeMultiFilter(filterValue);
  if (selected.length === 0) return true;
  const normalizedValues = new Set(rowValues.map(value => String(value ?? "").trim()).filter(Boolean));
  return selected.some(value => normalizedValues.has(value));
}
