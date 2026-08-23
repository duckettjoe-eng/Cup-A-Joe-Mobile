import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const page = await readFile(new URL("../index.html", import.meta.url), "utf8");

test("long fact-check ratings wrap inside their result row", () => {
  const ratingRule = page.match(/\.fc-rating\s*\{([^}]*)\}/)?.[1] || "";

  assert.match(ratingRule, /white-space:\s*normal\s*;/);
  assert.match(ratingRule, /overflow-wrap:\s*anywhere\s*;/);
  assert.match(ratingRule, /max-width:\s*100%\s*;/);
});
