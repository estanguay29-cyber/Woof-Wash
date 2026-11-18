# Índices financieros — manifiesto y procedimiento

La fuente de verdad es `schema.indexes()` de cada modelo. `Backend/tests/integration/financialIndexesMongo.integration.js` materializa y compara físicamente nombre, campos, unicidad y filtro parcial en MongoDB temporal.

## Índices críticos

| Modelo | Índice | Campos | Único / parcial | Dependencia y riesgo previo |
|---|---|---|---|---|
| FinancialCommand | `financial_command_actor_idempotency_unique` | actorUserId, idempotencyKey | Único | No pueden existir identidades repetidas por administrador. |
| FinancialCommand | `financial_command_operation_unique` | operationId | Único | OperationId debe ser globalmente único. |
| FinancialCommand | `commandType_1_createdAt_-1` | commandType, createdAt | No | Consulta histórica. |
| FinancialCommand | `financial_command_recovery_scan` | status, leaseExpiresAt | No | Recuperación de leases. |
| FinancialCommandAttempt | `financial_command_attempt_id_unique` | attemptId | Único | Auditoría append-only. |
| FinancialCommandAttempt | `financial_command_attempt_number_unique` | commandId, attemptNumber | Único | No admite numeración duplicada. |
| AppointmentPaymentSettlement | `settlement_appointment_revision_unique` | appointmentId, revision | Único | Revisiones históricas no duplicadas. |
| AppointmentPaymentSettlement | `settlement_operation_unique` | operationId | Único | Un settlement por operación. |
| AppointmentPaymentSettlement | `settlement_one_active_per_appointment` | appointmentId | Único cuando status=active | Debe resolverse cualquier doble activo antes de crearlo. |
| FinancialEntry | `effectiveDate_1_kind_1_createdAt_1` | effectiveDate, kind, createdAt | No | Conciliación por periodo. |
| FinancialEntry | `appointmentId_1_createdAt_1`, `settlementId_1_createdAt_1`, `giftCardId_1_createdAt_1` | Referencia, createdAt | No | Historiales. |
| FinancialEntry | `financial_entry_refund_history` | refundId, effectiveDate, createdAt | No | Varias exhibiciones permitidas. |
| FinancialEntry | `financial_entry_operation_normal_kind_unique` | operationId, kind | Único parcial para entradas normales | Impide efectos normales repetidos. |
| FinancialEntry | `financial_entry_operation_reversal_target_unique` | operationId, kind, reversesEntryId | Único parcial para receipt_reversal | Una operación mixta puede revertir varios recibos. |
| FinancialEntry | `financial_entry_single_reversal` | reversesEntryId | Único parcial ObjectId | Cada recibo se revierte una sola vez. |
| GiftCard | `gift_card_code_hash_unique` | codeHash | Único | Auditar hashes duplicados antes de crear. |
| GiftCard | `gift_card_single_successor` | replacesGiftCardId | Único parcial ObjectId | Una tarjeta original sólo puede tener una sucesora. |
| GiftCard | `gift_card_single_replacement_target` | replacedByGiftCardId | Único parcial ObjectId | Una sucesora no puede ser destino de dos originales. |
| GiftCard | `gift_card_replacement_operation_unique` | replacementOperationId | Único parcial string | Una operación sólo puede materializar una sucesora. |
| GiftCard | `status_1_expiresOn_1`, `customerProfileId_1_createdAt_-1`, `petId_1_createdAt_-1`, `paymentDate_1_paymentMethod_1` | Según nombre | No | Consultas y conciliación. |
| GiftCardMovement | `giftCardId_1_createdAt_1__id_1`, `effectiveDate_1_kind_1_createdAt_1`, `appointmentId_1_createdAt_1`, `settlementId_1`, `refundId_1_createdAt_1` | Según nombre | No | Historial y periodos. |
| GiftCardMovement | `gift_card_movement_operation_kind_unique` | operationId, kind | Único | Un efecto de cada clase por operación. |
| GiftCardMovement | `gift_card_movement_single_reversal` | reversesMovementId | Único parcial ObjectId | Un canje se revierte una sola vez. |
| GiftCardMovement | `gift_card_refund_single_hold_or_release` | refundId, kind | Único parcial hold/release | Una retención y una liberación total por devolución. |
| GiftCardRefund | `gift_card_refund_operation_unique` | operationId | Único | Solicitud idempotente. |
| GiftCardRefund | `gift_card_one_open_refund` | giftCardId | Único cuando isOpen=true | Resolver devoluciones abiertas duplicadas. |
| GiftCardRefund | `status_1_createdAt_1` | status, createdAt | No | Bandeja administrativa. |
| GiftCardDeliveryOutbox | `gift_card_delivery_id_unique`, `gift_card_delivery_per_card_unique`, `gift_card_delivery_operation_unique` | deliveryId / giftCardId / operationId | Únicos | No deben existir entregas duplicadas. |
| GiftCardDeliveryOutbox | `gift_card_delivery_confirmation_operation_unique` | confirmationOperationId | Único parcial string | La confirmación de entrega es idempotente. |
| GiftCardDeliveryOutbox | `gift_card_delivery_pending_scan` | status, createdAt | No | Recuperación de entrega. |

## Procedimiento futuro en Atlas

1. No usar `syncIndexes()` directamente en producción.
2. Exportar `schema.indexes()` de la versión aprobada y comparar con `collection.getIndexes()`.
3. Ejecutar consultas de duplicados para cada índice único y parcial; detenerse si aparece cualquier grupo con conteo mayor a uno.
4. Crear primero índices no únicos y observar carga.
5. Crear índices únicos individualmente durante ventana controlada; conservar nombre y filtro exactos.
6. Verificar con `getIndexes()` nombre, key, `unique` y `partialFilterExpression`.
7. Ejecutar smoke tests de idempotencia y concurrencia.
8. No eliminar índices antiguos hasta completar al menos un ciclo de conciliación y aprobar rollback.

Permisos mínimos del usuario de despliegue: lectura/escritura sobre la base de Woof & Wash y capacidad temporal de crear índices. La aplicación en ejecución no necesita permisos administrativos del clúster ni acceso a otras bases.
