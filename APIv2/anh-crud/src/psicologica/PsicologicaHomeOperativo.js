// src/psicologica/PsicologicaHomeOperativo.jsx
import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, NavLink, Link } from 'react-router-dom';
import api, { setToken } from "../servicios/Servicios";
import './PsicologicaHomeOperativo.css';

function PsicologicaHome() {
  const navigate = useNavigate();

  // ======= Estado de casos (dashboard) =======
  const [casos, setCasos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState('');
  const [q, setQ] = useState('');
  const [estadoFiltro, setEstadoFiltro] = useState('');

  // Usuario desde el JWT
  const userFromToken = getUserFromToken();
  const [nuevo, setNuevo] = useState({
    victima_id: '',
    area_id: userFromToken?.area || 1,
  });

  const [kpis, setKpis] = useState({
    abiertos: 0,
    en_proceso: 0,
    cerrados: 0,
    total: 0,
  });
  // Notas de devolución para casos en borrador (id -> texto)
  const [notasDev, setNotasDev] = useState({});

  // ======= Form Registrar sobreviviente (ampliado) =======
  const [cat, setCat] = useState({ estados: [], escolaridades: [], etnias: [] });

  const [vForm, setVForm] = useState({
    nombres: '',
    apellidos: '',
    sexo: 'F',
    fecha_nacimiento: '',
    dpi: '',
    telefono: '',
    estado_civil_id: '',
    escolaridad_id: '',
    etnia_id: '',
    ocupacion: '',
    direccion: '',
    residencia: '',
    nacionalidad: '',
    lugar_origen: '',
  });
  const [creandoVictima, setCreandoVictima] = useState(false);
  const [victimaId, setVictimaId] = useState(null);
  const [msgVictima, setMsgVictima] = useState('');

  // Fecha legible en topbar
  const hoy = useMemo(
    () => new Date().toLocaleDateString('es-GT', { day:'2-digit', month:'2-digit', year:'numeric' }),
    []
  );

  // ======= Efectos: cargar casos + catálogos =======
  useEffect(() => { fetchCasos(); fetchCatalogos(); /* eslint-disable-next-line */ }, []);

  async function fetchCasos() {
    setLoading(true);
    setMsg('');
    try {
      const { data } = await api.get('/casos');
      const lista = Array.isArray(data) ? data : [];
      setCasos(lista);

      // cargar notas de devolución (si aplica)
      try { await cargarNotasDevolucion(lista); } catch {}

      const abiertos = lista.filter(c => norm(c.estado) !== 'completado').length;
      const enProceso = lista.filter(c => norm(c.estado) === 'en_progreso').length;
      const cerrados  = lista.filter(c => norm(c.estado) === 'completado').length;
      setKpis({ abiertos, en_proceso: enProceso, cerrados, total: lista.length });
    } catch (e) {
      if (e?.response?.status === 401) {
        setToken(null);
        navigate('/login');
        return;
      }
      setMsg('No se pudieron cargar los procesos');
    } finally {
      setLoading(false);
    }
  }

  // Carga la última nota de devolución desde el historial para los casos en borrador
  async function cargarNotasDevolucion(lista) {
    const ids = (lista || []).filter(c => norm(c.estado) === 'borrador').map(c => c.id);
    if (!ids.length) { setNotasDev({}); return; }
    const pairs = await Promise.all(ids.map(async (id) => {
      try {
        const { data } = await api.get(`/casos/${id}/historial`);
        const hist = Array.isArray(data) ? data : [];
        const dev = [...hist].reverse().find(h =>
          String(h?.estado_hasta || '').toLowerCase() === 'borrador'
        );
        const detalle = (dev?.detalle || '').toString().trim();
        return [id, detalle];
      } catch { return [id, '']; }
    }));
    setNotasDev(Object.fromEntries(pairs));
  }

  async function fetchCatalogos() {
    try {
      const [ec, es, et] = await Promise.all([
        api.get('/catalogos/estados-civiles'),
        api.get('/catalogos/escolaridades'),
        api.get('/catalogos/etnias'),
      ]);
      setCat({
        estados: Array.isArray(ec.data) ? ec.data : [],
        escolaridades: Array.isArray(es.data) ? es.data : [],
        etnias: Array.isArray(et.data) ? et.data : [],
      });
    } catch {
      // si falla, el formulario sigue funcionando con campos de texto
    }
  }

  // ======= Crear caso rápido (ya existe) =======
  async function crearCasoRapido(e) {
    e.preventDefault();
    setMsg('');
    try {
      const payload = {
        victima_id: Number(nuevo.victima_id),
        area_id: Number(nuevo.area_id),
      };
      const resp = await api.post('/casos', payload, { headers: { 'Content-Type': 'application/json' } });
      const id = resp?.data?.id;
      if (id) {
        navigate(`/psicologica/casos/${id}`);
      } else {
        setNuevo({ victima_id: '', area_id: userFromToken?.area || 1 });
        fetchCasos();
      }
    } catch (e) {
      setMsg(e?.response?.data?.error || 'No se pudo crear el proceso');
    }
  }

  // ======= Registrar sobreviviente (ampliado) =======
  function onVictimaChange(e) {
    const { name, value } = e.target;
    setVForm(f => ({ ...f, [name]: value }));
  }

  async function registrarVictima(e) {
    e.preventDefault();
    if (creandoVictima) return;

    setMsgVictima('');
    setVictimaId(null);

    if (!vForm.nombres.trim() || !vForm.apellidos.trim()) {
      setMsgVictima('Ingresa nombres y apellidos.');
      return;
    }

    const { pn, sn, pa, sa } = splitNombre(vForm.nombres, vForm.apellidos);
    const nombreCompleto = [vForm.nombres.trim(), vForm.apellidos.trim()].filter(Boolean).join(' ');

    setCreandoVictima(true);
    try {
      const payload = {
        // mapeo a columnas reales (tu backend también acepta alias, pero mapeamos claro)
        primer_nombre: pn,
        segundo_nombre: sn || null,
        primer_apellido: pa,
        segundo_apellido: sa || null,
        nombre: nombreCompleto || null,

        sexo: vForm.sexo || null,
        fecha_nacimiento: vForm.fecha_nacimiento || null,
        dpi: emptyToNull(vForm.dpi),
        telefono: emptyToNull(vForm.telefono),

        estado_civil_id: toIntOrNull(vForm.estado_civil_id),
        escolaridad_id: toIntOrNull(vForm.escolaridad_id),
        etnia_id: toIntOrNull(vForm.etnia_id),

        ocupacion: emptyToNull(vForm.ocupacion),
        direccion: emptyToNull(vForm.direccion),
        residencia: emptyToNull(vForm.residencia),
        nacionalidad: emptyToNull(vForm.nacionalidad),
        lugar_origen: emptyToNull(vForm.lugar_origen),
        // Alias para compatibilidad con columnas alternativas
        direccion_domicilio: emptyToNull(vForm.direccion),
        residencia_domicilio: emptyToNull(vForm.residencia),
        barrio_colonia: emptyToNull(vForm.residencia),
        lugar_de_origen: emptyToNull(vForm.lugar_origen),
      };

      const { data } = await api.post('/victimas', payload, {
        headers: { 'Content-Type': 'application/json' },
      });

      const id = data?.id;
      setVictimaId(id || null);
      setMsgVictima(id ? `Sobreviviente creada con ID #${id}.` : 'Sobreviviente creada.');
    } catch (e) {
      const detail = e?.response?.data?.detail || '';
      if (detail.toLowerCase().includes('dpi')) {
        setMsgVictima('El DPI ya existe o no es válido.');
      } else {
        setMsgVictima(e?.response?.data?.error || 'No se pudo registrar la sobreviviente.');
      }
    } finally {
      setCreandoVictima(false);
    }
  }

  function registrarOtraVictima() {
    setVForm({
      nombres: '',
      apellidos: '',
      sexo: 'F',
      fecha_nacimiento: '',
      dpi: '',
      telefono: '',
      estado_civil_id: '',
      escolaridad_id: '',
      etnia_id: '',
      ocupacion: '',
      direccion: '',
      residencia: '',
      nacionalidad: '',
      lugar_origen: '',
    });
    setVictimaId(null);
    setMsgVictima('');
  }

  // ======= Handlers UI =======
  function handleChangeCaso(e) {
    const { name, value } = e.target;
    setNuevo({ ...nuevo, [name]: value });
  }

  function logout() {
    setToken(null);
    navigate('/login');
  }

  // ======= Filtro cliente =======
  const casosFiltrados = useMemo(() => {
    let arr = [...casos];
    if (estadoFiltro) arr = arr.filter(c => norm(c.estado) === estadoFiltro);
    if (q) arr = arr.filter(c => JSON.stringify(c).toLowerCase().includes(q.toLowerCase()));
    return arr;
  }, [casos, q, estadoFiltro]);

  return (
    <div className="social-shell">
      {/* Sidebar */}
      <aside className="social-sidebar">
        <div className="social-brand">ANH · Psicológica</div>
        <nav className="social-nav">
          <NavItem to="/psicologica" label="Dashboard" />
          <NavItem to="/psicologica/victimas" label="Sobrevivientes" />
        </nav>
        <div className="social-userbox">
          <div className="social-userline">{userFromToken?.nombre || 'Usuario'}</div>
          <div className="social-userline small">
            Rol: {String(userFromToken?.role ?? '-')} · Área: {String(userFromToken?.area ?? '-')}
          </div>
          <button className="link-ghost" onClick={logout}>Salir</button>
        </div>
      </aside>

      {/* Main */}
      <div className="social-main">
        {/* Topbar */}
        <header className="social-topbar">
          <h1>Panel del Área Psicológica</h1>
          <div className="topbar-actions">
            <div className="muted">Hoy: {hoy}</div>
          </div>
        </header>

        <div className="social-content">
          {/* Mensaje global */}
          {msg && <div className="alert-info">{msg}</div>}

          {/* KPIs */}
          <section className="kpi-grid">
            <Kpi title="Procesos abiertos" value={kpis.abiertos} />
            <Kpi title="En curso" value={kpis.en_proceso} />
            <Kpi title="Cerrados" value={kpis.cerrados} />
            <Kpi title="Total" value={kpis.total} />
          </section>

          {/* ===== Registrar sobreviviente (AMPLIADO) ===== */}
          <section className="card">
            <div className="card-header">
              <h3>Registrar sobreviviente</h3>
              <div className="card-actions">
                {victimaId && (
                  <button
                    className="btn-primary"
                    onClick={() => navigate(`/psicologica/casos/nuevo?victima_id=${victimaId}`)}
                  >
                    Crear proceso con ID #{victimaId}
                  </button>
                )}
              </div>
            </div>

            {msgVictima && <div className="alert-info">{msgVictima}</div>}

            <form onSubmit={registrarVictima}>
              {/* fila 1: nombres/apellidos/sexo */}
              <div className="form-row">
                <input
                  className="input"
                  name="nombres"
                  placeholder="Nombres"
                  value={vForm.nombres}
                  onChange={onVictimaChange}
                  required
                />
                <input
                  className="input"
                  name="apellidos"
                  placeholder="Apellidos"
                  value={vForm.apellidos}
                  onChange={onVictimaChange}
                  required
                />
                <select
                  className="input"
                  name="sexo"
                  value={vForm.sexo}
                  onChange={onVictimaChange}
                >
                  <option value="F">Femenino</option>
                  <option value="M">Masculino</option>
                </select>
              </div>

              {/* fila 2: fecha/dpi/teléfono (con etiquetas pequeñas) */}
              <div className="form-row">
                <div className="form-item">
                  <label className="small-label">Fecha de nacimiento</label>
                  <input
                    className="input"
                    type="date"
                    name="fecha_nacimiento"
                    value={vForm.fecha_nacimiento}
                    onChange={onVictimaChange}
                  />
                </div>
                <div className="form-item">
                  <label className="small-label">DPI (opcional)</label>
                  <input
                    className="input"
                    name="dpi"
                    value={vForm.dpi}
                    onChange={onVictimaChange}
                    placeholder="DPI (opcional)"
                  />
                </div>
                <div className="form-item">
                  <label className="small-label">Teléfono</label>
                  <input
                    className="input"
                    name="telefono"
                    value={vForm.telefono}
                    onChange={onVictimaChange}
                    placeholder="Teléfono"
                  />
                </div>
              </div>

              {/* fila 3: selects demográficos */}
              <div className="form-row">
                <div className="form-item">
                  <label className="small-label">Estado civil</label>
                  <select
                    className="input"
                    name="estado_civil_id"
                    value={vForm.estado_civil_id}
                    onChange={onVictimaChange}
                  >
                    <option value="">— Selecciona —</option>
                    {cat.estados.map(e => (
                      <option key={e.id} value={e.id}>{e.nombre}</option>
                    ))}
                  </select>
                </div>
                <div className="form-item">
                  <label className="small-label">Escolaridad</label>
                  <select
                    className="input"
                    name="escolaridad_id"
                    value={vForm.escolaridad_id}
                    onChange={onVictimaChange}
                  >
                    <option value="">— Selecciona —</option>
                    {cat.escolaridades.map(e => (
                      <option key={e.id} value={e.id}>{e.nombre}</option>
                    ))}
                  </select>
                </div>
                <div className="form-item">
                  <label className="small-label">Etnia</label>
                  <select
                    className="input"
                    name="etnia_id"
                    value={vForm.etnia_id}
                    onChange={onVictimaChange}
                  >
                    <option value="">— Selecciona —</option>
                    {cat.etnias.map(e => (
                      <option key={e.id} value={e.id}>{e.nombre}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* fila 4: textos demográficos */}
              <div className="form-row">
                <div className="form-item">
                  <label className="small-label">Ocupación / Actividad</label>
                  <input className="input" name="ocupacion" value={vForm.ocupacion} onChange={onVictimaChange} placeholder="Ej. Comerciante" />
                </div>
                <div className="form-item">
                  <label className="small-label">Dirección</label>
                  <input className="input" name="direccion" value={vForm.direccion} onChange={onVictimaChange} placeholder="Dirección" />
                </div>
                <div className="form-item">
                  <label className="small-label">Residencia</label>
                  <input className="input" name="residencia" value={vForm.residencia} onChange={onVictimaChange} placeholder="Barrio / Colonia / Aldea" />
                </div>
              </div>

              {/* fila 5: textos extra */}
              <div className="form-row">
                <div className="form-item">
                  <label className="small-label">Nacionalidad</label>
                  <input className="input" name="nacionalidad" value={vForm.nacionalidad} onChange={onVictimaChange} placeholder="Guatemalteca, ..." />
                </div>
                <div className="form-item">
                  <label className="small-label">Lugar de origen</label>
                  <input className="input" name="lugar_origen" value={vForm.lugar_origen} onChange={onVictimaChange} placeholder="Departamento/Municipio" />
                </div>
                <div className="form-item">{/* hueco para mantener 3 columnas */}</div>
              </div>

              <div className="card-actions" style={{ marginTop: 8 }}>
                <button className="btn-primary" disabled={creandoVictima}>
                  {creandoVictima ? 'Guardando…' : 'Registrar sobreviviente'}
                </button>
                {victimaId && (
                  <button type="button" className="btn-secondary" onClick={registrarOtraVictima}>
                    Registrar otra
                  </button>
                )}
              </div>
            </form>

            <div className="muted mt-2">
              Luego de registrar, puedes crear el proceso con el botón de arriba (se pasa el ID automáticamente).
            </div>
          </section>

          {/* ===== Nuevo proceso (atajo) ===== */}
          <section className="card">
            <div className="card-header">
              <h3>Nuevo proceso</h3>
              <div className="card-actions">
                <Link to="/psicologica/casos/nuevo" className="btn-primary">+ Nuevo proceso</Link>
              </div>
            </div>

            <details className="details-quick">
              <summary className="summary-quick">Atajo rápido (ID de sobreviviente y área)</summary>
              <div className="quick-body">
                <form className="form-row" onSubmit={crearCasoRapido}>
                  <input name="victima_id" value={nuevo.victima_id} onChange={handleChangeCaso} placeholder="sobreviviente_id" required />
                  <input name="area_id" value={nuevo.area_id} onChange={handleChangeCaso} placeholder="area_id" required />
                  <button className="btn-primary">Crear</button>
                </form>
                <div className="muted">
                  ¿No recuerdas el ID? <Link className="link" to="/psicologica/victimas">Ver sobrevivientes / copiar ID</Link>
                </div>
              </div>
            </details>
          </section>

          {/* ===== Búsqueda + tabla ===== */}
          <section className="card">
            <div className="card-header">
              <h3>Procesos recientes</h3>
              <div className="card-header-right">
                <select className="input" value={estadoFiltro} onChange={(e)=>setEstadoFiltro(e.target.value)}>
                  <option value="">Todos los estados</option>
                  <option value="pendiente">Pendiente</option>
                  <option value="en_progreso">En progreso</option>
                  <option value="validado">Validado</option>
                  <option value="enviado">Enviado</option>
                  <option value="completado">Completado</option>
                  <option value="borrador">Borrador</option>
                </select>
                <input className="input" placeholder="Buscar…" value={q} onChange={(e) => setQ(e.target.value)} />
              </div>
            </div>

            {loading ? (
              <div className="pad">Cargando…</div>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>ID</th>
                      <th>Código</th>
                      <th>Nota</th>
                      <th>Estado</th>
                      <th>Fecha</th>
                      <th>Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {casosFiltrados.length === 0 && (
                      <tr>
                        <td className="td-center" colSpan={6}>
                          Sin procesos · <Link to="/psicologica/casos/nuevo" className="link">Crear el primero</Link>
                        </td>
                      </tr>
                    )}
                    {casosFiltrados.map((c) => (
                      <tr key={c.id}>
                        <td>{c.id}</td>
                        <td>{c.codigo || '-'}</td>
                        <td>{(notasDev[c.id] || '').trim() || '-'}</td>
                        <td>
                          <span className={`badge dot ${norm(c.estado)}`}>{prettyEstado(c.estado)}</span>
                        </td>
                        <td>{formatFecha(c.fecha_atencion || c.fecha_creacion)}</td>
                        <td>
                          <button className="btn-secondary" onClick={() => navigate(`/psicologica/casos/${c.id}`)}>Ver detalle</button>
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
    </div>
  );
}

/* ===== Helpers ===== */
function NavItem({ to, label }) {
  return (
    <NavLink to={to} className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
      {label}
    </NavLink>
  );
}

function Kpi({ title, value }) {
  return (
    <div className="kpi">
      <div className="kpi-title">{title}</div>
      <div className="kpi-value">{value}</div>
    </div>
  );
}

function norm(s) { return String(s || '').trim().toLowerCase(); }
function prettyEstado(s){
  const m = { pendiente:'Pendiente', en_progreso:'En progreso', validado:'Validado', enviado:'Enviado', completado:'Completado', borrador:'Borrador' };
  return m[norm(s)] || (s || '-');
}
function formatFecha(v) {
  if (!v) return '-';
  try { return String(v).slice(0, 10); } catch { return '-'; }
}
function getUserFromToken() {
  try {
    const t = localStorage.getItem('access_token');
    if (!t) return null;
    const payload = JSON.parse(atob(t.split('.')[1]));
    return { id: payload.sub, nombre: payload.name, role: payload.role, area: payload.area };
  } catch { return null; }
}
function emptyToNull(v) {
  const s = String(v ?? '').trim();
  return s ? s : null;
}
const toIntOrNull = (v) => {
  const n = Number(v); return Number.isFinite(n) && n > 0 ? n : null;
};
function splitNombre(nombres = '', apellidos = '') {
  const ns = String(nombres).trim().split(/\s+/).filter(Boolean);
  const as = String(apellidos).trim().split(/\s+/).filter(Boolean);
  return {
    pn: ns[0] || null,
    sn: ns.slice(1).join(' ') || null,
    pa: as[0] || null,
    sa: as.slice(1).join(' ') || null,
  };
}

export default PsicologicaHome;
