function tagsCharCount(tags) {
  return (tags || []).join(",").length;
}

function validateSeoLimits(metadata) {
  const errors = [];
  const title = metadata.title || "";
  const description = metadata.description || "";

  if (!title || title.length > 100) {
    errors.push(`title length ${title.length} exceeds 100 chars`);
  }
  if (!description || description.length > 5000) {
    errors.push(`description length ${description.length} exceeds 5000 chars`);
  }
  const tagChars = tagsCharCount(metadata.tags);
  if (tagChars > 500) {
    errors.push(`tags total length ${tagChars} exceeds 500 chars`);
  }

  return { ok: errors.length === 0, errors };
}

module.exports = { tagsCharCount, validateSeoLimits };
