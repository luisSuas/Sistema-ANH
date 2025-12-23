// src/servicios/VictimasLista.js
import React, { useState, useEffect, useMemo } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import api from "../servicios/Servicios";
import "./VictimasLista.css";

// ===== Helper de área por ruta (se deja igual por compatibilidad)
function inferAreaFromPath(pathname = "") {
  const p = String(pathname || "").toLowerCase();
  if (p.includes("/medica")) return "medica";
  if (p.includes("/social")) return "social";
  if (p.includes("/legal")) return "legal";
  if (p.includes("/psicologica")) return "psicologica";
  if (p.includes("/albergue")) return "albergue";
  return null;
}
function normalizeAreaSlug(area) {
  if (area == null) return "social";
  const s = String(area).trim().toLowerCase();
  if (/^\d+$/.test(s)) {
    const n = parseInt(s, 10);
    return ({ 1: "social", 2: "legal", 3: "medica", 4: "psicologica", 5: "albergue" }[n]) || "social";
  }
  const map = {
    social: "social", s: "social", soc: "social",
    legal: "legal", l: "legal",
    medica: "medica", "médica": "medica", m: "medica", med: "medica",
    psicologica: "psicologica", "psicológica": "psicologica", psi: "psicologica", p: "psicologica",
    albergue: "albergue", a: "albergue",
  };
  return map[s] || "social";
}

// Usa el endpoint del backend filtrado por el área del usuario (JWT) y/o la ruta
async function getVictimasOperativa({ q = "", limit = 50, offset = 0, areaHint = null } = {}) {
  const params = { limit, offset };
  if (q && q.trim()) params.q = q.trim();
  if (areaHint) params.area = String(areaHint).toLowerCase();
  return api.get(`/operativa/victimas`, { params }); // { data: { ok, data: [...] } }
}

function VictimasLista() {
  const navigate = useNavigate();
  const location = useLocation();

  const [victimas, setVictimas] = useState([]);
  const [mostrar, setMostrar] = useState(() =>
    (typeof sessionStorage !== 'undefined' && sessionStorage.getItem('vl_mostrar') === '1')
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [q, setQ] = useState(() =>
    (typeof sessionStorage !== 'undefined' && sessionStorage.getItem('vl_q')) || ""
  );
  const [busyId, setBusyId] = useState(null);

  const [borradores, setBorradores] = useState({});
  const [activos, setActivos] = useState({});
  const [notasDev, setNotasDev] = useState({});
  const [modal, setModal] = useState({ open:false, texto:"", victimaId:null });

  // ====== FORZAR ÁREA SOCIAL ======
  const FORCED_AREA = "social";
  const areaForQuery = FORCED_AREA;
  const areaSlug = FORCED_AREA;
  const areaBase = `/${FORCED_AREA}`;

  useEffect(() => {
    if (!mostrar) return;

    let alive = true;
    (async () => {
      setLoading(true);
      setError("");
      try {
        const { data } = await getVictimasOperativa({ q, areaHint: areaForQuery });
        const lista = Array.isArray(data?.data) ? data.data : [];
        if (!alive) return;
        setVictimas(lista);

        try {
          const respCasos = await api.get(`/casos`).catch(() => ({ data: [] }));
          const listaCasos = Array.isArray(respCasos?.data) ? respCasos.data : [];
          const mapActivos = {};
          const mapBorradores = {};

          for (const c of listaCasos) {
            const vId = c?.victima_id;
            if (!vId) continue;
            const estado = String(c?.estado || "").toLowerCase();

            if (estado === 'borrador') {
              const prev = mapBorradores[vId];
              if (!prev || Number(c.id) > Number(prev)) mapBorradores[vId] = c.id;
            }

            const cur = mapActivos[vId];
            const esAbierto = estado !== "completado";
            const curEsAbierto = cur && String(cur.estado || "").toLowerCase() !== "completado";

            if (!cur) {
              mapActivos[vId] = { id: c.id, estado };
            } else if (esAbierto && !curEsAbierto) {
              mapActivos[vId] = { id: c.id, estado };
            } else if (Number(c.id) > Number(cur.id)) {
              mapActivos[vId] = { id: c.id, estado };
            }
          }

          setActivos(mapActivos);
          setBorradores(mapBorradores);

          try { await cargarNotasDevolucion(mapBorradores); } catch {}
        } catch {}
      } catch (err) {
        const msg = err?.response?.data?.error || "No se pudieron cargar las sobrevivientes";
        setError(msg);
        console.error("Error al obtener las sobrevivientes:", err);
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => { alive = false; };
  }, [location.key, mostrar, q, areaForQuery]);

  const handleClick = () => {
    setMostrar(true);
    try { sessionStorage.setItem('vl_mostrar', '1'); } catch {}
  };

  useEffect(() => {
    try { sessionStorage.setItem('vl_mostrar', mostrar ? '1' : '0'); } catch {}
  }, [mostrar]);
  useEffect(() => {
    try { sessionStorage.setItem('vl_q', q || ''); } catch {}
  }, [q]);

  const irACrearONavegar = async (victima_id) => {
    if (!victima_id) return;
    setBusyId(victima_id);

    try {
      const activo = activos[victima_id];
      if (activo && activo.id) {
        navigate(`${areaBase}/casos/${activo.id}`);
        return;
      }

      const borrId = borradores[victima_id] ?? null;

      if (borrId) {
        navigate(`${areaBase}/casos/${borrId}`);
      } else {
        navigate(`${areaBase}/casos/nuevo?victima_id=${victima_id}`);
      }
    } finally {
      setBusyId(null);
    }
  };

  const goBackHome = () => {
    navigate(areaBase); // /social
  };

  async function cargarNotasDevolucion(mapBorradores) {
    const entries = Object.entries(mapBorradores || {});
    if (!entries.length) { setNotasDev({}); return; }
    const pairs = await Promise.all(entries.map(async ([victimaId, borrId]) => {
      try {
        const { data } = await api.get(`/casos/${borrId}/historial`);
        const hist = Array.isArray(data) ? data : [];
        const dev = [...hist].reverse().find(h => {
          const hasta = String(h?.estado_hasta || '').toLowerCase();
          const desde = String(h?.estado_desde || '').toLowerCase();
          const det = String(h?.detalle || '').toLowerCase();
          return hasta === 'borrador' && (desde === 'pendiente' || det.includes('devuelto'));
        });
        const detalle = (dev?.detalle || '').toString().trim();
        return [Number(victimaId), detalle];
      } catch {
        return [Number(victimaId), ''];
      }
    }));
    setNotasDev(Object.fromEntries(pairs));
  }

  const filtradas = q
    ? victimas.filter((v) =>
        JSON.stringify(v).toLowerCase().includes(q.toLowerCase())
      )
    : victimas;

  return (
    <div className="vl-page" style={{ paddingTop: 12 }}>
      {/* Encabezado */}
      <div className="vl-topbar" style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
        <button className="btn btn-volver" onClick={goBackHome} title="Volver al panel operativo">
          ← Volver
        </button>
        <h2 className="vl-title" style={{ margin: 0 }}>Listado de Sobrevivientes</h2>
      </div>

      {!mostrar && (
        <div className="boton-container" style={{ marginTop: 6 }}>
          <button className="boton-estadisticas" onClick={handleClick}>
            Ver listado de sobrevivientes
          </button>
        </div>
      )}

      {mostrar && (
        <div className="acciones-top" style={{ marginTop: 8 }}>
          <input
            className="input-buscar"
            placeholder="Buscar…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
      )}

      {loading && <p>Cargando sobrevivientes...</p>}
      {error && <p className="error">{error}</p>}

      {mostrar && !loading && (
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Nombre completo</th>
              <th>Teléfono</th>
              <th>Acciones</th>
            </tr>
          </thead>

          <tbody>
            {filtradas.length > 0 ? (
              filtradas.map((v, idx) => {
                const nombre = nombreCompletoVictima(v);
                const idVictima = v.id ?? idx;

                const borrId = borradores[v.id];
                const activo = (activos || {})[v.id];
                const estadoActivo = String(activo?.estado || "").toLowerCase();

                // ✅ (3) Mostrar estado BORRADOR cuando aplique (sin tocar tu lógica)
                const tieneBorrador = Boolean(borrId) || (activo?.id && estadoActivo === "borrador");

                return (
                  <tr key={idVictima}>
                    <td>{v.id}</td>
                    <td>{nombre || "-"}</td>
                    <td>{v.telefono || "-"}</td>

                    <td className="acciones-cell">
                      {/* ✅ (3) Badge borrador visible */}
                      {tieneBorrador && (
                        <span className="badge dot borrador" style={{ marginRight: 8 }}>
                          {prettyEstado("borrador")}
                        </span>
                      )}

                      {/* Si existe caso (y no es borrador), mostrar "Ver proceso" */}
                      {activo?.id && estadoActivo !== 'borrador' && (
                        <>
                          <span className={`badge dot ${estadoActivo}`} style={{ marginRight:8 }}>
                            {estadoActivo === 'pendiente' ? 'En revisión' : prettyEstado(estadoActivo)}
                          </span>
                          <button
                            className="btn-crear"
                            onClick={() => irACrearONavegar(v.id)}
                            disabled={busyId === v.id}
                            title={`Abrir proceso #${activo.id} — para: ${nombre}`}
                          >
                            {busyId === v.id ? 'Abriendo.' : 'Ver proceso'}
                          </button>
                        </>
                      )}

                      {/* Si NO hay proceso (o el “activo” es solo borrador) => Ver borrador / Crear proceso */}
                      <button
                        className="btn-crear"
                        style={{ display: (activo?.id && estadoActivo !== 'borrador') ? 'none' : undefined }}
                        onClick={() => irACrearONavegar(v.id)}
                        disabled={busyId === v.id}
                        title={
                          borrId
                            ? `Abrir borrador #${borrId} — para: ${nombre}`
                            : `Crear proceso — para: ${nombre}`
                        }
                      >
                        {busyId === v.id
                          ? "Abriendo…"
                          : borrId
                          ? "Ver borrador"
                          : "Crear proceso"}
                      </button>

                      {borrId && (notasDev[v.id] || '').trim() && (
                        <button
                          className="btn"
                          onClick={() => setModal({ open:true, texto:notasDev[v.id], victimaId:v.id })}
                          title="Ver motivo de devolución"
                        >
                          Motivo de devolución
                        </button>
                      )}

                      {borrId && (notasDev[v.id] || '').trim() && (
                        <div className="muted" style={{ marginTop: 6, maxWidth: 360 }} title={notasDev[v.id]}>
                          Motivo devolución: {String(notasDev[v.id]).slice(0, 120)}
                          {String(notasDev[v.id]).length > 120 ? '…' : ''}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })
            ) : (
              <tr>
                <td colSpan="4">No hay datos disponibles</td>
              </tr>
            )}
          </tbody>
        </table>
      )}

      {modal.open && (
        <div className="vl-modal-backdrop" onClick={() => setModal({ open:false, texto:"", victimaId:null })}>
          <div className="vl-modal" onClick={(e)=>e.stopPropagation()}>
            <header>
              <div>Motivo de devolución</div>
              <button className="close" onClick={() => setModal({ open:false, texto:"", victimaId:null })}>Cerrar</button>
            </header>
            <div className="body">
              {String(modal.texto || '').trim() || 'Sin detalle'}
            </div>
            <div className="actions">
              <button className="close" onClick={() => setModal({ open:false, texto:"", victimaId:null })}>Aceptar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ==========================
   Helpers
   ========================== */
function getAreaFromToken() {
  try {
    const t = localStorage.getItem("access_token");
    if (!t) return null;
    const payload = JSON.parse(atob(t.split(".")[1]));
    return payload.area ?? payload.area_id ?? null;
  } catch {
    return null;
  }
}

function prettyEstado(s){
  const m = { pendiente:'En revisión', en_progreso:'En progreso', validado:'Validado', enviado:'Enviado', completado:'Completado', borrador:'Borrador' };
  const k = String(s||'').toLowerCase();
  return m[k] || s || '-';
}

/**
 * Nombre completo robusto:
 * - Usa campos directos si existen.
 * - Si no, arma desde nombres/apellidos clásicos.
 */
function nombreCompletoVictima(v) {
  if (!v) return "-";

  const directo =
    v.nombre_completo ||
    v.nombreCompleto ||
    v.full_name ||
    v.nombre_full;

  if (directo && String(directo).trim()) return String(directo).trim();

  const estructurado = [
    v.primer_nombre,
    v.segundo_nombre,
    v.tercer_nombre,
    v.primer_apellido,
    v.segundo_apellido,
  ]
    .filter(Boolean)
    .map((x) => String(x).trim())
    .filter(Boolean);

  if (estructurado.length) return estructurado.join(" ").replace(/\s+/g, " ").trim();

  const simple = [v.nombre, v.apellido]
    .filter(Boolean)
    .map((x) => String(x).trim())
    .filter(Boolean);

  if (simple.length) return simple.join(" ").replace(/\s+/g, " ").trim();

  return "-";
}

export default VictimasLista;
