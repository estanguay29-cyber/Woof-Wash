"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const css = fs.readFileSync(path.join(root, "styles.css"), "utf8");

test("la van usa cuatro capas estables con una imagen interna por fotografía", () => {
  const carousel = html.match(/<div class="service-van-carousel[\s\S]+?<\/div>\s*<\/div>/)?.[0] || "";
  assert.equal((carousel.match(/class="service-van-slide"/g) || []).length, 4);
  for (const file of ["Vanfrente-web.png", "Vantrasera.png", "Vanlado1-web.png", "Vanlado2.png"]) {
    assert.match(carousel, new RegExp(`src="img/${file.replace(".", "\\.")}"`));
  }
});

test("cada imagen cabe dentro del wrapper sin cover, escala ni deformación", () => {
  const rule = css.match(/\.service-van-slide img\s*\{[^}]+\}/)?.[0] || "";
  for (const declaration of [
    /inset:\s*8px/, /width:\s*calc\(100% - 16px\)/, /height:\s*calc\(100% - 16px\)/,
    /max-width:\s*100%/, /max-height:\s*100%/, /object-fit:\s*contain/,
    /object-position:\s*center/, /transform:\s*none/
  ]) assert.match(rule, declaration);
  assert.doesNotMatch(rule, /object-fit:\s*cover|scale\(|zoom:/);
});

test("la rotación conserva duración, delays y keyframes existentes", () => {
  assert.match(css, /\.service-van-slide\s*\{[\s\S]*animation:\s*serviceVanCarouselFade 14s infinite/);
  for (const [position, delay] of [[1, "0s"], [2, "-10.5s"], [3, "-7s"], [4, "-3.5s"]]) {
    assert.match(css, new RegExp(`service-van-slide:nth-child\\(${position}\\)\\s*\\{[^}]*animation-delay:\\s*${delay.replace(".", "\\.")}`));
  }
  assert.match(css, /@keyframes serviceVanCarouselFade/);
});
