# Pruebas manuales del portal empleado

## Requisitos previos

- Backend activo y respondiendo.
- Base de datos de pruebas o controlada.
- Usuario admin existente y funcional.
- Frontend disponible en el entorno de prueba.
- Evitar usar datos reales de empleados/clientes si no es un entorno controlado.

## 1. Crear empleado desde admin

1. Iniciar sesion como admin.
2. Entrar al panel de empleados.
3. Abrir la opcion **Nuevo**.
4. Capturar nombre, telefono, email, puesto y fecha de ingreso.
5. Guardar el empleado.
6. Confirmar que aparece en la tabla de empleados como activo.

## 2. Crear acceso al portal empleado

1. Abrir el empleado creado en modo Ver o Editar.
2. Ubicar la seccion **Acceso al portal empleado**.
3. Confirmar que muestra **Sin acceso vinculado**.
4. Revisar o editar:
   - Usuario.
   - Email.
   - Contrasena temporal.
5. Presionar **Crear acceso**.
6. Confirmar que la seccion cambia a **Acceso activo** y muestra usuario/email.

## 3. Login como empleado

1. Cerrar sesion admin.
2. Ir a `login.html`.
3. Iniciar sesion con el usuario y contrasena temporal del empleado.
4. Confirmar que redirige a `empleados/dashboard.html`.
5. Confirmar que no muestra enlaces ni acciones admin.

## 4. Validar `/empleados/me`

Con el token del empleado:

- Debe responder `usuario.id`, `usuario.usuario`, `usuario.email`, `usuario.role`.
- `usuario.role` debe ser `empleado`.
- Debe responder `empleado.id`, `empleado.nombre`, `empleado.email`, `empleado.telefono`, `empleado.puesto`, `empleado.activo`, `empleado.fechaIngreso`, `empleado.fechaCumpleanos`.
- No debe devolver password, hash, reset tokens ni datos sensibles.
- `empleado.id` debe coincidir con el Employee vinculado, no con el User.

## 5. Validar `/empleados/performance`

Probar:

```text
GET /empleados/performance?fecha=YYYY-MM-DD
```

Validar:

- Usa la semana correspondiente a la fecha enviada.
- Devuelve solo el empleado logueado.
- No devuelve lista global de empleados.
- No acepta ni requiere `employeeId`.
- Las metricas aparecen aunque no haya datos, usando ceros o estados seguros.
- Campos esperados:
  - `empleado`
  - `semana`
  - `metricas.ventasSemanales`
  - `metricas.metaSemanal`
  - `metricas.cumplioMetaPersonal`
  - `metricas.promedioEstrellas`
  - `metricas.retardosSemana`
  - `metricas.faltasInjustificadas`
  - `metricas.limpiezaOrdenOk`
  - `metricas.elegibleBono`
  - `metricas.bonoCalculado`
  - `metricas.totalAPagar`
  - `metricas.porcentajePuntualidad`
  - `metricas.totalServicios`

## 6. Validar `/empleados/appointments`

Probar una fecha con y sin citas:

```text
GET /empleados/appointments?fecha=YYYY-MM-DD
```

Validar:

- Devuelve solo citas asignadas al Employee vinculado.
- Filtra por `Employee._id`, no por `User._id`.
- No permite enviar `employeeId` para consultar otro empleado.
- Si no hay citas, devuelve lista vacia sin error 500.
- Las citas canceladas o no asistio no deben aparecer como activas.

## 7. Prueba negativa: empleado contra admin

Con token de empleado, intentar:

```text
GET /admin/me
GET /admin/employees
GET /admin/performance/dashboard
```

Resultado esperado:

- Respuesta `403 No autorizado`, o redireccion a login si se prueba desde UI.
- El empleado no debe ver panel admin ni datos de otros empleados.

## 8. Prueba admin

1. Cerrar sesion de empleado.
2. Iniciar sesion como admin.
3. Confirmar que redirige al flujo admin esperado.
4. Confirmar acceso a:
   - Panel de empleados.
   - Modal de empleado.
   - Dashboard de desempeno.
   - Nomina.
5. Confirmar que el admin puede consultar el acceso vinculado desde el modal.

## Checklist final

- [ ] Backend activo.
- [ ] DB de pruebas o controlada confirmada.
- [ ] Admin inicia sesion correctamente.
- [ ] Admin crea empleado activo.
- [ ] Admin crea acceso al portal empleado.
- [ ] No se permite crear acceso duplicado para el mismo Employee.
- [ ] No se permite usuario/email duplicado.
- [ ] Empleado inicia sesion correctamente.
- [ ] Login empleado redirige a `empleados/dashboard.html`.
- [ ] `/empleados/me` devuelve perfil seguro.
- [ ] `/empleados/performance` devuelve solo metricas personales.
- [ ] `/empleados/appointments` devuelve solo citas del Employee vinculado.
- [ ] Empleado recibe bloqueo al intentar rutas admin.
- [ ] Admin sigue entrando normal.
- [ ] No se detectan datos sensibles en respuestas del portal empleado.
