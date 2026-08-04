"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const frontend = path.join(__dirname, "..");
const agenda = fs.readFileSync(path.join(frontend, "agenda.js"), "utf8");
const clientes = fs.readFileSync(path.join(frontend, "clientes.js"), "utf8");
const employee = fs.readFileSync(path.join(frontend, "empleados", "portal.js"), "utf8");
const client = fs.readFileSync(path.join(frontend, "cliente", "portal.js"), "utf8");

test("Agenda muestra texto y colores para las tres clasificaciones", () => {
  assert.match(agenda, /green: "Se deja trabajar"/);
  assert.match(agenda, /orange: "Poco inquieto"/);
  assert.match(agenda, /red: "No se deja o es agresivo"/);
  assert.match(agenda, /Comportamiento: \$\{escapeHtml/);
});

test("solo una cita completada renderiza el formulario editable", () => {
  assert.match(agenda, /if \(cita\.estado !== "completada"\) return badge/);
  assert.match(agenda, /Guardar comportamiento/);
  assert.match(agenda, /Guardando…/);
  assert.match(agenda, /Comportamiento actualizado/);
  assert.match(agenda, /No se pudo actualizar/);
});

test("guardado usa petId estable, PATCH único y finally local", () => {
  const start = agenda.indexOf("async function guardarComportamientoMascota");
  const block = agenda.slice(start, agenda.indexOf("function manejarComportamientoDetalle", start));
  assert.equal((block.match(/agendaFetch\(/g) || []).length, 1);
  assert.match(block, /\/admin\/pets\/\$\{encodeURIComponent\(petId\)\}\/behavior/);
  assert.match(block, /JSON\.stringify\(\{ behaviorFlag: selected\.value \}\)/);
  assert.match(block, /finally \{/);
  assert.doesNotMatch(block, /localStorage|sessionStorage/);
});

test("Clientes muestra y permite editar cada mascota persistente", () => {
  assert.match(clientes, /data-form="pet-behavior" data-pet-id=/);
  assert.match(clientes, /Sin clasificación/);
  assert.match(clientes, /Guardar comportamiento/);
  assert.match(clientes, /\/admin\/pets\/\$\{encodeURIComponent\(petId\)\}\/behavior/);
});

test("portal de empleado y portal cliente no renderizan behaviorFlag", () => {
  assert.doesNotMatch(employee, /behaviorFlag|Comportamiento durante el servicio/);
  assert.doesNotMatch(client, /behaviorFlag|Comportamiento durante el servicio/);
});
