function normalizeCandidate(text) {
  return String(text ?? "")
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .replaceAll("“", "\"")
    .replaceAll("”", "\"")
    .replaceAll("‘", "'")
    .replaceAll("’", "'")
    .replace(/,\s*([}\]])/g, "$1")
    .trim();
}

function extractFirstBalancedJsonObject(text) {
  const input = String(text ?? "");
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < input.length; index += 1) {
    const ch = input[index];

    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        continue;
      }
      if (ch === "\"") {
        inString = false;
      }
      continue;
    }

    if (ch === "\"") {
      inString = true;
      continue;
    }

    if (ch === "{") {
      if (depth === 0) {
        start = index;
      }
      depth += 1;
      continue;
    }

    if (ch === "}" && depth > 0) {
      depth -= 1;
      if (depth === 0 && start !== -1) {
        return input.slice(start, index + 1);
      }
    }
  }

  return "";
}

export function parseJsonLenient(rawText) {
  const text = String(rawText ?? "").trim();
  const candidates = new Set();
  candidates.add(text);

  const directStart = text.indexOf("{");
  const directEnd = text.lastIndexOf("}");
  if (directStart !== -1 && directEnd !== -1 && directEnd > directStart) {
    candidates.add(text.slice(directStart, directEnd + 1));
  }

  const balanced = extractFirstBalancedJsonObject(text);
  if (balanced) {
    candidates.add(balanced);
  }

  const fencedBlocks = text.match(/```(?:json)?\s*[\s\S]*?```/gi) ?? [];
  for (const block of fencedBlocks) {
    candidates.add(block);
    const balancedInBlock = extractFirstBalancedJsonObject(block);
    if (balancedInBlock) {
      candidates.add(balancedInBlock);
    }
  }

  for (const candidate of candidates) {
    const normalized = normalizeCandidate(candidate);
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
