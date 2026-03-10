function toObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return { ...value };
}

function toStringList(value, max = 16) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => String(item ?? "").trim()).filter(Boolean).slice(0, max);
}

function toGlossary(value, max = 24) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => ({
      term: String(item?.term ?? "").trim(),
      meaning: String(item?.meaning ?? "").trim(),
      aliases: toStringList(item?.aliases ?? [], 8),
    }))
    .filter((item) => item.term)
    .slice(0, max);
}

export function getMaterialProfile(world) {
  const metadata = toObject(world?.metadata);
  const material = toObject(metadata.material);
  return {
    fidelityRules: toStringList(material.fidelityRules ?? material.fidelity_rules, 16),
    glossary: toGlossary(material.glossary),
    worldSchema: toObject(metadata.worldSchema),
    characterSchema: toObject(metadata.characterSchema),
    publicAxesSchema: toObject(metadata.publicAxesSchema),
    storyPhase: String(metadata.storyPhase ?? ""),
    historyBrief: toStringList(metadata.historyBrief, 12),
  };
}

export function buildMaterialConstraint(world) {
  const profile = getMaterialProfile(world);
  return JSON.stringify({
    fidelity_rules: profile.fidelityRules,
    glossary: profile.glossary,
    world_schema: profile.worldSchema,
    character_schema: profile.characterSchema,
    public_axes_schema: profile.publicAxesSchema,
  });
}
