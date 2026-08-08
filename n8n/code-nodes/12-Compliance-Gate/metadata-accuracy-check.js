// Structurally prevents clickbait/misleading-metadata: title+description
// must keyword-overlap the actual script content (docs/CONTENT_PIPELINE.md §4.4).
function tokenize(text) {
  return String(text || "").toLowerCase().match(/[a-z0-9']+/g) || [];
}

function checkMetadataAccuracy(title, description, scriptJson, threshold) {
  const minLength = threshold === undefined ? 0.3 : threshold;
  const scriptWords = new Set(
    ((scriptJson && scriptJson.scenes) || [])
      .flatMap((s) => tokenize(s.narration))
      .filter((w) => w.length > 3)
  );
  const metaWords = [
    ...new Set([...tokenize(title), ...tokenize(description)].filter((w) => w.length > 3)),
  ];
  if (metaWords.length === 0) {
    return { passed: false, details: "title/description produced no comparable keywords" };
  }
  const overlap = metaWords.filter((w) => scriptWords.has(w)).length;
  const ratio = overlap / metaWords.length;
  const passed = ratio >= minLength;
  return { passed, details: `keyword overlap ratio ${ratio.toFixed(2)} (threshold ${minLength})` };
}

module.exports = { tokenize, checkMetadataAccuracy };
