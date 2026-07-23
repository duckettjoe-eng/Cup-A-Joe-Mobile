// Vercel serverless function: fetches Google News RSS server-side.
// Server-to-server requests aren't subject to browser CORS rules, so this
// replaces the public api.allorigins.win proxy the frontend used before.
//
// Usage: GET /api/local-news?area=<city or county name>

module.exports = async (req, res) => {
  const area = (req.query.area || "").toString().trim();

  if (!area) {
    res.status(400).json({ error: "Missing required 'area' query parameter." });
    return;
  }

  const query = encodeURIComponent(`${area} news`);
  const rssUrl = `https://news.google.com/rss/search?q=${query}&hl=en-US&gl=US&ceid=US:en`;

  try {
    const upstream = await fetch(rssUrl, {
      headers: {
        // Google News is more consistent about serving RSS to a normal-looking UA.
        "User-Agent": "Mozilla/5.0 (compatible; CupAJoeLocalNews/1.0)"
      }
    });

    if (!upstream.ok) {
      res.status(502).json({ error: `Upstream RSS fetch failed with status ${upstream.status}` });
      return;
    }

    const xml = await upstream.text();

    // Cache at the edge for 5 min, serve stale for up to 10 min while revalidating,
    // so repeat visitors for the same area don't re-hit Google News every load.
    res.setHeader("Content-Type", "application/xml; charset=utf-8");
    res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=600");
    res.status(200).send(xml);
  } catch (err) {
    res.status(502).json({ error: "Failed to fetch local news RSS feed." });
  }
};
