import React, { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import api from "../servicios/Servicios";
import "./Victimas.css"; // estilos del módulo

function Victimas() {
  const nav = useNavigate();

  // Listado / búsqueda
  const [lista, setLista] = useState([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");
  const [q, setQ] = useState("");

  // Formulario (ampliado con dirección, origen, etc.)
  const [vForm, setVForm] = useState({
    nombres: "",
    apellidos: "",
    sexo: "F",
    fecha_nacimiento: "",
    dpi: "",
    telefono: "",
    direccion: "",                // <- se mapeará a direccion_actual en el backend
    residencia: "",               // <- texto libre (extra.residencia_texto)
    lugar_origen: "",             // <- “Municipio, Departamento” o ID
    municipio_residencia_id: "",  // <- opcional (numérico)
    nacionalidad: "",             // <- opcional si tu tabla lo tiene
  });
  const [creando, setCreando] = useState(false);
  const [victimaId, setVictimaId] = useState(null);
  const [msgForm, setMsgForm] = useState("");

  useEffect(() => {
    fetchVictimas();
  }, []);

  async function fetchVictimas() {
    setLoading(true);
    setMsg("");
    try {
      const { data } = await api.get("/victimas");
      setLista(Array.isArray(data) ? data : []);
    } catch {
      setMsg("No se pudieron cargar las sobrevivientes.");
    } finally {
      setLoading(false);
    }
  }

  function onChange(e) {
    const { name, value } = e.target;
    setVForm((f) => ({ ...f, [name]: value }));
  }

  async function registrarVictima(e) {
    e.preventDefault();
    if (creando) return;

    setMsgForm("");
    setVictimaId(null);

    // Validación mínima
    if (!vForm.nombres.trim() || !vForm.apellidos.trim()) {
      setMsgForm("Ingresa nombres y apellidos.");
      return;
    }

    // Partir nombres/apellidos
    const { pn, sn, pa, sa } = splitNombre(vForm.nombres, vForm.apellidos);
    const nombreCompleto = [vForm.nombres.trim(), vForm.apellidos.trim()]
      .filter(Boolean)
      .join(" ");

    setCreando(true);
    try {
      // Payload alineado al backend
      const payload = {
        primer_nombre: pn,
        segundo_nombre: sn || null,
        primer_apellido: pa,
        segundo_apellido: sa || null,
        nombre: nombreCompleto || null,
        sexo: vForm.sexo || null,
        fecha_nacimiento: vForm.fecha_nacimiento || null,
        dpi: emptyToNull(vForm.dpi),
        telefono: emptyToNull(vForm.telefono),

        // Campos nuevos
        direccion: emptyToNull(vForm.direccion), // backend la mapea a direccion_actual
        residencia: emptyToNull(vForm.residencia), // va a extra.residencia_texto si no hay columna
        lugar_origen: emptyToNull(vForm.lugar_origen), // backend intenta resolver a municipio_origen_id
        nacionalidad: emptyToNull(vForm.nacionalidad),
      };

      // Si capturan ID de municipio de residencia, mandarlo como número
      if (String(vForm.municipio_residencia_id).trim() !== "") {
        const n = Number(vForm.municipio_residencia_id);
        if (Number.isFinite(n)) {
          payload.municipio_residencia_id = n;
        }
      }

      const { data } = await api.post("/victimas", payload, {
        headers: { "Content-Type": "application/json" },
      });

      const id = data?.id;
      setVictimaId(id || null);
      setMsgForm(id ? `Sobreviviente creada con ID #${id}.` : "Sobreviviente creada.");

      // refresca listado
      fetchVictimas();
    } catch (e) {
      const detail = e?.response?.data?.detail || "";
      if (detail.toLowerCase().includes("dpi")) {
        setMsgForm("El DPI ya existe o no es válido.");
      } else {
        setMsgForm(e?.response?.data?.error || "No se pudo registrar la sobreviviente.");
      }
    } finally {
      setCreando(false);
    }
  }

  function registrarOtra() {
    setVForm({
      nombres: "",
      apellidos: "",
      sexo: "F",
      fecha_nacimiento: "",
      dpi: "",
      telefono: "",
      direccion: "",
      residencia: "",
      lugar_origen: "",
      municipio_residencia_id: "",
      nacionalidad: "",
    });
    setVictimaId(null);
    setMsgForm("");
  }

  const filtradas = useMemo(() => {
    if (!q) return lista;
    const s = q.toLowerCase();
    return lista.filter((v) => JSON.stringify(v).toLowerCase().includes(s));
  }, [lista, q]);

  return (
    <div className="social-main">
      <header className="social-topbar">
        <h1>Sobrevivientes</h1>
        <div className="topbar-actions">
          <Link to="/social" className="btn-secondary">← Volver al panel</Link>
        </div>
      </header>

      <div className="social-content">
        {msg && <div className="alert-info">{msg}</div>}

        {/* Registrar sobreviviente */}
        <section className="card">
          <div className="card-header">
            <h3>Registrar sobreviviente</h3>
            <div className="card-actions">
              {victimaId && (
                <button
                  className="btn-primary"
                  onClick={() => nav(`/social/casos/nuevo?victima_id=${victimaId}`)}
                >
                  Crear proceso con ID #{victimaId}
                </button>
              )}
            </div>
          </div>

          {msgForm && <div className="alert-info">{msgForm}</div>}

          <form onSubmit={registrarVictima}>
            {/* fila 1: nombre, apellidos, sexo */}
            <div className="form-row">
              <input
                className="input"
                name="nombres"
                placeholder="Nombres"
                value={vForm.nombres}
                onChange={onChange}
                required
              />
              <input
                className="input"
                name="apellidos"
                placeholder="Apellidos"
                value={vForm.apellidos}
                onChange={onChange}
                required
              />
              <select
                className="input"
                name="sexo"
                value={vForm.sexo}
                onChange={onChange}
              >
                <option value="F">Femenino</option>
                <option value="M">Masculino</option>
              </select>
            </div>

            {/* fila 2: fecha, dpi, teléfono */}
            <div className="form-row">
              <div className="form-item">
                <label className="small-label">Fecha de nacimiento</label>
                <input
                  className="input"
                  type="date"
                  name="fecha_nacimiento"
                  value={vForm.fecha_nacimiento}
                  onChange={onChange}
                />
              </div>
              <div className="form-item">
                <label className="small-label">DPI (opcional)</label>
                <input
                  className="input"
                  name="dpi"
                  value={vForm.dpi}
                  onChange={onChange}
                  placeholder="DPI (opcional)"
                />
              </div>
              <div className="form-item">
                <label className="small-label">Teléfono</label>
                <input
                  className="input"
                  name="telefono"
                  value={vForm.telefono}
                  onChange={onChange}
                  placeholder="Teléfono"
                />
              </div>
            </div>

            {/* fila 3: dirección, residencia, nacionalidad */}
            <div className="form-row">
              <div className="form-item">
                <label className="small-label">Dirección</label>
                <input
                  className="input"
                  name="direccion"
                  value={vForm.direccion}
                  onChange={onChange}
                  placeholder="Ej. 2 Calle Zona 3"
                />
              </div>
              <div className="form-item">
                <label className="small-label">Residencia (barrio/colonia/aldea)</label>
                <input
                  className="input"
                  name="residencia"
                  value={vForm.residencia}
                  onChange={onChange}
                  placeholder="Ej. Colonia La Floresta"
                />
              </div>
              <div className="form-item">
                <label className="small-label">Nacionalidad</label>
                <input
                  className="input"
                  name="nacionalidad"
                  value={vForm.nacionalidad}
                  onChange={onChange}
                  placeholder="Ej. Guatemalteca"
                />
              </div>
            </div>

            {/* fila 4: lugar de origen, municipio residencia ID */}
            <div className="form-row">
              <div className="form-item">
                <label className="small-label">Lugar de origen</label>
                <input
                  className="input"
                  name="lugar_origen"
                  value={vForm.lugar_origen}
                  onChange={onChange}
                  placeholder="Ej. Cobán, Alta Verapaz (o ID de municipio)"
                />
                <small className="small-help">
                  Puedes escribir “Municipio, Departamento” o un ID numérico.
                </small>
              </div>
              <div className="form-item">
                <label className="small-label">Municipio de residencia (ID)</label>
                <input
                  className="input"
                  name="municipio_residencia_id"
                  value={vForm.municipio_residencia_id}
                  onChange={onChange}
                  placeholder="ID (opcional)"
                />
              </div>
              <div className="form-item" />
            </div>

            <div className="card-actions" style={{ marginTop: 8 }}>
              <button className="btn-primary" disabled={creando}>
                {creando ? "Guardando…" : "Registrar sobreviviente"}
              </button>
              {victimaId && (
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={registrarOtra}
                >
                  Registrar otra
                </button>
              )}
            </div>
          </form>
        </section>

        {/* Búsqueda + listado básico */}
        <section className="card">
          <div className="card-header">
            <h3>Listado</h3>
            <input
              className="input"
              placeholder="Buscar por nombre/dpi/teléfono…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>

          {loading ? (
            <div className="pad">Cargando…</div>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Nombre</th>
                    <th>DPI</th>
                    <th>Teléfono</th>
                    <th>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {filtradas.length === 0 && (
                    <tr>
                      <td className="td-center" colSpan={5}>
                        Sin resultados
                      </td>
                    </tr>
                  )}
                  {filtradas.map((v) => (
                    <tr key={v.id}>
                      <td>{v.id}</td>
                      <td>
                        {v.nombre ||
                          [v.primer_nombre, v.segundo_nombre, v.primer_apellido, v.segundo_apellido]
                            .filter(Boolean)
                            .join(" ") ||
                          "-"}
                      </td>
                      <td>{v.dpi || "-"}</td>
                      <td>{v.telefono || "-"}</td>
                      <td>
                        <button
                          className="btn-secondary"
                          onClick={() =>
                            nav(`/social/casos/nuevo?victima_id=${v.id}`)
                          }
                        >
                          Nuevo proceso
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

/* ===== Helpers ===== */
function emptyToNull(v) {
  const s = String(v ?? "").trim();
  return s ? s : null;
}

/**
 * Divide textos “Nombres” y “Apellidos” en primer/segundo.
 * Ej: "Ana María" -> pn="Ana", sn="María"
 *     "De León López" -> pa="De", sa="León López"
 */
function splitNombre(nombres, apellidos) {
  const ns = String(nombres || "").trim().split(/\s+/).filter(Boolean);
  const as = String(apellidos || "").trim().split(/\s+/).filter(Boolean);
  return {
    pn: ns[0] || null,
    sn: ns.slice(1).join(" ") || null,
    pa: as[0] || null,
    sa: as.slice(1).join(" ") || null,
  };
}

export default Victimas;
