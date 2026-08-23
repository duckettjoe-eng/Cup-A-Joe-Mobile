#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const REQUIRED_STORY_TEXT = ["id", "date", "title", "summary"];
const REQUIRED_OUTLET_TEXT = ["name", "lean", "framing", "url"];
const ALLOWED_LEANS = new Set(["left", "leanleft", "center", "leanright", "right"]);

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isoDate(value) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString().slice(0, 10) : null;
}

export function validateStories(stories, options = {}) {
  const errors = [];
  const now = options.now instanceof Date ? options.now : new Date();
  const staleAfterDays = Number.isFinite(options.staleAfterDays)
    ? options.staleAfterDays
    : 10;

  if (!Array.isArray(stories)) {
    return {
      errors: ["data/stories.json must contain a top-level array"],
      storyCount: 0,
      latestStoryDate: null,
      stale: true,
    };
  }

  const storyIds = new Set();
  const parsedDates = [];

  for (const [storyIndex, story] of stories.entries()) {
    const label = `story ${storyIndex + 1}`;
    if (!story || typeof story !== "object" || Array.isArray(story)) {
      errors.push(`${label} must be an object`);
      continue;
    }

    for (const field of REQUIRED_STORY_TEXT) {
      if (!nonEmptyString(story[field])) errors.push(`${label}.${field} must be non-empty text`);
    }

    if (nonEmptyString(story.id)) {
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(story.id)) {
        errors.push(`${label}.id must be a lowercase slug`);
      }
      if (storyIds.has(story.id)) errors.push(`${label} has duplicate story id "${story.id}"`);
      storyIds.add(story.id);
    }

    const parsedDate = isoDate(story.date);
    if (!parsedDate) errors.push(`${label}.date must be a valid date`);
    else parsedDates.push(parsedDate);

    if (!Array.isArray(story.outlets) || story.outlets.length < 3) {
      errors.push(`${label} must include at least 3 outlets`);
    }

    const outletUrls = new Set();
    for (const [outletIndex, outlet] of (story.outlets || []).entries()) {
      const outletLabel = `${label}.outlets[${outletIndex}]`;
      for (const field of REQUIRED_OUTLET_TEXT) {
        if (!nonEmptyString(outlet?.[field])) errors.push(`${outletLabel}.${field} must be non-empty text`);
      }
      if (nonEmptyString(outlet?.lean) && !ALLOWED_LEANS.has(outlet.lean)) {
        errors.push(`${outletLabel}.lean is not supported`);
      }
      if (!Number.isInteger(outlet?.heat) || outlet.heat < 1 || outlet.heat > 3) {
        errors.push(`${outletLabel}.heat must be 1, 2, or 3`);
      }
      if (nonEmptyString(outlet?.url)) {
        if (!outlet.url.startsWith("https://")) errors.push(`${outletLabel}.url must use HTTPS`);
        if (outletUrls.has(outlet.url)) errors.push(`${label} has duplicate outlet URL "${outlet.url}"`);
        outletUrls.add(outlet.url);
      }
    }

    if (!Array.isArray(story.synthesis) || story.synthesis.length < 2) {
      errors.push(`${label} must include at least 2 synthesis entries`);
    }
    for (const [entryIndex, entry] of (story.synthesis || []).entries()) {
      if (!nonEmptyString(entry?.label) || !nonEmptyString(entry?.text)) {
        errors.push(`${label}.synthesis[${entryIndex}] needs non-empty label and text`);
      }
    }
  }

  const latestStoryDate = parsedDates.sort().at(-1) || null;
  const latestMs = latestStoryDate ? Date.parse(`${latestStoryDate}T00:00:00Z`) : NaN;
  const ageDays = Number.isFinite(latestMs)
    ? Math.floor((now.getTime() - latestMs) / 86_400_000)
    : null;

  return {
    errors,
    storyCount: stories.length,
    latestStoryDate,
    stale: ageDays === null || ageDays > staleAfterDays,
  };
}

async function main() {
  const inputPath = process.argv[2] || "data/stories.json";
  const stories = JSON.parse(await readFile(inputPath, "utf8"));
  const result = validateStories(stories);

  if (result.errors.length) {
    for (const error of result.errors) console.error(`ERROR: ${error}`);
    process.exitCode = 1;
    return;
  }

  const freshness = result.stale ? "STALE" : "CURRENT";
  console.log(
    `Tuck Frump board valid: ${result.storyCount} stories; latest ${result.latestStoryDate}; ${freshness}`,
  );
  if (result.stale) process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
