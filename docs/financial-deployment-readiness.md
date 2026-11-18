# Woof & Wash — preparación de entrega financiera

Estado: preparado para revisión y despliegue controlado; este documento no autoriza producción.

## Inventario de entrega

Incluir en Git:

- Modelos: `Backend/Appointment.js`, `AppointmentPaymentSettlement.js`, `FinancialCommand.js`, `FinancialCommandAttempt.js`, `FinancialEntry.js`, `GiftCard.js`, `GiftCardDeliveryOutbox.js`, `GiftCardMovement.js`, `GiftCardRefund.js`.
- Repositorios: `Backend/repositories/financialCommandRepository.js`, `financialCommandAttemptRepository.js`.
- Servicios: `appointmentFinancialIntegrityGuard.js`, `appointmentSettlementService.js`, `financialAdminSummaryService.js`, `financialCommandCoordinator.js`, `financialCommercialService.js`, `financialLedgerService.js`, `financialReconciliationService.js`, `financialTransactionRunner.js`, `giftCardDeliveryCryptoProvider.js`, `giftCardRefundService.js`, `giftCardService.js`, `historicalPaymentAdapter.js`.
- Integración: `Backend/routes/financialCommercialRouter.js` y los cambios financieros limitados de `Backend/server.js`.
- Interfaz: `Frontend/agenda.html`, `agenda.js`, `styles.css`, `shared/admin-finance-summary.js`, `shared/admin-gift-cards.js`.
- Contratos y pruebas financieras bajo `Backend/tests/financial*.test.js`, `Backend/tests/appointmentFinancialIntegrityGuards.test.js`, `Backend/tests/integration/financial*.integration.js`, sus helpers y las pruebas UI administrativas relacionadas.
- Documentación: `docs/pagos-finanzas-fase-0.md`, `docs/financial-indexes.md` y este archivo.
- Manifiestos de dependencias: `Backend/package.json` y `Backend/package-lock.json` sólo si sus cambios reales forman parte de la entrega revisada.

No incluir: `.env*`, `node_modules`, `.cache`, binarios `mongod`, logs, uploads, respaldos, dumps, resultados de prueba o directorios temporales. Todos están cubiertos por `.gitignore`; verificar nuevamente antes del commit futuro.

## Dependencias y runtime

- Node.js compatible con Express 5 y Mongoose 9.
- MongoDB con replica set y soporte de transacciones, read concern `snapshot` y write concern `majority`.
- Dependencias declaradas: Mongoose 9.9.3, MongoDB Driver 7.1.1, Express 5.2.1, JSON Web Token 9.0.3 y las restantes fijadas por `package-lock.json`.
- `mongodb-memory-server` es sólo de desarrollo/pruebas; su binario local no se entrega.

## Variables de entorno — sólo nombres

Obligatorias para iniciar backend: `MONGO_URI`, `JWT_SECRET` (mínimo 32 caracteres en producción), `NODE_ENV=production` y `PORT` según Render.

Entrega segura de códigos de reemplazo: `GIFT_CARD_DELIVERY_KEY_BASE64` (32 bytes codificados en Base64) y `GIFT_CARD_DELIVERY_KEY_ID`. Sin ambas variables, el backend inicia pero rechaza reemplazos con estado 503; nunca usar una clave efímera.

Orígenes: `FRONTEND_ORIGINS` o `FRONTEND_ORIGIN`.

Correo, si se usa: `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`, `ADMIN_EMAIL`, `BUSINESS_EMAIL`.

Cloudinary, si se usan cargas: `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`, `CLOUDINARY_UPLOAD_FOLDER`, `CLOUDINARY_APPOINTMENT_PET_FOLDER`, `CLOUDINARY_EMPLOYEE_PROFILE_FOLDER`, `CLOUDINARY_EXPENSE_TICKET_FOLDER`.

Stripe existente, si se activa su módulo separado: `STRIPE_SECRET`, `STRIPE_WEBHOOK_SECRET`. Las operaciones financieras de Gift Cards implementadas aquí no dependen de Stripe.

Nunca imprimir valores en logs o documentación.

## Orden de despliegue futuro

1. Congelar una versión revisada y verificar que el árbol sólo contenga el inventario aprobado.
2. Crear snapshot/backup verificable de la base productiva y registrar punto de restauración.
3. Auditar duplicados y documentos incompatibles con cada índice único o parcial, sin crear índices todavía.
4. Materializar índices con el procedimiento de `financial-indexes.md`, primero en staging con copia representativa.
5. Desplegar backend en Render con operaciones financieras comerciales deshabilitadas mediante control operativo de rutas o ventana sin usuarios.
6. Ejecutar smoke tests autenticados de lectura, permisos y una transacción de prueba exclusivamente en staging.
7. Desplegar Frontend en Vercel y verificar CORS contra el origen exacto.
8. Habilitar gradualmente: lecturas, venta/activación, liquidación, después devoluciones y reversos.
9. Monitorizar conflictos, `commit_unknown`, comandos en `processing`, errores 409/5xx y diferencias de conciliación.

## Smoke tests

- Login admin válido; empleado y cliente reciben 403 en `/admin/finance/*`.
- Resumen vacío devuelve fondo de $2,000 exactamente una vez.
- Venta de prueba crea una tarjeta, un movimiento y un asiento; el replay no devuelve código.
- Liquidación en efectivo y 100% Gift Card preservan valor de servicio y dinero nuevo correcto.
- Solicitud/autorización no cambia flujo de caja; desembolso sí.
- Replay de desembolso/reverso no crea otro efecto.
- Reemplazo invalida el código anterior, conserva saldo y vencimiento, no crea asiento de ingreso y no vuelve a mostrar el código en replay.
- Cita liquidada rechaza edición financiera heredada.
- Reporte diario y por periodo coincide con ledger y gastos.

## Rollback

1. Deshabilitar nuevas mutaciones financieras; mantener lecturas y evidencia.
2. No borrar comandos, settlements, entradas ni movimientos creados.
3. Revertir Frontend a la versión anterior para retirar controles de operación.
4. Revertir backend sólo después de confirmar que la versión anterior puede leer los campos nuevos; de lo contrario mantener backend y bloquear rutas.
5. Resolver operaciones `processing` o `commit_unknown` mediante consulta de artefactos antes de cualquier reintento.
6. Para operaciones ya confirmadas, usar movimientos compensatorios aprobados; nunca restaurar selectivamente documentos financieros desde backup.
7. Restaurar la base completa sólo ante corrupción general y con ventana coordinada, usando el snapshot previo.

## Incidente de reemplazo confirmado sin respuesta

1. No usar otra clave idempotente y no solicitar un segundo reemplazo.
2. Consultar el comando `replace_gift_card` con la clave original. Si está `processing` o `commit_unknown`, ejecutar únicamente la recuperación de artefactos existente.
3. Si queda `completed`, verificar la relación original/sucesora, los dos movimientos de reemplazo y el outbox pendiente. La tarjeta original ya no debe canjearse.
4. El endpoint y el replay no vuelven a entregar el código. Un operador autorizado debe recuperar el envelope cifrado fuera de la interfaz, con la clave administrada y los identificadores exactos `deliveryId`, `giftCardId` y `operationId`, dejando evidencia del incidente.
5. Tras la entrega manual verificada, confirmar el resguardo mediante `replacement-delivery`, que elimina `ciphertext`, `iv` y `authTag`.
6. Si el envelope no puede recuperarse, escalar para una autorización comercial individual. No encadenar reemplazos automáticamente.

## Monitorización

- Conteo y antigüedad de comandos `processing` y `commit_unknown`, reemplazos y entregas de código pendientes.
- Conflictos de fencing, versión de cita, saldo, retención e índices duplicados.
- Diferencias entre service value, dinero nuevo, ledger y caja esperada.
- Desembolsos por método, devoluciones abiertas y retenciones antiguas.
- Reversos por periodo y citas con historial de settlement sin activo.
- Respuestas 401/403/409/429/5xx de rutas financieras, sin registrar payloads sensibles.

## Políticas no implementadas

Gift Cards por paquete, reactivación excepcional, liberaciones parciales sucesivas y conversión automática de reverso contable en devolución física requieren decisión comercial expresa. El reemplazo por código perdido sí forma parte de V1, pero una respuesta perdida después del commit no autoriza otro reemplazo: debe recuperarse el comando, verificar la sucesora y resolver la entrega cifrada mediante procedimiento administrativo controlado.
