// src/servicios/Servicios.js
import axios from "axios";

/** ─────────────────────────────────────────────────────────
 * BASE URL ROBUSTA (evita /apiv2/apiv2)
 * ───────────────────────────────────────────────────────── */
(function warnMissingEnv() {
  if (!process.env.REACT_APP_API_URL) {
    // console.warn("REACT_APP_API_URL no definida. Usando http://localhost:8800");
  }
})();

const RAW = (process.env.REACT_APP_API_URL || "http://localhost:8800").trim();

function normalizeHost(raw) {
  let host = raw;
  if (host.startsWith(":")) host = `localhost${host}`; // ":8800" -> "localhost:8800"
  if (!/^https?:\/\//i.test(host)) host = `http://${host}`; // sin protocolo -> http://
  return host.replace(/\/$/, ""); // sin slash final
}

// ✅ Si el env ya trae /apiv2, lo quitamos para no duplicar
function stripApiV2(host) {
  return String(host || "").replace(/\/apiv2\/?$/i, "");
}

const API_HOST = stripApiV2(normalizeHost(RAW));
const BASE_URL = `${API_HOST}/apiv2`;

/** Instancia central de axios */
const api = axios.create({
  baseURL: BASE_URL,
  timeout: 30000, // ✅ evita requests colgadas eternamente
});

/* =========================================================
   TOKEN (única fuente de verdad + listeners anti-bucle)
   ========================================================= */
let _token =
  (() => {
    try {
      return localStorage.getItem("access_token") || null;
    } catch {
      return null;
    }
  })();

if (_token) {
  // header inicial si ya había sesión
  api.defaults.headers.common["Authorization"] = `Bearer ${_token}`;
}

const tokenListeners = new Set();

/** Devuelve el token actual (o null) */
export function getToken() {
  return _token;
}

/** Suscribirse a cambios de token (no llamar setToken dentro del callback) */
export function onTokenChanged(fn) {
  tokenListeners.add(fn);
  return () => tokenListeners.delete(fn);
}

/** Fija el token de manera segura (sin bucles) */
export function setToken(nextToken) {
  const t = typeof nextToken === "string" && nextToken.trim() ? nextToken : null;

  // ⚠️ evita recursión si no cambió
  if (_token === t) return;

  _token = t;

  // persistencia
  try {
    if (t) localStorage.setItem("access_token", t);
    else localStorage.removeItem("access_token");
  } catch {}

  // header global
  if (t) api.defaults.headers.common["Authorization"] = `Bearer ${t}`;
  else delete api.defaults.headers.common["Authorization"];

  // notificar (misma pestaña)
  tokenListeners.forEach((fn) => {
    try {
      fn(_token);
    } catch {}
  });

  // compat: evento DOM para código legacy que ya escuchaba esto
  try {
    window.dispatchEvent(new Event("auth-token-changed"));
  } catch {}
}

/** Sincroniza entre pestañas */
try {
  window.addEventListener("storage", (e) => {
    if (e.key === "access_token") {
      setToken(e.newValue || null);
    }
  });
} catch {}

/* ==========================
   Helpers
   ========================== */

// ✅ JWT usa base64url: atob puede fallar con '-' '_' y padding
function base64UrlToBase64(input = "") {
  let s = String(input).replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  return s;
}

function decodeJWT(tkn) {
  try {
    const part = String(tkn).split(".")[1];
    if (!part) return null;
    const payload = JSON.parse(atob(base64UrlToBase64(part)));
    return payload || null;
  } catch {
    return null;
  }
}

export function whoAmI() {
  if (!_token) return null;
  const p = decodeJWT(_token);
  if (!p) return null;
  return { id: p.sub, nombre: p.name, role: p.role, area: p.area, exp: p.exp };
}

/* ==========================
   Interceptores
   ========================== */
api.interceptors.request.use((cfg) => {
  if (_token) {
    cfg.headers = cfg.headers || {};
    cfg.headers.Authorization = `Bearer ${_token}`;
  }
  return cfg;
});

api.interceptors.response.use(
  (r) => r,
  (err) => {
    const status = err?.response?.status;
    const url = String(err?.config?.url || "");

    // No dispares logout/redirect si el 401 viene del propio login
    const isAuthLogin = url.includes("/auth/login");

    if (status === 401 && !isAuthLogin) {
      setToken(null);
      if (window.location.pathname !== "/login") {
        window.location.href = "/login";
      }
    } else if (status === 403) {
      // 403 = sin permisos; NO cerrar sesión
      console.warn("[API] 403 Forbidden en:", url);
    }

    return Promise.reject(err);
  }
);

/* ==========================
   AUTH
   ========================== */
/**
 * Login con soporte MFA (otp opcional).
 * - Si el backend responde { code: 'MFA_REQUIRED' } ó 401 con ese code,
 *   lanzamos un error con { code: 'MFA_REQUIRED' } para que el UI pida el OTP.
 */
export async function login(username, password, otp) {
  try {
    const { data } = await api.post("/auth/login", { username, password, otp });
    if (data?.code === "MFA_REQUIRED") {
      const e = new Error("MFA requerido");
      e.code = "MFA_REQUIRED";
      throw e;
    }
    if (data?.token) setToken(data.token);
    const p = decodeJWT(data?.token);
    return { id: p?.sub, nombre: p?.name, role: p?.role, area: p?.area };
  } catch (err) {
    throw err;
  }
}

export function logout() {
  setToken(null);
}

/* ==========================
   Recuperación de contraseña
   ========================== */
export async function requestPasswordReset(email) {
  const { data } = await api.post("/auth/request-password-reset", { email });
  return data; // { ok: true }
}

export async function validateResetToken(tokenStr) {
  const { data } = await api.get("/auth/validate-reset-token", {
    params: { token: tokenStr },
  });
  return data; // { valid: boolean }
}

export async function resetPassword(tokenStr, password) {
  const { data } = await api.post("/auth/reset-password", {
    token: tokenStr,
    password,
  });
  return data; // { ok: true }
}

/* ==========================
   CATÁLOGOS (públicos)
   ========================== */
export const getCatalogo = (cat) => api.get(`/catalogos/${cat}`);

/* ==========================
   USUARIOS (PROTECTED - legacy)
   ========================== */
export const getUsuarios = () => api.get("/usuarios");
export const getUsuarioById = (id) => api.get(`/usuarios/${id}`);
export const createUsuario = (payload) =>
  api.post("/usuarios", payload, { headers: { "Content-Type": "application/json" } });
export const updateUsuario = (id, payload) =>
  api.put(`/usuarios/${id}`, payload, { headers: { "Content-Type": "application/json" } });
export const deleteUsuario = (id) => api.delete(`/usuarios/${id}`);

/* ==========================
   VÍCTIMAS (PROTECTED)
   ========================== */
export const getVictimas = () => api.get("/victimas");
export const getVictimaById = (id) => api.get(`/victimas/${id}`);
export const createVictima = (payload) =>
  api.post("/victimas", payload, { headers: { "Content-Type": "application/json" } });
export const updateVictima = (id, payload) =>
  api.put(`/victimas/${id}`, payload, { headers: { "Content-Type": "application/json" } });
export const deleteVictima = (id) => api.delete(`/victimas/${id}`);

/* ==========================
   FICHAS (PROTECTED)
   ========================== */
export const getFichas = () => api.get("/fichas");
export const getFichaById = (id) => api.get(`/fichas/${id}`);
export const createFicha = (payload) =>
  api.post("/fichas", payload, { headers: { "Content-Type": "application/json" } });
export const updateFicha = (id, payload) =>
  api.put(`/fichas/${id}`, payload, { headers: { "Content-Type": "application/json" } });
export const deleteFicha = (id) => api.delete(`/fichas/${id}`);

/* ==========================
   AGRESORES (PROTECTED)
   ========================== */
export const getAgresores = () => api.get("/agresores");
export const getAgresorById = (id) => api.get(`/agresores/${id}`);
export const createAgresor = (payload) =>
  api.post("/agresores", payload, { headers: { "Content-Type": "application/json" } });
export const updateAgresor = (id, payload) =>
  api.put(`/agresores/${id}`, payload, { headers: { "Content-Type": "application/json" } });
export const deleteAgresor = (id) => api.delete(`/agresores/${id}`);

/* ==========================
   HIJOS (PROTECTED)
   ========================== */
export const getHijos = () => api.get("/hijos");
export const getHijoById = (id) => api.get(`/hijos/${id}`);
export const createHijo = (payload) =>
  api.post("/hijos", payload, { headers: { "Content-Type": "application/json" } });
export const updateHijo = (id, payload) =>
  api.put(`/hijos/${id}`, payload, { headers: { "Content-Type": "application/json" } });
export const deleteHijo = (id) => api.delete(`/hijos/${id}`);

/* ==========================
   CASOS (PROTECTED)
   ========================== */
export const getCasos = () => api.get("/casos");
export const getCasoById = (id) => api.get(`/casos/${id}`);

function sanitizeCasoPayload(payload = {}) {
  try {
    // ✅ Mantengo esto igual para NO romper su UI actual.
    //    (Usted ya tiene backend nuevo, pero esto sigue siendo compatible.)
    const omit = new Set([
      "hijos",
      "agresores",
    ]);
    const clean = { ...payload };
    for (const k of omit) if (k in clean) delete clean[k];
    return clean;
  } catch {
    return payload;
  }
}

export const createCaso = (payload) =>
  api.post("/casos", sanitizeCasoPayload(payload), {
    headers: { "Content-Type": "application/json" },
  });

export const updateCaso = (id, payload) =>
  api.put(`/casos/${id}`, sanitizeCasoPayload(payload), {
    headers: { "Content-Type": "application/json" },
  });

export const deleteCaso = (id) => api.delete(`/casos/${id}`);

// Flujo de estados / acciones
export const enviarRevision = (id) => api.post(`/casos/${id}/enviar-revision`);
export const validarCaso = (id) => api.post(`/casos/${id}/validar`);
export const enProgreso = (id) => api.post(`/casos/${id}/en-progreso`);
export const completarCaso = (id) => api.post(`/casos/${id}/completar`);

// Compat (legacy)
export const aprobarCaso = (id) => api.post(`/casos/${id}/aprobar`);
export const enviarCaso = (id) => api.post(`/casos/${id}/enviar`);
export const enviarLegacy = (id) => api.post(`/casos/${id}/enviar-legacy`);

// Historial y asignación
export const getHistorialCaso = (id) => api.get(`/casos/${id}/historial`);
export const asignarCaso = (id, operador_id) =>
  api.post(`/casos/${id}/asignar`, { operador_id });

/* ==========================
   INFORMES (PROTECTED)
   ========================== */
export const getInformeGeneral = (params = {}) =>
  api.get("/informes/general", { params });

/** Ruta clásica que ya usabas */
export const getInformeResumen = (params = {}) =>
  api.get("/informes/resumen", { params });

/**
 * NUEVO opcional: intenta varias rutas comunes para "Resumen por área"
 * Úsalo si tu backend no expone exactamente /informes/resumen
 */
export async function getInformeResumenSmart(params = {}) {
  const candidates = [
    "/informes/resumen",
    "/informes/resumen-por-area",
    "/informes/resumen_por_area",
    "/informes/por-area",
  ];
  for (const path of candidates) {
    try {
      const { data } = await api.get(path, { params });
      return data;
    } catch (e) {
      if (e?.response?.status !== 404) throw e;
    }
  }
  const err = new Error("No se encontró el endpoint de Resumen por área (404).");
  err.code = "NOT_FOUND";
  throw err;
}

/* ========================================================================== *
 *                          ADMIN PANEL (PROTECTED)
 * ========================================================================== */
export const adminCreateUser = (payload) =>
  api.post("/admin/create-user", payload, {
    headers: { "Content-Type": "application/json" },
  });

export const adminGetUsers = (q = "") =>
  api.get("/admin/users", q ? { params: { q } } : undefined);

export const adminGetUserById = (id) => api.get(`/admin/users/${id}`);

export const adminUpdateUser = (id, payload) =>
  api.put(`/admin/users/${id}`, payload, {
    headers: { "Content-Type": "application/json" },
  });

export const adminDeleteUser = (id) => api.delete(`/admin/users/${id}`);

/* ─────────────────────────────────────────────────────────────
 * ✅ NUEVOS HELPERS (NO ROMPEN NADA EXISTENTE)
 *     Para lo que ya implementó en backend /apiv2
 * ───────────────────────────────────────────────────────────── */

// 1) Búsqueda liviana para selects/autocomplete (Operativa)
export const getVictimasOperativa = (params = {}) =>
  api.get("/operativa/victimas", { params });
// Ej: getVictimasOperativa({ q: 'ana', limit: 50, offset: 0 })

// 2) Draft por víctima (idempotente)
export const getCasoDraft = (victima_id) =>
  api.get("/casos/draft", { params: { victima_id } });

// 3) Devolver caso (pendiente -> borrador) con motivo
export const devolverCaso = (id, motivo = "") =>
  api.post(`/casos/${id}/devolver`, { motivo });

// 4) Guardar detalle + completar (opción B que agregó)
export const detalleYCompletarCaso = (id, payload) =>
  api.put(`/casos/${id}/detalle-y-completar`, payload, {
    headers: { "Content-Type": "application/json" },
  });

/**
 * ✅ Si usted quiere actualizar el caso con relaciones (hijos/agresores/pivotes)
 * sin que sanitizeCasoPayload se lo borre, use esto (nuevo, sin afectar lo viejo):
 */
export const updateCasoFull = (id, payload) =>
  api.put(`/casos/${id}`, payload, {
    headers: { "Content-Type": "application/json" },
  });

export default api;
