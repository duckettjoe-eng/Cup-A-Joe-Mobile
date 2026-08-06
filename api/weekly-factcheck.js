// Runs weekly via the Vercel Cron schedule in vercel.json.
// Checks a fixed list of topics you maintain below, PLUS a broad sweep
// for any Trump-related claim fact-checked in the last 7 days.
// Instead of a database, results are committed straight into the repo
// as data/weekly-results.json using GitHub's API — same place your
// other files already live.

const TRACKED_TOPICS = [
  "Trump tariffs Canada",
  "Trump election security",
  "Trump Netanyahu arrest",
  "Trump SAVE America Act"
  // Add or remove topics here any time — one string per topic.
];

const GITHUB_OWNER = "duckettjoe-eng";
const GITHUB_REPO = "Cup-A-Joe-Mobile";
const FILE_PATH = "data/weekly-results.json";

async function searchClaims(query, maxAgeDays) {
  const params = new URLSearchParams({
    query,
    languageCode: "en",
    key: process.env.FACTCHECK_API_KEY
  });
  if (maxAgeDays) params.set("maxAgeDays", String(maxAgeDays));

  const res = await fetch(`https://factchecktools.googleapis.com/v1alpha1/claims:search?${params}`);

  // Swallowing this used to turn an API failure into an empty result set,
  // which then got committed over the previous week's good data. A key with
  // an HTTP-referrer restriction 403s here on every run, because server-side
  // requests send no referrer - and nothing surfaced it.
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Fact Check API ${res.status} for "${query}": ${detail.slice(0, 200)}`);
  }

  const data = await res.json();
  return data.claims || [];
}

async function getExistingFileSha() {
  // Needed because GitHub's "update file" API requires the current
  // file's SHA if it already exists — this looks it up, or returns
  // null if the file doesn't exist yet (first run).
  const res = await fetch(
    `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${FILE_PATH}`,
    { headers: { Authorization: `Bearer ${process.env.GITHUB_TOKEN}`, Accept: "application/vnd.github+json" } }
  );
  if (!res.ok) return null;
  const data = await res.json();
  return data.sha || null;
}

async function commitResultsToGitHub(payload) {
  const sha = await getExistingFileSha();
  const contentB64 = Buffer.from(JSON.stringify(payload, null, 2)).toString("base64");

  const body = {
    message: `Weekly fact-check update — ${new Date().toISOString().slice(0, 10)}`,
    content: contentB64,
    ...(sha ? { sha } : {})
  };

  const res = await fetch(
    `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${FILE_PATH}`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
        Accept: "application/vnd.github+json"
      },
      body: JSON.stringify(body)
    }
  );

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`GitHub commit failed (${res.status}): ${errText}`);
  }
}

module.exports = async function handler(req, res) {
  // Only Vercel's cron scheduler (or someone with the secret) can trigger this.
  const auth = req.headers.authorization;
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const found = new Map(); // dedupe by claim text + first review URL

    // 1. Fixed topics you're actively tracking
    for (const topic of TRACKED_TOPICS) {
      const claims = await searchClaims(topic);
      for (const c of claims) {
        const key = (c.text || "") + "|" + (c.claimReview?.[0]?.url || "");
        found.set(key, { ...c, matchedTopic: topic });
      }
    }

    // 2. Broad sweep — anything Trump-related fact-checked in the last 7 days,
    //    even if it's not one of your tracked topics
    const recent = await searchClaims("Trump", 7);
    for (const c of recent) {
      const key = (c.text || "") + "|" + (c.claimReview?.[0]?.url || "");
      if (!found.has(key)) {
        found.set(key, { ...c, matchedTopic: "new this week" });
      }
    }

    const results = Array.from(found.values()).slice(0, 30);

    // Never overwrite a good week with an empty one. If every query came back
    // empty, that is far more likely to be a broken key or quota than a week
    // in which no Trump claim was fact-checked anywhere.
    if (results.length === 0) {
      return res.status(502).json({
        error: "Every query returned zero claims — refusing to overwrite the stored results.",
        hint: "Check FACTCHECK_API_KEY: a key restricted by HTTP referrer cannot be used server-side."
      });
    }

    const payload = { generatedAt: new Date().toISOString(), claims: results };

    await commitResultsToGitHub(payload);

    return res.status(200).json({ ok: true, count: results.length });
  } catch (e) {
    return res.status(500).json({ error: "Weekly fact-check run failed", detail: String(e) });
  }
};
