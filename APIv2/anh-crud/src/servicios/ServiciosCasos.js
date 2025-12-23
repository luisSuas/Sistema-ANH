// src/servicios/ServiciosCasos.js
import api from "./Servicios";

/** Normaliza a entero positivo o null */
function toPosInt(x) {
  const n = Number(x);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * Crea un caso en borrador para la víctima indicada o reutiliza el borrador existente.
 * Devuelve { id, reused }.
 *
 * ✅ No rompe su uso actual:
 *  - Si victima_id viene como "123" funciona.
 *  - Si victima_id no viene en el parámetro pero sí en payload, también funciona.
 */
export async function crearOBuscarBorrador(victima_id, payload = {}) {
  const vId = toPosInt(victima_id) ?? toPosInt(payload?.victima_id);
  if (!vId) {
    throw new Error("victima_id inválido o faltante");
  }

  // Evita que payload.victima_id sobrescriba al vId real
  const { victima_id: _omit, ...rest } = payload || {};

  // Backend idempotente: POST crea o reutiliza borrador.
  const { data } = await api.post("/casos", { victima_id: vId, ...rest });

  return { id: data.id, reused: !!data.reused };
}

/* ─────────────────────────────────────────────────────────────
 * Opcionales recomendados (no afectan lo que ya usa)
 * ───────────────────────────────────────────────────────────── */

/** Busca borrador existente para esta víctima en el área del usuario */
export async function obtenerBorradorPorVictima(victima_id) {
  const vId = toPosInt(victima_id);
  if (!vId) throw new Error("victima_id inválido");

  try {
    const { data } = await api.get("/casos/draft", { params: { victima_id: vId } });
    return data; // caso borrador
  } catch (e) {
    if (e?.response?.status === 404) return null; // no hay borrador
    throw e;
  }
}

/** Detalle del caso (ya viene expandido por tu fetchCasoCompleto) */
export async function obtenerCaso(id) {
  const casoId = toPosInt(id);
  if (!casoId) throw new Error("id inválido");
  const { data } = await api.get(`/casos/${casoId}`);
  return data;
}

/** Historial del caso */
export async function obtenerHistorialCaso(id) {
  const casoId = toPosInt(id);
  if (!casoId) throw new Error("id inválido");
  const { data } = await api.get(`/casos/${casoId}/historial`);
  return data;
}

/** Asignar caso a un operativo */
export async function asignarCaso(id, operador_id) {
  const casoId = toPosInt(id);
  const opId = toPosInt(operador_id);
  if (!casoId) throw new Error("id inválido");
  if (!opId) throw new Error("operador_id inválido");

  const { data } = await api.post(`/casos/${casoId}/asignar`, { operador_id: opId });
  return data;
}

/** Flujo estados */
export async function enviarRevision(id) {
  const casoId = toPosInt(id);
  if (!casoId) throw new Error("id inválido");
  const { data } = await api.post(`/casos/${casoId}/enviar-revision`);
  return data;
}

export async function validar(id) {
  const casoId = toPosInt(id);
  if (!casoId) throw new Error("id inválido");
  const { data } = await api.post(`/casos/${casoId}/validar`);
  return data;
}

export async function devolver(id, motivo = "") {
  const casoId = toPosInt(id);
  if (!casoId) throw new Error("id inválido");
  const { data } = await api.post(`/casos/${casoId}/devolver`, { motivo });
  return data;
}

export async function ponerEnProgreso(id) {
  const casoId = toPosInt(id);
  if (!casoId) throw new Error("id inválido");
  const { data } = await api.post(`/casos/${casoId}/en-progreso`);
  return data;
}

export async function completar(id) {
  const casoId = toPosInt(id);
  if (!casoId) throw new Error("id inválido");
  const { data } = await api.post(`/casos/${casoId}/completar`);
  return data;
}

/**
 * Opción B: guardar detalle + completar
 * Body: fecha_atencion, embarazo_semanas, hijos[], agresores[],
 *       tipos_violencia_ids[], medios_agresion_ids[], ref_interna_ids[], ref_externa_ids[]
 */
export async function detalleYCompletar(id, payload = {}) {
  const casoId = toPosInt(id);
  if (!casoId) throw new Error("id inválido");
  const { data } = await api.put(`/casos/${casoId}/detalle-y-completar`, payload, {
    headers: { "Content-Type": "application/json" },
  });
  return data;
}
