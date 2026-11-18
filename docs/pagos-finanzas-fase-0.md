# Pagos y finanzas — Fase 0

Estado: contrato de diseño y caracterización. Este documento no activa modelos, rutas ni comportamiento nuevo.

## Decisiones cerradas

- `totalCobrado` conserva el valor completo del servicio.
- Las metas y desempeño miden valor de servicios realizados.
- El fondo fijo es `200000` centavos, una vez por resumen.
- Todos los gastos registrados son salidas de efectivo.
- Nuevas liquidaciones: efectivo, transferencia, mixto o exclusivamente Gift Card.
- `mixed` es una clasificación, no un acumulado.
- `gift_card` identifica un servicio pagado completamente con una Gift Card: cuenta como valor de servicio y genera cero dinero nuevo.
- Máximo una Gift Card por cita.
- La venta de Gift Card recibe efectivo o transferencia; el canje no recibe dinero nuevo.
- Vigencia: tres meses calendario desde activación, hasta el final del día en `America/Mexico_City`.
- Gift Card y recompensa gratuita no pueden coexistir en la misma cita.
- Históricos sin método permanecen sin clasificar y no se reescriben.

## Contratos de colecciones propuestos

Todos los importes nuevos son enteros seguros en centavos.

### AppointmentPaymentSettlement

```text
appointmentId: ObjectId
revision: integer >= 1
serviceValueCents: safe integer >= 0
classification: cash | transfer | mixed | gift_card
status: active | superseded | reversed
financialEntryIds: ObjectId[]
giftCardMovementIds: ObjectId[] (máximo 1 canje activo en primera versión)
operationId: string único
createdBy, createdAt
supersededBySettlementId, reversedAt, reversedBy, reversalReason
```

Índices: `(appointmentId, revision)` único, `operationId` único y un único settlement `active` por cita mediante índice parcial.

### FinancialEntry

```text
kind: service_cash_receipt | service_transfer_receipt |
      gift_card_sale_cash_receipt | gift_card_sale_transfer_receipt |
      receipt_reversal
direction: credit | debit
amountCents: safe integer > 0
effectiveDate: YYYY-MM-DD
appointmentId, settlementId, giftCardId
operationId, actorUserId, reversesEntryId, reason, createdAt
```

Libro append-only. Índice único parcial en `reversesEntryId` evita reversos repetidos.

### GiftCard

```text
type: amount | package
status: draft | pending_payment | active | exhausted | expired | cancelled
codeHash único; codePrefix y codeLast4 no secretos
buyer, recipient
customerProfileId, clientUserId, petId opcionales
initialAmountCents, balanceCents
packageSnapshot para tipo package
paymentMethod: cash | transfer | null
paymentAmountCents, paymentDate
purchaseDate, activatedAt, expiresAt
message, internalNotes
version, createdBy, activatedBy, cancelledBy, timestamps
```

`balanceCents` es una proyección bloqueable; debe conciliar con movimientos.

### GiftCardMovement

```text
giftCardId
kind: activation | redemption | redemption_reversal | cancellation |
      expiration | authorized_adjustment
amountCents, balanceBeforeCents, balanceAfterCents
appointmentId, settlementId
operationId, actorUserId, reversesMovementId, reason, createdAt
```

Append-only. El saldo vencido se conserva y se informa separado del saldo canjeable.

### FinancialCommand

```text
actorUserId, idempotencyKey
commandType
fingerprint SHA-256
status: processing | completed
resultRefs
createdAt
```

Índice único `(actorUserId, idempotencyKey)`. Misma clave y huella reproduce el resultado; misma clave con payload distinto devuelve conflicto.

## Contratos HTTP propuestos

No sustituyen todavía los endpoints actuales.

### Completar cita

`POST /admin/appointments/:id/complete`, con `Idempotency-Key`.

```json
{
  "serviceValueCents": 100000,
  "allocations": {
    "cashCents": 20000,
    "transferCents": 30000,
    "giftCard": {
      "giftCardId": "object-id",
      "expectedVersion": 2,
      "amountCents": 50000
    }
  }
}
```

La clasificación se deriva en Backend. Debe cumplirse que la suma sea exactamente `serviceValueCents`; dos o tres componentes positivos producen `mixed`, mientras que únicamente Gift Card produce `gift_card`.

### Activar tarjeta

`POST /admin/gift-cards/:id/activate`, con `Idempotency-Key`.

```json
{
  "paymentMethod": "cash",
  "paymentAmountCents": 80000,
  "paymentDate": "2026-10-05",
  "expectedVersion": 0
}
```

En primera versión el dinero recibido debe igualar el valor emitido.

### Consultar tarjeta

`POST /admin/gift-cards/lookup` con el código en el cuerpo, nunca en la URL. La respuesta omite hash y datos personales innecesarios.

### Revertir

- `POST /admin/appointment-settlements/:id/reverse`
- `POST /admin/gift-card-movements/:id/reverse`

Ambos exigen idempotencia, confirmación administrativa y motivo. Nunca eliminan el movimiento original.

### Resumen financiero v2

`GET /admin/finance/summary-v2?from=YYYY-MM-DD&to=YYYY-MM-DD`.

El contrato usa propiedades con sufijo `Cents`: valor de servicios, efectivo/transferencias de servicios, ventas de tarjetas por método, tarjetas aplicadas, dinero nuevo, gastos, fondo, efectivo esperado y pasivo de tarjetas. Incluye `schemaVersion: 2` y banderas de conciliación.

## Adaptador histórico

Una cita sin settlement usa `totalCobrado` y `paymentMethod` actuales:

- `cash`: todo el valor es efectivo.
- `transfer`: todo el valor es transferencia.
- `null` o no reconocido: valor sin clasificar.
- importe ausente/inválido: cita completada sin monto válido.

Una cita con settlement nunca entra por la ruta histórica. La existencia del settlement, no solo una fecha de corte, evita doble conteo.

## Conciliaciones

### Valor de servicios en un periodo de servicio

```text
serviceValueCents =
  serviceCashCents
  + serviceTransferCents
  + giftCardAppliedCents
  + legacyUnclassifiedCents
```

### Dinero nuevo en un periodo de cobro

```text
newMoneyReceivedCents =
  serviceCashCents
  + serviceTransferCents
  + giftCardSaleCashCents
  + giftCardSaleTransferCents
```

### Efectivo esperado

```text
expectedCashCents =
  200000
  + serviceCashCents
  + giftCardSaleCashCents
  - expenseCents
```

### Saldo a una fecha de corte

```text
closingGiftCardBalanceCents =
  openingGiftCardBalanceCents
  + activationsCents
  - redemptionsCents
  + redemptionReversalsCents
  +/- authorizedAdjustmentsCents
```

La primera y segunda fórmulas no se deben comparar directamente si el servicio y el cobro pertenecen a periodos distintos. El valor del servicio se agrupa por fecha del servicio; el flujo de dinero se agrupa por `FinancialEntry.effectiveDate`.

## Transacciones futuras

Completar una cita con Gift Card debe crear/actualizar en una sola transacción: comando idempotente, saldo de tarjeta, movimiento, entradas de efectivo/transferencia, settlement y estado/`totalCobrado` de la cita. La actualización del saldo exige estado activo, vigencia, versión esperada y saldo suficiente.

Activar una tarjeta debe guardar en una sola transacción: comando, movimiento de activación, entrada de efectivo/transferencia y estado/saldo de tarjeta.

## Contratos estructurales de Fase 3A

Estos contratos preparan Fase 3B, pero todavía no ejecutan operaciones ni protegen rutas productivas.

### Entrega de códigos

`GiftCardDeliveryOutbox` conserva un envelope AES-256-GCM creado por un proveedor criptográfico inyectable. La clave no se obtiene del entorno dentro del modelo. El contexto autenticado vincula `deliveryId`, `giftCardId` y `operationId`.

Un estado `sent` significa únicamente que hubo un intento. Solo se considera `delivered` con una de estas evidencias:

- acuse explícito del destinatario;
- recibo verificable de un canal confiable que demuestre entrega, no solo aceptación HTTP;
- entrega manual con identidad verificada y responsable registrado.

Al confirmar entrega se eliminan `ciphertext`, `iv` y `authTag`. Se conservan identificadores, hash de evidencia, tipo de confirmación, responsable y fechas. Los replays idempotentes devuelven referencias, nunca el código.

### Protección futura de citas

`Appointment.activeSettlementId` es opcional y `financialVersion` inicia en cero, por lo que los documentos históricos no requieren migración. En Fase 3B la cita deberá reclamarse dentro de la transacción con un filtro equivalente a:

```text
_id + estado completada + totalCobrado esperado + activeSettlementId null + financialVersion esperada
```

La actualización deberá establecer `activeSettlementId` e incrementar `financialVersion`, comprobando exactamente un documento modificado. Esto solo será una garantía real cuando todos los flujos que editan cobros respeten el bloqueo; Fase 3A no modifica rutas.

### Devoluciones

`GiftCardRefund` separa solicitud, autorización, retención y pago. Solo los desembolsos reales crean `gift_card_refund_cash_disbursement` o `gift_card_refund_transfer_disbursement`; los estados previos no generan salida financiera.

Para una devolución parcial, `balanceCents` conserva el saldo total pendiente, `heldBalanceCents` lo no disponible y el saldo canjeable es:

```text
availableBalanceCents = balanceCents - heldBalanceCents
```

Al pagar, `refund_payment` reduce tanto el saldo total como la retención por el importe efectivamente entregado. Cualquier saldo autorizado pero no pagado debe liberarse mediante `refund_release` o permanecer retenido hasta una decisión administrativa explícita. Un índice permite solo una devolución abierta por tarjeta; Fase 3B además deberá usar actualización condicional para impedir sobreasignación real.

### Idempotencia y recuperación

La huella usa versión explícita y se calcula sobre JSON canónico estable con actor, tipo de comando y payload. `FinancialCommand` distingue `processing`, `commit_unknown`, `completed` y `failed`, registra contador y vencimiento de lease, y rechaza secretos en `resultRefs`. Cada intento se audita además en `FinancialCommandAttempt`, append-only, sin almacenar el payload ni información sensible.

Un timeout no autoriza repetir efectos. `commit_unknown` obliga a consultar el comando y las referencias por `operationId` antes de decidir si se reintenta. Un comando `processing` solo puede reclamarse tras vencer su lease y mediante actualización condicional.

### Reversos y vencimiento

- Los reversos usan la fecha efectiva real y pueden afectar una semana distinta sin reescribir el original.
- Cancelar una cita liquidada requerirá en Fase 3B un comando único que revierta settlement, entradas y canje.
- Un canje solo admite un `redemption_reversal`, protegido también por índice único.
- Si la tarjeta está vencida, el saldo restituido permanece vencido y no canjeable; no se extiende vigencia ni se reconoce como ingreso. La operación debe quedar bloqueada si la política administrativa exige reactivarlo.

## Correcciones contractuales de Fase 3B.1

Esta fase no ejecuta comandos ni transacciones. Define los contratos que deberá consumir el motor posterior.

### Identidad de operación

`FinancialCommand.operationId` es inmutable, único y se obtiene con SHA-256 sobre una etiqueta de versión, el identificador del actor y la clave idempotente. No contiene payload, datos del cliente ni códigos de Gift Card. La reserva inicial persiste esa identidad; todos los reintentos de la misma pareja actor/clave reutilizan el valor almacenado.

Ante `commit_unknown`, el recuperador futuro deberá consultar primero el comando por actor/clave y `operationId`, y después correlacionar settlement, entradas, movimientos, refund y outbox mediante esa misma identidad. Nunca se reconstruye ni se devuelve el código desde `resultRefs`.

### Índices de entradas financieras

El índice histórico único `(operationId, kind)` se sustituye contractualmente por dos índices parciales:

- entradas normales: `(operationId, kind)` único para cobros, ventas y cada desembolso identificado;
- reversos: `(operationId, kind, reversesEntryId)` único cuando `kind = receipt_reversal`.

Permanece además el índice único parcial sobre `reversesEntryId`, que impide revertir una entrada original más de una vez. La consecuencia del cambio es que una operación puede compensar simultáneamente efectivo y transferencia sin perder trazabilidad.

### Fecha efectiva de Gift Card

`GiftCardMovement.effectiveDate` es una fecha civil inmutable. Es opcional exclusivamente para compatibilidad con documentos históricos ya existentes; todo movimiento creado por el motor nuevo deberá proporcionarla. `createdAt` registra cuándo se escribió y `effectiveDate` cuándo afecta al saldo o a la corrección, sin reescribir semanas anteriores.

### Desembolsos de devoluciones

Los tipos autorizados son:

```text
gift_card_refund_cash_disbursement
gift_card_refund_transfer_disbursement
```

Ambos son débitos reales, no gastos operativos. Las solicitudes, autorizaciones, retenciones y liberaciones no crean `FinancialEntry`.

```text
grossNewMoneyCents = cashReceiptsCents + transferReceiptsCents
netCashFlowCents = cashReceiptsCents - giftCardRefundCashDisbursedCents
netTransferFlowCents = transferReceiptsCents - giftCardRefundTransferDisbursedCents
expectedCashCents = 200000 + netCashFlowCents - expenseCents
```

Una devolución no modifica `serviceValueCents`, metas ni el valor histórico de la cita.

### Devoluciones parciales

`GiftCardRefund` admite `partially_paid`. `paidCents` es acumulado, `heldCents` es el remanente actualmente retenido y `financialEntryIds` conserva cada desembolso individual. Cada exhibición tiene su propio `operationId` y puede usar efectivo o transferencia.

```text
heldCents = authorizedCents - paidCents - releasedCents
paidCents + releasedCents <= authorizedCents
```

No se libera el remanente automáticamente. Una liberación requiere `refund_release` con identidad administrativa propia. `paid` exige que `paidCents = authorizedCents` y `heldCents = 0`. Un cierre parcial usa `cancelled`, saldo retenido cero, responsable y motivo de cierre.

### Rutas actuales que requieren protección futura

Fase 3B.1 no modifica estas rutas:

- `POST /admin/appointments`: puede crear una cita ya completada con `totalCobrado`.
- `PATCH /admin/appointments/:id/charged-amount`: modifica directamente `totalCobrado` y `paymentMethod`.
- `PATCH /admin/appointments/:id`: puede modificar datos de la cita, incluido el paso a completada según su allowlist vigente.
- `PATCH /admin/appointments/:id/status`: modifica `estado` y puede modificar `totalCobrado` y `paymentMethod`; también permite cancelación/no asistencia.

Antes de integración productiva, todos los flujos deberán rechazar cambios financieros directos cuando `activeSettlementId` no sea nulo. El contrato transaccional futuro reclamará la cita con `_id`, estado, `activeSettlementId: null` y `financialVersion` esperada; establecerá el settlement e incrementará la versión comprobando exactamente una actualización. Hasta modificar y probar esas rutas, los campos de protección no constituyen una garantía operativa.

## Contratos de leases y fencing — Fase 3B.2A

Esta fase solo amplía modelos. No existe todavía coordinador, trabajador, transición operativa ni transacción financiera.

### Acceso administrativo

Las operaciones especiales de Gift Cards y finanzas son exclusivas de administradores humanos. Los trabajadores mencionados en este contrato son procesos internos que ejecutarán únicamente comandos previamente autorizados por un administrador. No representan empleados y no sustituyen `actorUserId`. El backend futuro deberá comprobar el rol; ocultar controles en frontend no será autorización suficiente. El panel de empleados permanece aislado y no debe recibir códigos, saldos, movimientos, devoluciones ni información financiera sensible.

### Propiedad del lease

El coordinador futuro generará un token criptográficamente aleatorio por cada adquisición. El token existirá solo en memoria del trabajador autorizado; `FinancialCommand` persiste exclusivamente `leaseOwnerHash`, SHA-256 hexadecimal y excluido de consultas normales. `leaseAcquiredAt` registra la adquisición y `leaseExpiresAt` el límite temporal.

Renovar o liberar exigirá comando, estado, hash del propietario, fencing esperado y, cuando corresponda, lease vigente. Toda actualización deberá modificar exactamente un documento. Un lease vencido no demuestra que los efectos financieros no se confirmaron.

### Fencing token

`fencingToken` inicia en cero, que significa que nunca existió una generación de lease. Cada adquisición nueva o recuperación incrementará atómicamente el entero; no se reinicia ni se reutiliza. El token deberá verificarse dentro de la misma transacción futura que modifique dinero o saldos.

Ejemplo obligatorio: si A posee generación 1 y B recupera con generación 2, cualquier finalización posterior de A deberá fallar porque su fencing quedó obsoleto, aunque todavía conserve su token original.

### Auditoría de intentos

Los intentos nuevos registrarán `commandId`, `operationId`, administrador originador, número de intento y fencing. Un intento previo a adquirir lease usa fencing cero. `operationId` y `actorUserId` son opcionales únicamente para compatibilidad con documentos históricos; el coordinador futuro deberá proporcionarlos siempre.

Resultados:

- `lease_acquired`: se obtuvo una nueva propiedad.
- `lease_renewed`: el propietario vigente amplió el lease.
- `lease_released`: el propietario liberó voluntariamente.
- `lease_lost`: el trabajador ya no posee el comando.
- `replay_completed`: se devolvieron referencias seguras de un comando terminado.
- `idempotency_conflict`: misma identidad con huella distinta.
- `commit_unknown`: el resultado del commit es incierto.
- `recovery_pending`: la evidencia todavía no basta.
- `recovery_confirmed`: evidencia verificable confirmó el resultado.
- `persistence_failed`: falló persistencia, sin demostrar fracaso financiero.
- `completed`: finalización confirmada.
- `failed`: fracaso terminal demostrado.

Los intentos son append-only. La protección definitiva también requerirá permisos de base de datos y operaciones de escritura acotadas; los middleware de Mongoose no constituyen por sí solos una frontera de seguridad.

### Máquina de estados futura

Permitidas: `processing → completed|commit_unknown|failed` y `commit_unknown → completed|failed`, siendo esta última válida solo con evidencia concluyente de ausencia de commit. `completed` y `failed` son terminales. Están prohibidas las transiciones de esos estados a procesamiento y la recuperación automática `commit_unknown → processing`.

Timeout, pérdida de conexión, lease vencido o una lectura aislada sin artefactos no prueban fracaso. La recuperación deberá permanecer `recovery_pending` mientras la evidencia sea insuficiente.

### Garantías todavía no verificadas

Fase 3B.2A no prueba adquisición atómica, fencing concurrente, índices físicos, write conflicts, sesiones, transacciones ni permisos MongoDB. Esas garantías requieren el coordinador y pruebas posteriores contra un replica set aislado autorizado.

## Coordinador idempotente aislado — Fase 3B.2B

`financialCommandCoordinator` coordina reserva, replay, leases, fencing, estados, auditoría y recuperación mediante dependencias inyectadas. No importa modelos comerciales, no abre sesiones y no ejecuta efectos financieros.

### API interna

```text
reserveCommand
recognizeReplay
acquireLease
renewLease
releaseLease
markCommitUnknown
markFailed
completeWithinTransaction
recoverUnknownCommit
getCommandState
```

Todas las entradas externas pasan por `authorizeAdmin`. Los procesos internos conservan el `actorUserId` administrativo original y no pueden sustituirlo con su identidad de trabajador.

### Contrato de repositorios

- `reserve`: inserción protegida por el índice único actor/clave; en conflicto devuelve el documento existente. Está prohibido implementar check-then-insert sin unicidad.
- `findByIdentity`: lectura interna que incluye `fingerprint` para comparar huellas.
- `findById`: lectura interna que incluye `fingerprint` y `leaseOwnerHash`. Esos campos nunca salen de `publicCommand`.
- `acquireLease`: filtro por comando, estado, fencing esperado y lease ausente/vencido; incrementa fencing y establece propietario/fechas en una sola actualización.
- `renewLease`: exige propietario, fencing y lease vigente.
- `releaseLease`: exige propietario, fencing y lease vigente; limpia propiedad sin reiniciar fencing.
- `transitionState`: exige estado origen, propietario, fencing y lease; la finalización acepta un contexto transaccional externo.
- `nextAttemptNumber`: asignación atómica monotónica. Se toleran huecos tras fallos, nunca duplicados.
- `attemptRepository.append`: inserción append-only protegida por los índices únicos de auditoría.
- `artifactProbe.inspect`: devuelve solo `confirmed`, `pending`, `insufficient_evidence` o `failed_conclusively` con evidencia verificable.

El repositorio Mongo futuro deberá comprobar exactamente un documento modificado y traducir colisiones, pérdida de lease y fencing obsoleto a conflictos identificables. Los dobles actuales reproducen el contrato, pero no demuestran atomicidad física.

### Reserva y replay

La reserva usa `operationId` y huella canónica existentes. Misma identidad y huella devuelve el comando; una huella distinta produce conflicto. Estados `processing`, `commit_unknown`, `completed` y `failed` se reportan como pendiente, recuperación requerida, replay seguro o fallo terminal. Los resultados públicos excluyen huella y hash de propietario, y rechazan cualquier clave sensible.

### Lease y fencing

La adquisición comercial solo acepta `processing`. Una adquisición con propósito `recovery` solo acepta `commit_unknown`; nunca autoriza reejecutar el comando comercial. Cada adquisición usa token nuevo, persiste únicamente su hash e incrementa fencing. Renovación, liberación y transición verifican propiedad y generación. Un trabajador antiguo no puede finalizar después de que otro obtenga una generación superior.

### Finalización y auditoría

`completeWithinTransaction` rechaza llamadas sin un contexto externo activo. El repositorio futuro deberá confirmar la transición a `completed` y el intento de auditoría dentro de la misma transacción que los efectos financieros. El coordinador no abre una transacción propia.

La asignación del número de intento pertenece al repositorio. Si falla la auditoría fuera de una unidad transaccional, el coordinador devuelve `AUDIT_PERSISTENCE_FAILED` y no afirma que la operación quedó correctamente auditada. Un mecanismo posterior deberá recuperar esos huecos.

### Commit desconocido

La ausencia de comando o artefactos en una lectura produce evidencia insuficiente. Evidencia confirmada sin lease de recuperación y contexto transaccional permanece pendiente. Solo un lease de recuperación vigente puede aplicar `commit_unknown → completed|failed`, y el fallo exige evidencia concluyente. No existe reejecución automática.

### Límites de esta fase

No hay repositorios Mongoose, sesiones, transacciones, índices físicos, worker, endpoints ni operaciones comerciales. Las pruebas usan dobles condicionales y no verifican concurrencia real. El panel de empleados y las rutas productivas permanecen desconectados.

## Repositorios MongoDB aislados — Fase 3B.2C

Los adaptadores `financialCommandRepository` y `financialCommandAttemptRepository` implementan la persistencia requerida por el coordinador sin abrir conexiones, importar el servidor ni crear sesiones. Los modelos Mongoose pueden inyectarse para pruebas; por defecto utilizan `FinancialCommand` y `FinancialCommandAttempt`.

### Reserva e identidad

La reserva intenta primero una inserción protegida por los índices únicos. Solo ante un error MongoDB de clave duplicada consulta `(actorUserId, idempotencyKey)` y devuelve ese documento al coordinador, incluyendo internamente su `fingerprint`. Si la colisión provino de otra restricción y la identidad no existe, el error se propaga. El repositorio nunca decide que fingerprints distintos son un replay válido.

### Operaciones condicionales

- Adquirir un lease filtra por `_id`, estado, fencing esperado, fencing menor al máximo seguro y lease ausente o vencido; propietario, fechas e incremento de fencing se escriben juntos.
- Renovar y liberar filtran por estado no terminal, hash de propietario, fencing exacto y lease todavía vigente.
- Transicionar valida una lista cerrada: `processing → commit_unknown|completed|failed` y `commit_unknown → completed|failed`. Cualquier solicitud que incluya `completed` o `failed` como origen se rechaza antes de consultar MongoDB, y el filtro atómico añade `$nin: [completed, failed]` como segunda barrera. `commit_unknown → processing` está prohibida. Al completar o fallar se limpia el lease sin reiniciar el fencing.
- La asignación de intentos usa `$inc` sobre `attemptCount` y devuelve el valor anterior como número reservado. Puede dejar huecos si la escritura append-only posterior falla, pero no depende de memoria y no reutiliza números.

Todas estas operaciones comprueban el resultado de una escritura efectiva; una lectura previa por sí sola nunca concede propiedad ni protege efectos financieros.

### Sesión externa y atomicidad

El contexto transaccional real tiene la forma `{ active: true, session }`, donde `session.inTransaction()` debe devolver estrictamente `true`. Tanto el coordinador como el repositorio rechazan ausencia de contexto, `{ active: true }` sin sesión y sesiones fuera de una transacción con `TRANSACTION_CONTEXT_REQUIRED`. Una transición a `completed` no puede avanzar con una marca booleana simulada. La misma sesión se propaga a la transición, al incremento del contador y a la inserción de auditoría, permitiendo que una futura operación comercial los incluya en una sola transacción. Los repositorios no llaman `startSession`, `withTransaction`, `commitTransaction` ni `abortTransaction`.

Reservas, consultas, leases y transiciones no terminales pueden ejecutarse sin sesión cuando el coordinador no está cerrando una unidad financiera. Si reciben un contexto declarado, este también debe representar una transacción activa; no se acepta una falsa marca `active`.

### Auditoría append-only

El repositorio de intentos solo expone `append` y acepta una lista cerrada de campos: referencias, identidad del actor, operación, intento, fecha, fencing, digest, resultado y código seguro. No admite payloads ni campos adicionales. La unicidad física continúa correspondiendo a `attemptId` y `(commandId, attemptNumber)`. Si la inserción falla, el error se propaga y el coordinador informa `AUDIT_PERSISTENCE_FAILED`; no se afirma que la operación quedó auditada. Fuera de una transacción puede quedar un hueco legítimo en la secuencia.

### Recuperación y consultas

El repositorio permite consultar por `operationId`, identidad actor/clave, estados y leases vencidos. Estas consultas solo localizan candidatos: no reejecutan efectos, no convierten ausencia en rollback concluyente y no modifican comandos terminales. La recuperación sigue bajo las reglas del coordinador y del `artifactProbe`.

### Índices y alcance verificado

Se conservaron sin cambios los índices declarados: identidad actor/clave y `operationId` únicos, escaneo `(status, leaseExpiresAt)`, `attemptId` único y `(commandId, attemptNumber)` único. No se crearon índices físicos ni se ejecutaron migraciones. Las pruebas de esta fase inspeccionan filtros, updates y propagación de sesiones mediante modelos simulados; no demuestran concurrencia MongoDB real, comportamiento de un replica set ni atomicidad física. Eso requiere una prueba integral futura expresamente autorizada.

No se conectaron rutas, servidor, Agenda, Gift Cards ni operaciones comerciales. El panel de empleados permanece intacto.

## Escenarios ficticios reutilizables

`Backend/tests/fixtures/financialPhase0Fixtures.js` contiene:

- A/B: históricos y servicios simples.
- C: mixto 200/300/500.
- D/E: venta de tarjeta por efectivo/transferencia.
- F/G: canje entre semanas y agotamiento.
- H/I: reintento idempotente y concurrencia.
- J/K: reverso y cancelación posterior.
- L/M: periodo híbrido, gastos y fondo fijo.
- N/O: vencida y paquete por mascota.
- P: fidelidad gratuita incompatible.
- Q/R: corrección y cobro en fechas distintas.

Los escenarios futuros son datos y expectativas documentadas; no están conectados a servicios productivos.

## Políticas abiertas

No quedan aprobadas en esta fase:

1. Reembolso real de tarjetas canceladas.
2. Reconocimiento contable del saldo vencido.
3. Valoración monetaria de tarjetas por paquete.
4. Reactivación o extensión.
5. Fecha efectiva de correcciones y reversos entre periodos.
6. Tratamiento de servicios gratuitos de valor cero fuera de fidelidad.
7. Automatización del reverso al cancelar una cita ya liquidada.
8. Limitaciones heredadas de fidelidad durante la transición transaccional.

Recomendación pendiente: los reversos deben conservar siempre `createdAt`, referencia al original y una `effectiveDate` explícita cuya política se apruebe antes de la Fase 1.

### Recomendaciones previas a transacciones

Estas recomendaciones no están implementadas y requieren aprobación comercial/contable:

1. **Reembolso de tarjetas canceladas — resolver antes de Fase 3.** Recomendar reembolsar únicamente por un movimiento y una salida financiera explícitos, al método original cuando sea posible, con autorización e idempotencia. Consecuencia: reduce efectivo o transferencia y el pasivo de la tarjeta sin borrar su historial.
2. **Reversos en semanas diferentes — resolver antes de Fase 3.** Recomendar registrar el reverso en la fecha efectiva real de la corrección, enlazado al movimiento original, sin reescribir la semana cerrada. Consecuencia: la semana del reverso puede mostrar ingreso neto negativo; los reportes deben explicarlo como corrección.
3. **Cancelación de citas liquidadas — resolver antes de Fase 3.** Recomendar impedir la cancelación directa y exigir un comando transaccional que revierta settlement, cobros y canje de Gift Card en conjunto. Consecuencia: evita servicios cobrados sin cita y saldos restaurados parcialmente.
4. **Fidelidad — resolver antes de Fase 3.** Mantener la exclusión entre recompensa gratuita y Gift Card en una misma cita; cualquier combinación futura necesita reglas de prioridad. Consecuencia: evita reconocer dos beneficios sobre el mismo valor de servicio.
5. **Gift Cards por paquete — puede esperar si Fase 3 se limita a tarjetas monetarias.** No asignar valor monetario ficticio; congelar servicio, mascota y unidad. Consecuencia: se reconocen unidades y valor de servicio realizado, pero la valoración del pasivo requiere política contable independiente.
6. **Saldos vencidos — puede esperar para operación, no para reporteo.** Mantenerlos separados del saldo canjeable y no tratarlos automáticamente como ingreso ni reembolso. Consecuencia: conserva trazabilidad y evita reconocer ganancias sin política contable aprobada.
7. **Reactivaciones excepcionales — puede esperar.** Recomendar un ajuste autorizado append-only con motivo, actor, nueva vigencia e idempotencia; nunca modificar silenciosamente la expiración original. Consecuencia: el pasivo vuelve a estar disponible y debe aparecer separado en auditoría.

## Comportamiento actual caracterizado

- El resumen considera `totalCobrado` como valor del servicio.
- `paymentMethod: null` se clasifica como ingreso sin clasificar.
- Un importe ausente no suma, pero la cita permanece en el conteo de completadas.
- Las metas semanales suman `totalCobrado` de citas completadas sin usar método de pago.
- El fondo fijo aparece una vez y los gastos activos se restan del efectivo.
- La edición de cobro actual cambia conjuntamente `totalCobrado` y `paymentMethod` solo en citas completadas.

Estas observaciones congelan el comportamiento; no implican que los contratos futuros estén implementados.
