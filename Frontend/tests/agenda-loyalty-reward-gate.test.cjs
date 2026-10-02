"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const html = fs.readFileSync(path.join(__dirname, "..", "agenda.html"), "utf8");
const server = fs.readFileSync(path.join(__dirname, "..", "..", "Backend", "server.js"), "utf8");
test("Agenda no presenta controles para iniciar un canje legacy", () => {
  assert.doesNotMatch(html, /id=["']rewardGratisAplicado["']/);
  assert.doesNotMatch(html, /id=["']btnUsarServicioGratis["']/);
  assert.doesNotMatch(html, /id=["']editRewardGratisAplicado["']/);
});
test("backend conserva un rechazo explícito para nuevos canjes de Agenda", () => {
  const matches = server.match(/Los nuevos canjes se realizan únicamente desde Clientes\./g) || [];
  assert.ok(matches.length >= 2);
});
