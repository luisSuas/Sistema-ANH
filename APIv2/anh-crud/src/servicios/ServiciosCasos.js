import api from "./Servicios";

/**
 * Crea un caso en borrador para la víctima indicada o reutiliza el borrador existente.
 * Devuelve { id, reused }.
 */
export async function crearOBuscarBorrador(victima_id, payload = {}) {
  // Simplificado: el backend ya es idempotente. POST crea o reutiliza borrador.
  const { data } = await api.post("/casos", { victima_id, ...payload });
  return { id: data.id, reused: !!data.reused };
}
