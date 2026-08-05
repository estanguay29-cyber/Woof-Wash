const { parseHistoricalChargedAmount } = require("./weeklyRevenueService");
const { contarServiciosCita: _contarServiciosCitaFallback } = {};

function contarServiciosCita(obj = {}) {
  return Array.isArray(obj.serviciosDetalle) && obj.serviciosDetalle.length
    ? obj.serviciosDetalle.length
    : 1;
}

function calcularPuntualidadCita(cita, inicio = new Date()) {
  if (!cita?.fecha || !cita?.hora) return null;
  const fechaProgramada = new Date(`${cita.fecha}T${cita.hora}:00`);
  if (Number.isNaN(fechaProgramada.getTime()) || Number.isNaN(inicio.getTime())) return null;
  return Math.round((inicio.getTime() - fechaProgramada.getTime()) / 60000);
}

function calcularMetricasEmpleado(citas = []) {
  const completadas = citas.filter((cita) => cita.estado === "completada" || cita.estadoOperativo === "finalizada");
  const calificaciones = citas
    .map((cita) => (Number.isInteger(cita.calificacionCliente) ? cita.calificacionCliente : cita.calificacionServicio))
    .filter((valor) => Number.isInteger(valor) && valor >= 1 && valor <= 5);
  const puntualidades = citas
    .map((cita) => cita.puntualidadMinutos)
    .filter((valor) => Number.isInteger(valor));
  const puntuales = puntualidades.filter((valor) => valor <= 5).length;

  const ingresosGeneradosAproximados = completadas.reduce((total, cita) => {
    const charged = parseHistoricalChargedAmount(cita.totalCobrado);
    return total + (charged.valid ? charged.amount : 0);
  }, 0);

  return {
    serviciosCompletados: completadas.reduce((total, cita) => total + contarServiciosCita(cita), 0),
    citasCompletadas: completadas.length,
    promedioCalificacion: calificaciones.length
      ? Math.round((calificaciones.reduce((total, valor) => total + valor, 0) / calificaciones.length) * 10) / 10
      : null,
    puntualidadPorcentaje: puntualidades.length ? Math.round((puntuales / puntualidades.length) * 100) : null,
    ingresosGeneradosAproximados
  };
}

function calcularComisiones(metricas = {}, empleado = {}) {
  const tasa = Number.isFinite(Number(empleado.comision)) ? Number(empleado.comision) : 0;
  const base = Number.isFinite(Number(metricas.ingresosGeneradosAproximados)) ? Number(metricas.ingresosGeneradosAproximados) : 0;
  return Math.round((base * tasa) / 100);
}

function calcularBonosEmpleado(metricas = {}, empleado = {}) {
  const bonoManual = Number.isFinite(Number(empleado.bonoManual)) ? Number(empleado.bonoManual) : 0;
  const descuentoAdministrativo = Number.isFinite(Number(empleado.descuentoAdministrativo)) ? Number(empleado.descuentoAdministrativo) : 0;

  let bonoPuntualidad = 0;
  if (typeof metricas.puntualidadPorcentaje === "number") {
    if (metricas.puntualidadPorcentaje >= 90) bonoPuntualidad = 300;
    else if (metricas.puntualidadPorcentaje >= 75) bonoPuntualidad = 150;
  }

  let bonoResenas = 0;
  if (typeof metricas.promedioCalificacion === "number") {
    if (metricas.promedioCalificacion >= 4.7) bonoResenas = 250;
    else if (metricas.promedioCalificacion >= 4.3) bonoResenas = 120;
    else if (metricas.promedioCalificacion >= 4.0) bonoResenas = 60;
  }

  const comisionesAproximadas = calcularComisiones(metricas, empleado);

  const sueldoBase = Number.isFinite(Number(empleado.sueldoBase)) ? Number(empleado.sueldoBase) : 0;

  const totalPagoAproximado = Math.round(
    sueldoBase + comisionesAproximadas + bonoManual + bonoPuntualidad + bonoResenas - descuentoAdministrativo
  );

  return {
    bonoPuntualidad,
    bonoResenas,
    bonoManual,
    descuentoAdministrativo,
    comisionesAproximadas,
    totalPagoAproximado
  };
}

function formatoFechaISO(date) {
  return date.toISOString().slice(0, 10);
}

function obtenerRangoSemana(fecha = "") {
  if (typeof fecha !== "string" || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(fecha)) {
    return null;
  }

  const fechaBase = new Date(`${fecha}T00:00:00Z`);
  if (Number.isNaN(fechaBase.getTime())) {
    return null;
  }

  const dia = fechaBase.getUTCDay();
  const diasDesdeLunes = (dia + 6) % 7;
  const inicio = new Date(fechaBase);
  inicio.setUTCDate(fechaBase.getUTCDate() - diasDesdeLunes);
  const fin = new Date(inicio);
  fin.setUTCDate(inicio.getUTCDate() + 6);

  return {
    inicio: formatoFechaISO(inicio),
    fin: formatoFechaISO(fin)
  };
}

function calcularMetaSemanalMxn(metaDiaria = 2000) {
  const diario = Number.isFinite(Number(metaDiaria)) ? Number(metaDiaria) : 2000;
  return diario * 5;
}

function calcularScoreSemanal(metricas = {}) {
  const puntualidad = typeof metricas.puntualidadPorcentaje === "number" ? metricas.puntualidadPorcentaje : 0;
  const promedioCalificacion = typeof metricas.promedioCalificacion === "number" ? metricas.promedioCalificacion : 0;
  const servicios = Number.isFinite(metricas.serviciosCompletados) ? metricas.serviciosCompletados : 0;
  const calificacionPorcentaje = (promedioCalificacion / 5) * 100;
  const serviciosScore = Math.min(servicios, 20) * 0.75;

  return Math.min(
    Math.max(
      Math.round(puntualidad * 0.45 + calificacionPorcentaje * 0.4 + serviciosScore),
      0
    ),
    100
  );
}

function calcularBonoSemanal(metricas = {}, empleado = {}, actualSemanaMxn = 0, metaSemanalMxn = 22000) {
  let bonoMeta = 0;
  if (Number.isFinite(actualSemanaMxn) && Number.isFinite(metaSemanalMxn) && actualSemanaMxn >= metaSemanalMxn) {
    bonoMeta = 600;
  }

  let bonoPuntualidad = 0;
  if (typeof metricas.puntualidadPorcentaje === "number") {
    if (metricas.puntualidadPorcentaje >= 95) bonoPuntualidad = 400;
    else if (metricas.puntualidadPorcentaje >= 90) bonoPuntualidad = 250;
    else if (metricas.puntualidadPorcentaje >= 80) bonoPuntualidad = 120;
  }

  let bonoResenas = 0;
  if (typeof metricas.promedioCalificacion === "number") {
    if (metricas.promedioCalificacion >= 4.8) bonoResenas = 350;
    else if (metricas.promedioCalificacion >= 4.5) bonoResenas = 225;
    else if (metricas.promedioCalificacion >= 4.2) bonoResenas = 120;
    else if (metricas.promedioCalificacion >= 4.0) bonoResenas = 60;
  }

  const bonoManual = Number.isFinite(Number(empleado.bonoManual)) ? Number(empleado.bonoManual) : 0;
  const descuentoAdministrativo = Number.isFinite(Number(empleado.descuentoAdministrativo)) ? Number(empleado.descuentoAdministrativo) : 0;
  const comisionesAproximadas = calcularComisiones(metricas, empleado);
  const sueldoBase = Number.isFinite(Number(empleado.sueldoBase)) ? Number(empleado.sueldoBase) : 0;
  const totalPagoAproximado = Math.round(
    sueldoBase + comisionesAproximadas + bonoMeta + bonoPuntualidad + bonoResenas + bonoManual - descuentoAdministrativo
  );

  return {
    bonoMeta,
    bonoPuntualidad,
    bonoResenas,
    bonoManual,
    descuentoAdministrativo,
    comisionesAproximadas,
    totalPagoAproximado,
    bonoSemanal: bonoMeta + bonoPuntualidad + bonoResenas + bonoManual - descuentoAdministrativo
  };
}

module.exports = {
  contarServiciosCita,
  calcularPuntualidadCita,
  calcularMetricasEmpleado,
  calcularBonosEmpleado,
  calcularComisiones,
  obtenerRangoSemana,
  calcularMetaSemanalMxn,
  calcularScoreSemanal,
  calcularBonoSemanal
};
