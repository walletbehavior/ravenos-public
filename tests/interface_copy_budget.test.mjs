import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const CORE_ROUTE_BUDGETS = new Map([
  ["terminal/index.html", 150],
  // Wallet discovery adds explicit coverage and metric definitions plus unit labels.
  ["account/copy/index.html", 190],
  ["monitor/index.html", 45],
  // Account and pricing now disclose trial, rewards, credits, and affiliate terms.
  ["account/index.html", 135],
  ["index.html", 60],
  ["pricing/index.html", 120],
  ["behavior/index.html", 20],
  ["perps/index.html", 20],
  // Capital helper includes collapsed privacy, ZEC price-risk and preview boundaries.
  ["portfolio/index.html", 160],
  ["discover/index.html", 15],
  ["atlas/index.html", 8],
  ["intelligence/index.html", 5],
]);

function visibleNarrativeWordCount(file) {
  const html = readFileSync(new URL(`../${file}`, import.meta.url), "utf8")
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ");
  const text = [...html.matchAll(/<(?:p|small)\b[^>]*>([\s\S]*?)<\/(?:p|small)>/gi)]
    .map((match) => match[1].replace(/<[^>]+>/g, " "))
    .join(" ")
    .replace(/&(?:[a-z]+|#\d+);/gi, " ");
  return text.match(/[\p{L}\p{N}]+(?:['’.-][\p{L}\p{N}]+)*/gu)?.length || 0;
}

test("core routes stay within the reduced narrative-copy budget", () => {
  let total = 0;
  const failures = [];
  for (const [file, budget] of CORE_ROUTE_BUDGETS) {
    const words = visibleNarrativeWordCount(file);
    total += words;
    if (words > budget) failures.push(`${file}: ${words}/${budget}`);
  }
  assert.deepEqual(failures, [], `Copy budgets exceeded:\n${failures.join("\n")}`);
  assert.ok(total <= 950, `Core narrative total ${total} exceeds the wallet, reserve and financial-disclosure ceiling of 950 words`);
});

test("primary Discover copy does not narrate obvious interactions", () => {
  for (const file of ["discover/index.html", "ravenos-discover.js"]) {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /open (?:the )?chart to/i, file);
    assert.doesNotMatch(source, /first market update recorded/i, file);
    assert.doesNotMatch(source, /waiting for another before naming/i, file);
  }
});

test("compression preserves critical customer boundaries", () => {
  const terminal = readFileSync(new URL("../terminal/index.html", import.meta.url), "utf8");
  const landing = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const walletCopy = readFileSync(new URL("../ravenos-wallet-copy.js", import.meta.url), "utf8");
  assert.match(terminal, /Not financial advice/i);
  assert.match(landing, /Not financial advice/i);
  assert.match(walletCopy, /Source ≠ follower/);
  assert.match(walletCopy, /Unavailable ≠ zero/);
  assert.match(walletCopy, /not collected/i);
});
