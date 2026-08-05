"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const frontend = path.join(__dirname, "..");
const agendaCss = fs.readFileSync(path.join(frontend, "styles.css"), "utf8");
const calendarCss = fs.readFileSync(path.join(frontend, "shared", "appointments-calendar.css"), "utf8");
const employeeCss = fs.readFileSync(path.join(frontend, "empleados", "dashboard.css"), "utf8");
const portalHtml = fs.readFileSync(path.join(frontend, "empleados", "portal.html"), "utf8");
const calendarSource = fs.readFileSync(path.join(frontend, "shared", "appointments-calendar.js"), "utf8");
const calendarContext = { module: { exports: {} }, exports: {}, console, URL };
vm.runInNewContext(calendarSource, calendarContext);
const calendar = calendarContext.module.exports;

test("Agenda usa ámbar, azul, verde y rojo sin ocultar badges", () => {
  assert.match(agendaCss, /agenda-appointment-card\.is-pendiente::before[\s\S]*?background: #d97706/);
  assert.match(agendaCss, /agenda-appointment-card\.is-confirmada[\s\S]*?rgba\(37, 99, 235/);
  assert.match(agendaCss, /agenda-appointment-card\.is-completada[\s\S]*?rgba\(92, 148, 36/);
  assert.match(agendaCss, /agenda-appointment-card\.is-cancelada[\s\S]*?rgba\(220, 38, 38/);
  assert.match(agendaCss, /agenda-status-badge:is\(\.is-pendiente[\s\S]*?#fef3c7; color: #92400e/);
});

test("calendario normaliza variantes visuales, mayúsculas y espacios", () => {
  assert.equal(calendar.statusClass(" Pendiente "), "ww-calendar-status-pendiente");
  assert.equal(calendar.statusClass("CONFIRMADO"), "ww-calendar-status-confirmada");
  assert.equal(calendar.statusClass(" completado "), "ww-calendar-status-completada");
  assert.equal(calendar.statusClass("CANCELADO"), "ww-calendar-status-cancelada");
  assert.equal(calendar.statusClass("en_proceso"), "ww-calendar-status-en-proceso");
  assert.equal(calendar.statusClass("finalizada"), "ww-calendar-status-finalizada");
  assert.match(calendarCss, /ww-calendar-status-pendiente[^}]*#d97706/);
  assert.match(calendarCss, /ww-calendar-status-confirmada[\s\S]*?#2563eb/);
  assert.match(calendarCss, /ww-calendar-status-completada[\s\S]*?#5c9424/);
  assert.match(calendarCss, /ww-calendar-status-cancelada[\s\S]*?#dc2626/);
});

test("dashboard y portal comparten acento, badge, hover y foco por estado", () => {
  assert.match(employeeCss, /appointment-card\.is-pendiente[\s\S]*?#d97706/);
  assert.match(employeeCss, /is-confirmada,.is-confirmado[\s\S]*?#2563eb/);
  assert.match(employeeCss, /is-completada,.is-completado[\s\S]*?#5c9424/);
  assert.match(employeeCss, /is-cancelada,.is-cancelado[\s\S]*?#dc2626/);
  assert.match(employeeCss, /appointment-card:focus-within/);
  assert.match(employeeCss, /prefers-reduced-motion:reduce/);
  assert.match(portalHtml, /href="dashboard\.css"/);
});

test("los estilos no cambian selectores funcionales ni requieren hover en móvil", () => {
  assert.match(agendaCss, /agenda-appointment-card:focus-within/);
  assert.match(agendaCss, /prefers-reduced-motion: reduce/);
  assert.match(calendarCss, /fc-event\.ww-calendar-event:focus-visible/);
});
