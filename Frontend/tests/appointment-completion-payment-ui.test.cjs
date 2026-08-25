"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "agenda.html"), "utf8");
const js = fs.readFileSync(path.join(root, "agenda.js"), "utf8");
const css = fs.readFileSync(path.join(root, "styles.css"), "utf8");

test("el modal ofrece radios accesibles cash, transfer y null con desconocido por defecto", () => {
  const inputs = [...html.matchAll(/<input type="radio" name="agendaCompletePaymentMethod" value="([^"]*)"([^>]*)>/g)];
  assert.deepEqual(inputs.map((match) => match[1]), ["cash", "transfer", ""]);
  assert.match(inputs[2][2], /checked/);
  assert.match(html, /<fieldset[\s\S]+<legend>Forma de pago<\/legend>/);
  assert.match(html, /💵[\s\S]+Efectivo[\s\S]+🏦[\s\S]+Transferencia[\s\S]+❔[\s\S]+Método desconocido/);
});

test("el valor final se envía una vez en el PATCH atómico y null no se convierte en string", () => {
  const completion = js.slice(js.indexOf("async function confirmarCompletarCita"), js.indexOf("function crearItemDetalleAgenda"));
  assert.match(completion, /selectedPaymentMethod === "" \? null : selectedPaymentMethod/);
  assert.match(completion, /cambiarEstadoCita\(pendiente\.id, "completada", totalCobrado, paymentMethod\)/);
  assert.equal((completion.match(/cambiarEstadoCita\(/g) || []).length, 1);
  const status = js.slice(js.indexOf("async function cambiarEstadoCita"), js.indexOf("function mostrarErrorCompletarCita"));
  assert.match(status, /body\.paymentMethod = paymentMethod/);
  assert.match(status, /invalidarResumenFinanciero\(\)/);
});

test("la selección es visible, táctil, enfocada y responsive 3 columnas a 2 + 1", () => {
  assert.match(css, /\.agenda-payment-option > span[\s\S]+min-height: 48px/);
  assert.match(css, /input:checked \+ span[\s\S]+border-color: #0b2a6b/);
  assert.match(css, /input:checked \+ span::after[\s\S]+content: "✓"/);
  assert.match(css, /input:focus-visible \+ span/);
  assert.match(css, /grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(css, /@media \(max-width: 480px\)[\s\S]+\.agenda-payment-options[\s\S]+repeat\(2, minmax\(0, 1fr\)\)[\s\S]+\.agenda-payment-option-unknown[\s\S]+grid-column: 1 \/ -1/);
  assert.match(js, /radio && event\.key === "Enter"/);
});

test("aperturas repetidas restauran desconocido y los listeners se registran una sola vez", () => {
  assert.match(js, /unknownPaymentMethod\.checked = true/);
  assert.equal((js.match(/addEventListener\("submit", confirmarCompletarCita\)/g) || []).length, 1);
  assert.equal((js.match(/radio && event\.key === "Enter"/g) || []).length, 1);
});
