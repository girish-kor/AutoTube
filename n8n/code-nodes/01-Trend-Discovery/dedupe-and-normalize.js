function stripHtml(text) {
  return String(text || "").replace(/<[^>]*>/g, "").trim();
}

function normalizeTitle(title) {
  return stripHtml(title).replace(/\s+/g, " ").trim();
}

function scoreYoutubeItem(item, index, total) {
  // Rank-based decay plus a view-velocity boost, bounded to [0, 100].
  const rankScore = ((total - index) / total) * 70;
  const views = Number(item.viewCount || 0);
  const velocityScore = Math.min(30, Math.log10(views + 1) * 3);
  return Math.min(100, rankScore + velocityScore);
}

function scoreTrendsItem(item, index, total) {
  return Math.min(100, ((total - index) / total) * 100);
}

function dedupeAndNormalize(channelId, discoveredDate, youtubeItems, trendsItems) {
  const rows = [];
  const seen = new Set();

  youtubeItems.forEach((item, index) => {
    const title = normalizeTitle(item.title);
    const key = `youtube_trending::${title.toLowerCase()}`;
    if (!title || seen.has(key)) return;
    seen.add(key);
    rows.push({
      channel_id: channelId,
      title,
      source: "youtube_trending",
      trend_score: Number(scoreYoutubeItem(item, index, youtubeItems.length).toFixed(2)),
      discovered_date: discoveredDate,
    });
  });

  trendsItems.forEach((item, index) => {
    const title = normalizeTitle(item.title);
    const key = `google_trends::${title.toLowerCase()}`;
    if (!title || seen.has(key)) return;
    seen.add(key);
    rows.push({
      channel_id: channelId,
      title,
      source: "google_trends",
      trend_score: Number(scoreTrendsItem(item, index, trendsItems.length).toFixed(2)),
      discovered_date: discoveredDate,
    });
  });

  return rows;
}

module.exports = { stripHtml, normalizeTitle, scoreYoutubeItem, scoreTrendsItem, dedupeAndNormalize };
