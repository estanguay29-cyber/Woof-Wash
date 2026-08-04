"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

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
  assert.match(agenda, /citaEstaCompletadaParaComportamiento/);
  assert.match(agenda, /"completada", "completado", "finalizada", "finalizado"/);
  assert.match(agenda, /Guardar comportamiento/);
  assert.match(agenda, /Guardando…/);
  assert.match(agenda, /Comportamiento actualizado/);
  assert.match(agenda, /No se pudo actualizar/);
});

test("guardado usa petId o serviceRef estable y finally local", () => {
  const start = agenda.indexOf("async function guardarComportamientoMascota");
  const block = agenda.slice(start, agenda.indexOf("function manejarComportamientoDetalle", start));
  assert.equal((block.match(/agendaFetch\(/g) || []).length, 2);
  assert.match(block, /\/admin\/pets\/\$\{encodeURIComponent\(petId\)\}\/behavior/);
  assert.match(block, /JSON\.stringify\(\{ behaviorFlag: selected\.value \}\)/);
  assert.match(block, /link-pet-behavior/);
  assert.match(block, /serviceRef/);
  assert.match(block, /finally \{/);
  assert.doesNotMatch(block, /localStorage|sessionStorage/);
});

test("Ver más muestra comportamiento para vinculadas, no vinculadas y modo lectura", () => {
  const start = agenda.indexOf("function crearInsigniaComportamiento");
  const end = agenda.indexOf("function mostrarCandidatosComportamiento", start);
  const source = agenda.slice(start, end);
  const context = {
    AGENDA_BEHAVIOR_LABELS: { green: "Se deja trabajar", orange: "Poco inquieto", red: "No se deja o es agresivo" },
    escapeHtml: (value) => String(value ?? ""),
    formatearEdadMascota: (value) => Number.isInteger(value) ? `${value} años` : ""
  };
  vm.runInNewContext(`${source}; this.render = crearControlComportamientoMascota;`, context);
  const linked = context.render({ tipo: "mascota", clientItemId: "pet-1", serviceRef: "0.hash", behaviorFlag: "green" }, { id: "a", estado: "COMPLETADO" }, 0);
  const unlinked = context.render({ tipo: "mascota", mascotaNombre: "Kayse", raza: "Husky", mascotaEdad: 9, serviceRef: "0.hash" }, { id: "a", estadoOperativo: "finalizada" }, 0);
  const readonly = context.render({ tipo: "mascota", behaviorFlag: "orange" }, { estado: "confirmada" }, 0);
  const vehicle = context.render({ tipo: "auto" }, { estado: "completada" }, 0);
  assert.match(linked, /Guardar comportamiento/);
  assert.match(unlinked, /todavía no está vinculada/);
  assert.match(unlinked, /Vincular y guardar comportamiento/);
  assert.match(unlinked, /Confirmo que deseo crear/);
  assert.match(readonly, /Solo puede modificarse desde una cita completada/);
  assert.doesNotMatch(readonly, /type="submit"/);
  assert.equal(vehicle, "");
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
