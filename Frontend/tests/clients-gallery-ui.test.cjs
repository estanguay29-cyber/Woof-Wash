const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const frontendRoot = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(frontendRoot, "index.html"), "utf8");
const css = fs.readFileSync(path.join(frontendRoot, "styles.css"), "utf8");
const script = fs.readFileSync(path.join(frontendRoot, "script.js"), "utf8");

test("replaces Porsche and Mazda with the real Ford Territory and MG RX8 assets", () => {
  assert.doesNotMatch(html, /data-name="Porsche 911"/);
  assert.doesNotMatch(html, /data-name="Mazda"/);
  assert.match(html, /data-name="Ford Territory"[\s\S]*?data-src="img\/Fordterritory\.png"/);
  assert.match(html, /data-name="MG RX8"[\s\S]*?data-src="img\/Mgrx8\.png"/);
  assert.ok(fs.existsSync(path.join(frontendRoot, "img", "Fordterritory.png")));
  assert.ok(fs.existsSync(path.join(frontendRoot, "img", "Mgrx8.png")));
});

test("keeps nine unique rotating clients and exposes six desktop cells", () => {
  const sources = [...html.matchAll(/<article class="ww-clients-item"[\s\S]*?data-src="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(sources.length, 9);
  assert.equal(new Set(sources).size, 9);
  assert.match(css, /\.ww-clients-item:nth-child\(n \+ 7\) \{ display: none; \}/);
  assert.match(script, /const cellOrder = \[2, 0, 4, 1, 3, 5\];/);
  assert.match(script, /active\.has\(candidateIndex\)/);
});

test("preserves flip, keyboard, touch, rotation and reduced-motion behavior", () => {
  assert.match(script, /setFlipped\(cell, !cell\.classList\.contains\("is-flipped"\)\)/);
  assert.match(script, /event\.key !== "Enter" && event\.key !== " "/);
  assert.match(script, /collage\.addEventListener\("click"/);
  assert.match(script, /scheduleNextChange/);
  assert.match(script, /reducedMotion\.matches/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
});

test("uses a photo-led crop without distorting client images", () => {
  assert.match(css, /\.ww-clients-media img \{[^}]*width: 100%;[^}]*height: 100%;[^}]*object-fit: cover;[^}]*object-position: center 42%;/s);
  assert.doesNotMatch(css, /\.ww-clients-media img \{[^}]*padding:/s);
});
