export function parseJsonLenient(rawText) {
  const text = String(rawText ?? "").trim();
  const candidates = [text];
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start !== -1 && end !== -1 && end > start) {
    candidates.push(text.slice(start, end + 1));
  }

  for (const candidate of candidates) {
    const normalized = candidate
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/\s*```$/i, "")
      .replaceAll("“", "\"")
      .replaceAll("”", "\"")
      .replaceAll("‘", "'")
      .replaceAll("’", "'")
      .replace(/,\s*([}\]])/g, "$1")
      .trim();
    if (!normalized) {
      continue;
    }
    try {
      return JSON.parse(normalized);
    } catch {
      continue;
    }
  }
  return null;
}
