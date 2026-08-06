// Vercel serverless function: proxies Google's Fact Check Tools API.
//
// The key used to be a string literal in index.html, which meant it shipped to
// every visitor's browser and sat in a public repo where scrapers find it.
// It now stays server-side in the FACTCHECK_API_KEY env var - the same one
// api/weekly-factcheck.js already uses.
//
// Usage: GET /api/factcheck?query=<claim text>

const UPSTREAM_TIMEOUT_MS = 8000;

function fetchWithTimeout(url, ms, opts) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, Object.assign({}, opts || {}, { signal: ctrl.signal }))
    .finally(() => clearTimeout(timer));
}

module.exports = async (req, res) => {
  const query = (req.query.query || "").toString().trim();

  if (!query) {
    res.setHeader("Cache-Control", "no-store");
    res.status(400).json({ error: "Missing required 'query' query parameter." });
    return;
  }

  const key = process.env.FACTCHECK_API_KEY;
  if (!key) {
    res.setHeader("Cache-Control", "no-store");
    res.status(500).json({ error: "FACTCHECK_API_KEY is not configured on the server." });
    return;
  }

  const params = new URLSearchParams({
    query: `${query} Trump`,
    languageCode: "en",
    key: key
  });

  try {
    const upstream = await fetchWithTimeout(
      `https://factchecktools.googleapis.com/v1alpha1/claims:search?${params}`,
      UPSTREAM_TIMEOUT_MS
    );

    if (!upstream.ok) {
      res.setHeader("Cache-Control", "no-store");
      // Pass the upstream status through so the UI keeps its 429/403 messaging.
      res.status(upstream.status).json({
        error: `Fact Check API responded with ${upstream.status}`
      });
      return;
    }

    const data = await upstream.json();

    // Same claim searched twice in a few minutes shouldn't burn extra quota.
    res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=600");
    res.status(200).json(data);
  } catch (err) {
    res.setHeader("Cache-Control", "no-store");
    res.status(502).json({
      error: err && err.name === "AbortError"
        ? `Fact Check API timed out after ${UPSTREAM_TIMEOUT_MS}ms`
        : "Failed to reach the Fact Check API."
    });
  }
};
