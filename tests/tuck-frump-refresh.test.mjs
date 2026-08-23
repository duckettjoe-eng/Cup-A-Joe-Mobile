import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { validateStories } from "../scripts/validate-tuck-frump.mjs";

const currentStories = JSON.parse(
  await readFile(new URL("../data/stories.json", import.meta.url), "utf8"),
);
const refreshRunner = await readFile(
  new URL("../scripts/run-hermes-tuck-frump-refresh.sh", import.meta.url),
  "utf8",
);

test("the current Tuck Frump board satisfies the refresh contract and is fresh", () => {
  const result = validateStories(currentStories, { staleAfterDays: 10 });

  assert.deepEqual(result.errors, []);
  assert.equal(result.storyCount, currentStories.length);
  assert.ok(result.storyCount >= 5);
  assert.equal(result.stale, false);
});

test("duplicate story IDs and outlet URLs are rejected", () => {
  const duplicateStory = structuredClone(currentStories[0]);
  duplicateStory.outlets.push(structuredClone(duplicateStory.outlets[0]));

  const result = validateStories([currentStories[0], duplicateStory]);

  assert.ok(result.errors.some((error) => error.includes("duplicate story id")));
  assert.ok(result.errors.some((error) => error.includes("duplicate outlet URL")));
});

test("a story needs a checkable comparison, synthesis, and HTTPS sources", () => {
  const story = structuredClone(currentStories[0]);
  story.outlets = [
    { name: "One", lean: "center", heat: 2, framing: "A", url: "http://example.com/a" },
    { name: "Two", lean: "center", heat: 2, framing: "B", url: "https://example.com/b" },
  ];
  story.synthesis = [];

  const result = validateStories([story]);

  assert.ok(result.errors.some((error) => error.includes("at least 3 outlets")));
  assert.ok(result.errors.some((error) => error.includes("at least 2 synthesis")));
  assert.ok(result.errors.some((error) => error.includes("must use HTTPS")));
});

test("the refresh runner requires paired provider and model overrides", () => {
  assert.match(refreshRunner, /TUCK_FRUMP_HERMES_PROVIDER/);
  assert.match(refreshRunner, /TUCK_FRUMP_HERMES_MODEL/);
  assert.match(refreshRunner, /Set both TUCK_FRUMP_HERMES_PROVIDER and TUCK_FRUMP_HERMES_MODEL/);
  assert.match(refreshRunner, /--provider \"\$hermes_provider\" --model \"\$hermes_model\"/);
  assert.match(refreshRunner, /Use that exact absolute path as the workdir/);
});
