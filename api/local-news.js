// Vercel serverless function: fetches Google News RSS server-side.
// Server-to-server requests aren't subject to browser CORS rules, so this
// replaces the public api.allorigins.win proxy the frontend used before.
//
// Usage: GET /api/local-news?area=<city or county name>
//
// Reliability notes:
// - The upstream fetch had no timeout, so a slow Google response held the
//   function open until Vercel killed it and the browser got nothing back.
// - A single blip took the panel down; one retry covers the common case.
// - The body is checked to actually be RSS, so an HTML error/consent page is
//   reported as a failure here instead of reaching the browser and being
//   misread as "no headlines found".
// - Failures are sent with no-store so a transient error isn't cached at the
//   edge for the full 5 minutes.

const UPSTREAM_TIMEOUT_MS = 6000;
const MAX_ATTEMPTS = 2;

function fetchWithTimeout(url, ms, opts) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, Object.assign({}, opts || {}, { signal: ctrl.signal }))
    .finally(() => clearTimeout(timer));
}

module.exports = async (req, res) => {
  const area = (req.query.area || "").toString().trim();

  if (!area) {
    res.setHeader("Cache-Control", "no-store");
    res.status(400).json({ error: "Missing required 'area' query parameter." });
    return;
  }

  const query = encodeURIComponent(`${area} news`);
  const rssUrl = `https://news.google.com/rss/search?q=${query}&hl=en-US&gl=US&ceid=US:en`;

  let lastError = "unknown error";

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      const upstream = await fetchWithTimeout(rssUrl, UPSTREAM_TIMEOUT_MS, {
        headers: {
          // Google News is more consistent about serving RSS to a normal-looking UA.
          "User-Agent": "Mozilla/5.0 (compatible; CupAJoeLocalNews/1.0)"
        }
      });

      if (!upstream.ok) {
        lastError = `upstream RSS fetch failed with status ${upstream.status}`;
        continue;
      }

      const xml = await upstream.text();

      // Google occasionally answers 200 with an HTML consent or error page.
      // Treat anything that isn't an RSS document as a failure worth retrying.
      if (!/<rss[\s>]/i.test(xml)) {
        lastError = "upstream returned a non-RSS body";
        continue;
      }

      // Cache at the edge for 5 min, serve stale for up to 10 min while revalidating,
      // so repeat visitors for the same area don't re-hit Google News every load.
      res.setHeader("Content-Type", "application/xml; charset=utf-8");
      res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=600");
      res.status(200).send(xml);
      return;
    } catch (err) {
      lastError = err && err.name === "AbortError"
        ? `upstream RSS fetch timed out after ${UPSTREAM_TIMEOUT_MS}ms`
        : "upstream RSS fetch threw";
    }
  }

  res.setHeader("Cache-Control", "no-store");
  res.status(502).json({ error: `Failed to fetch local news RSS feed: ${lastError}` });
};
