# Fidelidad fase 2: registro de implementación

> Actualización 2026-10-01: el informe parcial conservado debajo documenta el punto de interrupción anterior. La Fase 2.1 de edición manual ya fue terminada y validada; el estado final está al final de este archivo.

Fecha: 2026-09-30. No desplegado. Sin cambios de backend, modelos, datos o historial.

## Alcance implementado

- Resaltado completo de fila, detalle y tarjeta de fidelidad cuando el resumen indica premios disponibles.
- Badge textual con regalo y singular/plural, usando cantidades del resumen existente.
- Progreso residual separado de premios pendientes y saldo actual. Ejemplo: saldo 19 = dos premios pendientes + 3/8.
- El render elimina el resaltado y badge al recibir cero premios; conserva el estado si queda uno. La carga/error limpia el estado visual del cliente anterior.
- Etiquetas explícitas: base de citas elegibles, ajustes manuales en unidades, unidades canjeadas manualmente, premios disponibles y canjes manuales registrados.
- Aclaración de que la base no es el histórico total y de que los canjes manuales no incluyen los de Agenda.
- Barra accesible y foco visible; estilos que permiten envolver el badge.
- Cache busting de clientes.js/clientes.css y pruebas permanentes de presentación.

La forma antigua de registrar un consumo permanece sin cambios. No se ha activado el nuevo modal ni una nueva ruta de consumo. Estos cambios visuales NO corrigen los riesgos existentes del endpoint antiguo.

## Por qué se detuvo la parte de consumo (puntos 23 y 40 de la solicitud)

El consumo manual agrega movimientos en CustomerProfile. El consumo de Agenda cambia varias Appointment, ignora premiosManual/ajustesFidelidad y guarda la cita gratuita después de modificar las fuentes.

Una escritura atómica de canje y ajuste en CustomerProfile sólo resolvería la atomicidad dentro de ese perfil. No impediría que Agenda seleccionara las mismas fuentes en paralelo. Una clave de idempotencia en Clientes sólo deduplicaría esa solicitud, no relacionaría el canje con el mismo beneficio consumido desde Agenda.

Además, el formulario manual no identifica qué cita/mascota recibió el servicio gratis. Con más de un premio pendiente, un canje automático anterior no permite distinguir por sí solo si un nuevo canje manual representa el mismo beneficio o uno distinto. No es seguro deducirlo por fecha, nombre o proximidad temporal.

Se requiere coordinar ambos caminos antes de habilitar un nuevo canje. No se eliminaron mecanismos, se bloquearon operaciones existentes ni se reinterpretaron movimientos históricos.

## Fórmula propuesta, NO activada

Para saldo entero S >= 8 y elección entera P entre 0 y 7:

```
premiosPendientesDespues = floor(S / 8) - 1
saldoNatural = S - 8
progresoNatural = S % 8
ajuste = P - progresoNatural
saldoFinal = 8 * premiosPendientesDespues + P
```

El canje siempre registra ocho unidades. Sólo si ajuste != 0 se añade un movimiento de ajuste separado. Ambos se confirmarían atómicamente. Esta fórmula preserva todos los premios adicionales.

| Antes | Elección | Canje | Ajuste | Saldo final | Premios pendientes |
|---:|---:|---:|---:|---:|---:|
| 8 | 0 | 8 | 0 | 0 | 0 |
| 11 | 3 | 8 | 0 | 3 | 0 |
| 10 | 3 | 8 | +1 | 3 | 0 |
| 12 | 2 | 8 | -2 | 2 | 0 |
| 16 | 0 | 8 | 0 | 8 | 1 |
| 24 | 0 | 8 | 0 | 16 | 2 |
| 24 | 3 | 8 | +3 | 19 | 2 |

Cuatro perros, uno gratis y tres pagados: elección P=3. Si S=11, ajuste cero; si S=12 porque el conteo incluye cuatro unidades, ajuste -1. No se alterarían las citas para producir el resultado. Esto no detecta automáticamente al perro gratuito.

## Coordinación necesaria antes de continuar

1. Identidad canónica del cliente compartida por Clientes y Agenda, con manejo explícito de perfiles/cuentas/teléfonos conflictivos.
2. Identificador de beneficio/canje compartido, y vínculo opcional pero verificable con la cita/mascota beneficiaria. No inferir asociaciones históricas.
3. Un servicio de consumo utilizado por ambos caminos: saldo, validación >=8, claves de idempotencia y conflicto de payload, y protección contra solicitudes con claves diferentes sobre el mismo premio.
4. Coordinación atómica por cliente/tipo (transacción y documento común versionado, o equivalente) que incluya la asignación de fuentes y el registro final. Un snapshot sin un punto de escritura común no basta para evitar carreras entre documentos distintos.
5. Coordinar asimismo cambios que afectan el saldo: ajustes, estados de citas y vinculaciones. Definir conflictos de revisión para un modal abierto mientras cambia el saldo.
6. Historial nuevo con tipo, ocho unidades, fecha, actor, motivo automático más nota opcional, saldo antes/después, progreso elegido e identificador de canje. Campos opcionales sin reescribir documentos antiguos.
7. Canje y ajuste asociados confirmados juntos; fallo previo al commit sin cambios parciales; reintento con la misma clave devuelve el mismo resultado.
8. Compatibilidad explícita con canjes de Agenda existentes; no marcar fuentes históricas desde el nuevo flujo para simular sincronización.

Se puede conservar el historial existente. La modificación necesaria supera la sustitución de un formulario: afecta los dos consumos, sus identidades y las escrituras concurrentes de saldo. No fue implementada en esta fase parcial.

## Estado de requisitos pendientes

- Nuevo modal, elección 0–7, resumen y confirmación: pendiente.
- Nuevo canje/ajuste, validaciones backend, idempotencia, concurrencia y atomicidad: pendientes.
- Interacción segura con rewardGratisAplicado: pendiente. Se mantiene la exclusión actual de citas correctamente marcadas gratis, sin cambios de backend.
- Pruebas de canje, reintentos, conflicto de clave, carreras y rollback: pendientes porque no hay nueva implementación activa que verificar.
- La accesibilidad de un nuevo modal no se da por verificada. Se conserva el modal de detalle existente.

## Verificación

- Backend completo: 166/166 pruebas aprobadas; MongoMemoryServer local para las integraciones y URI de entorno sustituida por localhost inaccesible.
- Frontend completo: 177/177 pruebas aprobadas, incluidas diez pruebas nuevas de presentación.
- Cobertura nueva: saldos 3/8/10/16/24/27, singular/plural, retiro o conservación de premios al renderizar datos nuevos, etiquetas históricas, escaping, progreso ARIA y contrato CSS móvil.
- La prueba de render no simula ni afirma ejecutar un canje real.
- Verificación responsive adicional: script local tmp/check-loyalty-presentation.cjs con HTML/CSS reales, clientes sintéticos y todas las solicitudes de red interceptadas. Listado y detalle sin desbordamiento horizontal en 320, 375, 430, 768, 1024 y 1440 px. Se corrigió el salto de línea de las celdas a 1024 px. Inspección visual de capturas a 320 y 1440 px.
- Verificación en navegador del refresco sintético: al recibir cero premios desaparecen las clases de resaltado y badges del listado/detalle.
- git diff --check: sin errores. Git sólo advierte la conversión configurada de LF a CRLF.

## Archivos de esta entrega

- Frontend/clientes.js: render y etiquetas; no cambia solicitudes de consumo.
- Frontend/clientes.css: resaltado, badge, foco y salto de línea.
- Frontend/clientes.html: versiones de los assets.
- Frontend/tests/clientes-admin.test.cjs: versiones esperadas.
- Frontend/tests/customer-loyalty-presentation.test.cjs: diez pruebas nuevas.
- docs/fidelidad-fase-2-estado.md: este informe.
- tmp/check-loyalty-presentation.cjs y capturas tmp/loyalty-presentation-{320,1440}.png: verificación local, dentro del directorio temporal ignorado por Git.

No se consultó Atlas ni a Rosa. No se hizo commit ni push. El endpoint antiguo conserva los riesgos identificados en la auditoría y requiere revisión antes de activar el nuevo flujo.

FIDELIDAD FASE 2 REQUIERE REVISIÓN ANTES DE CONTINUAR.

---

## Cierre de Fase 2.1 — edición manual de progreso

Ruta final: `POST /admin/customers/:id/loyalty-progress`, protegida con `auth`, `requireAdmin` y `adminWriteLimiter`.

Payload: `tipo` (`mascota` o `auto`), `progresoDeseado` (entero 0–7), `motivo` (opcional, máximo 300) e `idempotencyKey` (16–100 caracteres seguros). La UI inicia el motivo con `Corrección manual de progreso`.

Para saldo `S`: `premiosPendientes = floor(S / 8)`, `progresoAnterior = S % 8`, `diferencia = progresoDeseado - progresoAnterior` y `saldoDespues = S + diferencia`. Así se conserva la cantidad completa de premios y sólo cambia el residuo.

Cada cambio real añade un ajuste con tipo, progreso anterior/nuevo, diferencia, saldos, premios pendientes, fecha, administrador, motivo y clave. El no-op guarda sólo el recibo idempotente y no crea ajuste 0. No se reemplazan arrays ni se migran documentos antiguos.

La clave se guarda en `sessionStorage` antes del request. Timeout/reintento conserva comando y clave; éxito confirmado los elimina; una nueva edición genera otra clave. En backend, recibo y ajuste se confirman juntos en una transacción. Replay idéntico devuelve el resultado original; payload distinto con la misma clave responde 409. Las carreras con claves distintas reintentan contra el último saldo confirmado.

La solución requiere MongoDB con transacciones (replica set o clúster). No existe fallback no transaccional. Las pruebas usan `MongoMemoryReplSet` real con WiredTiger.

La edición no elimina ni modifica Appointment, `premiosManual`, ajustes previos ni flags de Agenda (`rewardGratisAplicado`, `rewardUnidadesConsumidas`, `rewardConsumido`, `rewardGrupoId`, `rewardSourceIds`). `Marcar premio usado` y `Registrar ajuste` permanecen. No se implementó el nuevo `Usar premio`.

CORS mantiene allowlist exacta para `Content-Type`, `Authorization` e `Idempotency-Key`; el preflight autorizado devuelve 204 sin wildcard. Los textos dinámicos se escapan. El diálogo usa labels, ayuda descrita, `aria-live`, `aria-busy`, Escape, foco restaurado, controles táctiles y ancho fluido.

Verificación final:

- Backend dirigido: 29/29.
- Backend completo: 195/195.
- Frontend dirigido: 41/41.
- Frontend completo: 181/181.
- Casos: 5→3, 2→4, 19→5, 16→3, 8→4, 0, 7, Mascotas/Autos independientes, validación inválida, no-op, motivo, historia intacta, replay, conflicto, doble envío, concurrencia real, rollback, autorización y CORS.
- Visual Fase 2 previamente validado en 320, 375, 430, 768, 1024 y 1440. En este cierre el navegador automatizado bloqueó el esquema local `file:`; se revalidaron contratos CSS/render y se conservó la evidencia previa.
- `node --check` y `git diff --check`: sin errores al cierre.

Riesgo pendiente antes de `Usar premio`: coordinar Clientes y Agenda con identidad canónica del cliente, identificador compartido del beneficio y un único consumo atómico entre CustomerProfile y Appointment; no inferir vínculos históricos.

Siguiente fase: **Avisar por WhatsApp cuando haya premio disponible**. Avisar no consumirá el premio.

FASE 2.1 DE FIDELIDAD COMPLETADA Y LISTA PARA AUDITORÍA.

---

## Cierre de Fase 2.2 — aviso de premio por WhatsApp

Cada tarjeta de Mascotas o Autos con uno o más premios muestra `💬 Avisar por WhatsApp`. La acción genera un mensaje singular o plural específico del tipo, normaliza el teléfono con el mismo contrato administrativo y abre `https://wa.me/<telefono>?text=<mensaje>` con una sola codificación y `noopener,noreferrer`.

La fuente visible del teléfono continúa siendo la resuelta por el backend desde CustomerProfile, cuenta vinculada o citas. El frontend admite diez dígitos mexicanos, `52…`, el formato histórico `521…`, `00…` y números NANP de once dígitos. Si no hay número válido muestra feedback accesible y no abre un enlace.

Esta fase es navegación frontend pura: no llama endpoints de canje, progreso o ajustes; no modifica estado, sessionStorage, CustomerProfile ni Appointment. Tampoco registra que el mensaje fue enviado, porque abrir WhatsApp no garantiza su envío.

Verificación Fase 2.2:

- Pruebas dirigidas: 47/47 (incluyen 10 pruebas nuevas de WhatsApp).
- Frontend completo: 191/191.
- Backend acumulado: 195/195.
- Contrato responsive: acciones con wrap y apilado al 100% bajo 720 px, targets de 44 px y cache-busting actualizado.
- `git diff --check` y `node --check`: sin errores.

FASE 2.2 WHATSAPP IMPLEMENTADA Y LISTA PARA AUDITORÍA.
