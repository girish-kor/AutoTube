// Keyword/category denylist scan (docs/MONETIZATION.md §3), reading the
// maintained list from config.restricted_topic_denylist.
function checkRestrictedTopic(title, description, scriptJson, denylist) {
  const scriptText = ((scriptJson && scriptJson.scenes) || [])
    .map((s) => s.narration || "")
    .join(" ");
  const haystack = `${title || ""} ${description || ""} ${scriptText}`.toLowerCase();

  const hits = (denylist || []).filter((term) => haystack.includes(String(term).toLowerCase()));
  if (hits.length > 0) {
    return { passed: false, details: `denylist term(s) matched: ${hits.join(", ")}` };
  }
  return { passed: true, details: "no denylist terms matched" };
}

module.exports = { checkRestrictedTopic };
