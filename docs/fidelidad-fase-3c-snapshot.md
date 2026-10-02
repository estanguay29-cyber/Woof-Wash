# Fase 3C — contrato del snapshot histórico

Esta fase sólo incorpora una operación interna explícita, `initializeFromLegacy`. No existe endpoint, UI, migración masiva ni inicialización por lectura.

## Fuente y cálculo

La pantalla legacy y el snapshot comparten `Backend/services/legacyLoyaltyProjection.js`.

Por `CustomerProfile._id + tipo`:

```text
rawBalance = unidades disponibles de citas completadas
           + ajustesFidelidad.unidades
           - premiosManual.unidadesConsumidas

rewardsAvailable = floor(rawBalance / 8)
progressUnits     = rawBalance % 8
```

Las citas gratis, pendientes, canceladas y `no_asistio` no acreditan. Los campos `rewardConsumido` y `rewardUnidadesConsumidas` reducen las unidades con la misma semántica legacy. Un `rawBalance` negativo no se normaliza: bloquea la apertura.

## Fingerprint versión 1

SHA-256 del JSON canónico con claves ordenadas de:

- versión de proyección, `CustomerProfile._id`, tipo y objetivo 8;
- cada cita completada elegible del tipo: `_id`, tipo derivado, unidades totales, consumidas y disponibles;
- cada ajuste del tipo: `_id` y unidades;
- cada consumo manual del tipo: `_id` y `unidadesConsumidas`.

Las colecciones se ordenan antes de serializar. El orden accidental, motivos, nombres y demás campos sin efecto matemático no cambian el fingerprint. El fingerprint es evidencia del estado fuente; no reemplaza la identidad canónica ni la clave idempotente.

## Frontera y carrera

La lectura legacy y la escritura de Account, Rewards, opening transaction y Command ocurren en una transacción MongoDB con `readConcern: snapshot` y mayoría. `cutoverAt` se guarda junto con esa apertura.

`openingSnapshot.includedAppointmentIds` registra las citas que sí aportaron unidades. `pendingAppointmentIds` registra citas abiertas observadas en la fotografía. Si una cita se completa después de la lectura snapshot, no entra en el opening y su ID permanece fuera de `includedAppointmentIds`; la fase que procese eventos post-cutover deberá usar esa membresía explícita, no sólo comparar timestamps, para evitar huecos o doble crédito.

Crear snapshots reales antes del rollout dejaría cuentas nuevas que todavía no consumen Clientes, Agenda, Portal, Recordatorios ni WhatsApp. Por eso 3C se limita a pruebas sintéticas.
