export function formatDosDate(value: unknown) {
  const text = String(value ?? "").trim();
  if (!text) return "-";
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) return `${match[2]}-${match[3]}-${match[1].slice(2)}`;
  const slashMatch = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (slashMatch) {
    const month = slashMatch[1].padStart(2, "0");
    const day = slashMatch[2].padStart(2, "0");
    const year = slashMatch[3].slice(-2);
    return `${month}-${day}-${year}`;
  }
  return text;
}
