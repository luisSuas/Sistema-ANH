import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, NavLink, Link } from 'react-router-dom';
import api, { setToken } from "../servicios/Servicios";
import './AlbergueHomeOperativo.css';

function AlbergueHome() {
  const navigate = useNavigate();
  const [isMobile, setIsMobile] = useState(() => (typeof window !== 'undefined' ? window.innerWidth <= 1024 : false));
  const [sidebarOpen, setSidebarOpen] = useState(true);

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

  // ✅ Devoluciones pendientes por evento (NO por caso)
  const [devolPend, setDevolPend] = useState([]); // [{casoId, detalle, key}]

  // ✅ Bandeja de notificaciones (campanita)
  const [notifOpen, setNotifOpen] = useState(false);

  // ======= Form Registrar sobreviviente (ampliado) =======
  const [cat, setCat] = useState({ estados: [], escolaridades: [], etnias: [], residencias: [], ocupaciones: [] });

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
  const [victimaNombre, setVictimaNombre] = useState('');
  const [msgVictima, setMsgVictima] = useState('');

  const [victimasLookup, setVictimasLookup] = useState([]);

  // Fecha legible en topbar
  const hoy = useMemo(
    () => new Date().toLocaleDateString('es-GT', { day:'2-digit', month:'2-digit', year:'numeric' }),
    []
  );

  // mapa id -> nombre (para mostrar nombre en la tabla de casos)
  const victimasById = useMemo(() => {
    const m = {};
    (victimasLookup || []).forEach(v => {
      const nombre = buildNombreVictima(v);
      if (v?.id != null) m[String(v.id)] = nombre || `ID #${v.id}`;
    });
    return m;
  }, [victimasLookup]);

  // ======= Responsive sidebar =======
  useEffect(() => {
    const handleResize = () => {
      const mobile = typeof window !== 'undefined' ? window.innerWidth <= 1024 : false;
      setIsMobile(mobile);
      setSidebarOpen(!mobile);
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // ======= Efectos: cargar casos + catálogos =======
  useEffect(() => { fetchCasos(); fetchCatalogos(); fetchVictimasLookup(); /* eslint-disable-next-line */ }, []);

  // ✅ refrescar al volver a la pestaña/ventana (para que aparezcan devoluciones nuevas sin “recargar manual”)
  useEffect(() => {
    const onFocus = () => { try { fetchCasos(); } catch {} };
    const onVis = () => {
      if (typeof document !== 'undefined' && !document.hidden) {
        try { fetchCasos(); } catch {}
      }
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVis);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVis);
    };
    // eslint-disable-next-line
  }, []);

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

  async function fetchVictimasLookup() {
    try {
      const { data } = await api.get('/victimas');
      setVictimasLookup(Array.isArray(data) ? data : []);
    } catch {
      setVictimasLookup([]);
    }
  }

  // ✅ Ocupación: modo lista vs modo texto ("Agregar nueva")
  const [ocupacionCustom, setOcupacionCustom] = useState(false);

  // Normaliza para comparar sin duplicados: "Médica" == "medica" == "Medica"
  function ocupacionKey(s = '') {
    return String(s || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')   // quita acentos
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')       // símbolos -> espacio
      .trim()
      .replace(/\s+/g, ' ');
  }

  // ===== Alertas de devolución: "seen" por evento (no global) =====
  const LS_DEV_SEEN = 'anh_dev_seen_keys_v1';

  function loadDevSeenSet() {
    try {
      const raw = localStorage.getItem(LS_DEV_SEEN);
      const arr = raw ? JSON.parse(raw) : [];
      return new Set(Array.isArray(arr) ? arr : []);
    } catch {
      return new Set();
    }
  }

  function saveDevSeenSet(set) {
    try {
      const arr = Array.from(set).slice(-500);
      localStorage.setItem(LS_DEV_SEEN, JSON.stringify(arr));
    } catch {}
  }

  function simpleHash(str = '') {
    const s = String(str || '');
    let h = 0;
    for (let i = 0; i < s.length; i++) {
      h = ((h << 5) - h) + s.charCodeAt(i);
      h |= 0; // 32-bit
    }
    return Math.abs(h).toString(36);
  }

  // ✅ Key más estable y único (incluye índice del historial como fallback)
  function buildDevEventKey(casoId, histItem, histIndex) {
    const hid =
      histItem?.id ??
      histItem?.historial_id ??
      histItem?.id_historial ??
      null;

    const ts =
      histItem?.created_at ??
      histItem?.fecha_creacion ??
      histItem?.fecha ??
      histItem?.timestamp ??
      null;

    const det = (histItem?.detalle || '').toString().trim();
    const detHash = det ? simpleHash(det) : '0';
    const idx = (typeof histIndex === 'number' && histIndex >= 0) ? histIndex : null;

    if (hid != null) return `caso:${casoId}|hist:${hid}`;
    if (ts && idx != null) return `caso:${casoId}|ts:${String(ts)}|i:${idx}|h:${detHash}`;
    if (ts) return `caso:${casoId}|ts:${String(ts)}|h:${detHash}`;
    if (idx != null) return `caso:${casoId}|i:${idx}|h:${detHash}`;
    return `caso:${casoId}|fallback:h:${detHash}`; // estable (sin Date.now)
  }

  function marcarDevolucionesComoVistas(keys = []) {
    if (!keys.length) return;
    const seen = loadDevSeenSet();
    keys.forEach(k => seen.add(k));
    saveDevSeenSet(seen);
    setDevolPend(prev => prev.filter(x => !keys.includes(x.key)));
  }

  function onEntendidoDevolucion() {
    marcarDevolucionesComoVistas(devolPend.map(d => d.key));
    setNotifOpen(false);
  }

  function abrirDevolucionItem(item) {
    if (!item?.key) return;
    marcarDevolucionesComoVistas([item.key]);
    setNotifOpen(false);
    navigate(`/albergue/casos/${item.casoId}`);
  }

  function marcarUnaDevolucion(item) {
    if (!item?.key) return;
    marcarDevolucionesComoVistas([item.key]);
  }

  function verBandeja() {
    setNotifOpen(true);
    // si está cerrado el sidebar en móvil, no lo tocamos (solo abrimos bandeja)
  }

  // Carga la última nota de devolución desde el historial (solo casos en borrador)
// Carga la última nota de devolución desde el historial (solo casos en borrador)
async function cargarNotasDevolucion(lista) {
  const ids = (lista || []).filter(c => norm(c.estado) === 'borrador').map(c => c.id);
  if (!ids.length) {
    setNotasDev({});
    setDevolPend([]);
    return;
  }

  const seen = loadDevSeenSet();

  // ✅ Solo consideramos "devolución" cuando realmente viene de coordinación / revisión
  function isDevolucionCoordinacion(histItem) {
    const hasta = norm(histItem?.estado_hasta);
    if (hasta !== 'borrador') return false;

    const desde = norm(
      histItem?.estado_desde ??
      histItem?.estado_antes ??
      histItem?.estado_anterior ??
      histItem?.estado_prev ??
      histItem?.estado_previo ??
      ''
    );

    // Normalizamos texto sin acentos (reusamos tu normalizador robusto)
    const detalleK = ocupacionKey(histItem?.detalle || '');

    const rolLike =
      histItem?.usuario_rol ??
      histItem?.rol ??
      histItem?.role ??
      histItem?.perfil ??
      histItem?.actor_rol ??
      histItem?.usuario?.rol ??
      '';

    const rolK = ocupacionKey(rolLike);

    const accionLike =
      histItem?.accion ??
      histItem?.tipo ??
      histItem?.evento ??
      histItem?.motivo ??
      '';

    const accionK = ocupacionKey(accionLike);

    // Pistas típicas de devolución / coordinación
    const coordHint =
      rolK.includes('coordinacion') ||
      detalleK.includes('coordinacion') ||
      accionK.includes('coordinacion');

    const devolHint =
      detalleK.includes('devolu') ||     // devolucion / devuelto / devolver…
      accionK.includes('devolu');

    // Lo más común: se devuelve a borrador desde enviado/validado
    const fromReview = (desde === 'enviado' || desde === 'validado');

    return fromReview || coordHint || devolHint;
  }

  const results = await Promise.all(ids.map(async (id) => {
    try {
      const { data } = await api.get(`/casos/${id}/historial`);
      const hist = Array.isArray(data) ? data : [];

      // ✅ “Devolución” = última entrada marcada por backend como devolución de coordinación
let devIndex = -1;
for (let i = hist.length - 1; i >= 0; i--) {
  if (hist?.[i]?.es_devolucion_coordinacion === true) {
    devIndex = i;
    break;
  }
}

      const dev = devIndex >= 0 ? hist[devIndex] : null;
      const detalle = (dev?.detalle || '').toString().trim();
      const key = dev ? buildDevEventKey(id, dev, devIndex) : null;

      return { id, detalle, key };
    } catch {
      return { id, detalle: '', key: null };
    }
  }));

  // notas para la tabla (id -> texto)
  const notasMap = {};
  for (const r of results) notasMap[r.id] = r.detalle || '';
  setNotasDev(notasMap);

  // devoluciones pendientes (solo las no vistas y con nota)
  const pendientes = results
    .filter(r => (r.detalle || '').trim() && r.key && !seen.has(r.key))
    .map(r => ({ casoId: r.id, detalle: r.detalle, key: r.key }));

  setDevolPend(pendientes);
}


async function fetchCatalogos() {
  try {
    const [ec, es, et, rc, oc] = await Promise.all([
      api.get('/catalogos/estados-civiles'),
      api.get('/catalogos/escolaridades'),
      api.get('/catalogos/etnias'),
      api.get('/catalogos/residencias').catch(() => ({ data: [] })),
      api.get('/catalogos/ocupaciones').catch(() => ({ data: [] })),
    ]);

    // ---- Normalizadores seguros (NO rompen si el backend cambia forma) ----
    const toArray = (x) => {
      if (Array.isArray(x)) return x;
      if (Array.isArray(x?.data)) return x.data;
      if (Array.isArray(x?.items)) return x.items;
      if (Array.isArray(x?.results)) return x.results;
      return [];
    };

    const normText = (v) => String(v ?? '').trim();

    const ocupacionesRaw = toArray(oc?.data ?? oc);
    const ocupacionesNorm = ocupacionesRaw
      .map((o) => {
        const nombre =
          normText(o?.nombre) ||
          normText(o?.ocupacion) ||
          normText(o?.actividad) ||
          normText(o?.descripcion) ||
          normText(o?.label);

        const id =
          o?.id ??
          o?.codigo ??
          o?.clave ??
          o?.ocupacion_id ??
          o?.actividad_id ??
          nombre; // fallback estable si no hay id

        return nombre ? { id, nombre } : null;
      })
      .filter(Boolean);

    setCat({
      estados: Array.isArray(ec.data) ? ec.data : [],
      escolaridades: Array.isArray(es.data) ? es.data : [],
      etnias: Array.isArray(et.data) ? et.data : [],
      residencias: Array.isArray(rc.data) ? rc.data : [],
      ocupaciones: ocupacionesNorm, // ✅ aquí está el fix
    });
  } catch {
    // no rompas nada
  }
}


  // ======= Crear caso rápido (ya existe) =======
  async function crearCasoRapido(e) {
    e.preventDefault();
    setMsg('');

    try {
      const raw = String(nuevo.victima_id || '').trim();
      let victimaIdResolved = Number(raw);

      if (!Number.isFinite(victimaIdResolved) || victimaIdResolved <= 0) {
        const found = resolveVictimaByName(raw, victimasLookup);
        if (!found?.id) {
          setMsg('No se encontró una sobreviviente con ese nombre. Ve a “Sobrevivientes” y copia el ID o escribe el nombre completo.');
          return;
        }
        victimaIdResolved = Number(found.id);
      }

      const payload = {
        victima_id: Number(victimaIdResolved),
        area_id: Number(nuevo.area_id),
      };

      const resp = await api.post('/casos', payload, { headers: { 'Content-Type': 'application/json' } });
      const id = resp?.data?.id;
      if (id) {
        navigate(`/albergue/casos/${id}`);
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
    setVictimaNombre('');

    if (!vForm.nombres.trim() || !vForm.apellidos.trim()) {
      setMsgVictima('Ingresa nombres y apellidos.');
      return;
    }

    const { pn, sn, pa, sa } = splitNombre(vForm.nombres, vForm.apellidos);
    const nombreCompleto = [vForm.nombres.trim(), vForm.apellidos.trim()].filter(Boolean).join(' ');

    // ✅ Si está en modo "Agregar nueva", no permitir duplicados (Medica/Médica/medica)
    if (ocupacionCustom && String(vForm.ocupacion || '').trim()) {
      const key = ocupacionKey(vForm.ocupacion);
      const dup = (cat.ocupaciones || []).some(o => ocupacionKey(o?.nombre) === key);
      if (dup) {
        setMsgVictima('Esa ocupación ya existe en la lista. Selecciónala del desplegable (no la dupliquemos 😄).');
        return;
      }
    }

    setCreandoVictima(true);
    try {
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

        estado_civil_id: toIntOrNull(vForm.estado_civil_id),
        escolaridad_id: toIntOrNull(vForm.escolaridad_id),
        etnia_id: toIntOrNull(vForm.etnia_id),

        ocupacion: emptyToNull(vForm.ocupacion),
        direccion: emptyToNull(vForm.direccion),
        residencia: emptyToNull(vForm.residencia),
        nacionalidad: emptyToNull(vForm.nacionalidad),
        lugar_origen: emptyToNull(vForm.lugar_origen),

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
      setVictimaNombre(nombreCompleto);
      setMsgVictima(`Sobreviviente creada: ${nombreCompleto}.`);

      fetchVictimasLookup();
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
    setVictimaNombre('');
    setMsgVictima('');
    setOcupacionCustom(false);
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
    <div className={`albergue-shell social-shell ${sidebarOpen ? 'sidebar-open' : 'sidebar-closed'}`}>
      {isMobile && sidebarOpen && <div className="sidebar-backdrop" onClick={() => setSidebarOpen(false)} />}

      {/* Overlay para cerrar la bandeja al hacer click fuera */}
      {notifOpen && (
        <div
          onClick={() => setNotifOpen(false)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'transparent',
            zIndex: 50
          }}
        />
      )}

      {/* Sidebar */}
      <aside className="albergue-sidebar social-sidebar">
        <div className="sidebar-header">
          <div className="albergue-brand social-brand">ANH · Albergue</div>
          <button
            className="sidebar-toggle"
            type="button"
            aria-label="Abrir o cerrar menu"
            onClick={() => setSidebarOpen((s) => !s)}
          >
            <span />
            <span />
            <span />
          </button>
        </div>
        <nav className="albergue-nav social-nav">
          <NavItem to="/albergue" label="Dashboard" />
          <NavItem to="/albergue/victimas" label="Sobrevivientes" />
        </nav>
        <div className="albergue-userbox social-userbox">
          <div className="albergue-userline social-userline">{userFromToken?.nombre || 'Usuario'}</div>
          <div className="albergue-userline social-userline small">
            Rol: {String(userFromToken?.role ?? '-')} · Área: {String(userFromToken?.area ?? '-')}
          </div>
          <button className="link-ghost" onClick={logout}>Salir</button>
        </div>
      </aside>

      {/* Main */}
      <div className="albergue-main social-main">
        {/* Topbar */}
        <header className="albergue-topbar social-topbar" data-avoid-fab style={{ position: 'relative' }}>
          {(!sidebarOpen || isMobile) && (
            <button
              className="sidebar-toggle"
              type="button"
              aria-label="Abrir o cerrar menu"
              onClick={() => setSidebarOpen((s) => !s)}
            >
              <span />
              <span />
              <span />
            </button>
          )}
          <h1>Panel del Área Albergue</h1>

          <div className="topbar-actions avoid-fab" style={{ position: 'relative' }}>
            <div className="muted">Hoy: {hoy}</div>

            {/* ✅ Campanita + badge */}
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setNotifOpen((s) => !s)}
              title="Notificaciones"
              style={{ position: 'relative', padding: '6px 10px' }}
            >
              🔔
              {devolPend.length > 0 && (
                <span
                  style={{
                    position: 'absolute',
                    top: -6,
                    right: -6,
                    minWidth: 18,
                    height: 18,
                    padding: '0 6px',
                    borderRadius: 999,
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 12,
                    fontWeight: 700,
                    background: '#ef4444',
                    color: '#fff',
                    lineHeight: 1,
                  }}
                >
                  {devolPend.length}
                </span>
              )}
            </button>

            {/* ✅ Bandeja (dropdown) */}
              {notifOpen && (
                <div
                  className="notif-panel"
                  style={{
                    position: 'absolute',
                    right: 0,
                    top: 'calc(100% + 8px)',
                    width: 420,
                  maxWidth: '90vw',
                  background: '#fff',
                  borderRadius: 12,
                  boxShadow: '0 10px 30px rgba(0,0,0,0.12)',
                  border: '1px solid rgba(0,0,0,0.08)',
                  zIndex: 60,
                  overflow: 'hidden'
                }}
                onClick={(e) => e.stopPropagation()}
              >
                <div className="notif-head" style={{ padding: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                  <div style={{ fontWeight: 800 }}>Notificaciones</div>
                  <div className="notif-actions" style={{ display: 'flex', gap: 8 }}>
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => { try { fetchCasos(); } catch {} }}
                      title="Refrescar"
                    >
                      ↻
                    </button>
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => setNotifOpen(false)}
                    >
                      Cerrar
                    </button>
                  </div>
                </div>

                  <div className="notif-divider" style={{ borderTop: '1px solid rgba(0,0,0,0.06)' }} />

                {devolPend.length === 0 ? (
                  <div style={{ padding: 12 }} className="muted">
                    Sin devoluciones nuevas.
                  </div>
                ) : (
                  <>
                    <div style={{ padding: 12 }} className="muted">
                      Tienes <b>{devolPend.length}</b> devolución(es) por coordinación.
                    </div>

                    <div style={{ maxHeight: 320, overflow: 'auto', padding: '0 12px 12px 12px' }}>
                      {devolPend.map((d) => (
                          <div
                            key={d.key}
                            className="notif-item"
                            style={{
                              padding: 10,
                              borderRadius: 10,
                              border: '1px solid rgba(0,0,0,0.08)',
                              marginBottom: 10
                          }}
                        >
                          <div style={{ fontWeight: 700, marginBottom: 6 }}>
                            Caso #{d.casoId}
                          </div>
                          <div className="muted" style={{ whiteSpace: 'pre-wrap' }}>
                            {(d.detalle || '').slice(0, 280)}{(d.detalle || '').length > 280 ? '…' : ''}
                          </div>
                          <div style={{ marginTop: 10, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                            <button
                              type="button"
                              className="btn-secondary"
                              onClick={() => marcarUnaDevolucion(d)}
                              title="Marcar como leída"
                            >
                              Leída
                            </button>
                            <button
                              type="button"
                              className="btn-primary"
                              onClick={() => abrirDevolucionItem(d)}
                            >
                              Abrir
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>

                    <div style={{ borderTop: '1px solid rgba(0,0,0,0.06)' }} />
                    <div className="notif-footer" style={{ padding: 12, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                      <button type="button" className="btn-secondary" onClick={onEntendidoDevolucion}>
                        Marcar todas como vistas
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </header>

        <div className="albergue-content social-content">
          {/* Mensaje global */}
          {msg && <div className="alert-info">{msg}</div>}

          {/* ✅ ALERTA: devoluciones pendientes por EVENTO + acceso a bandeja */}
          {devolPend.length > 0 && (
            <div className="alert-info dev-alert" style={{ display:'flex', gap:12, alignItems:'center', justifyContent:'space-between' }}>
              <div style={{ flex: 1 }}>
                <b>⚠️ Devolución recibida:</b> Tienes {devolPend.length} proceso(s) devuelto(s) por coordinación.
                <div className="muted" style={{ marginTop: 4 }}>
                  Filtra por <b>Borrador</b> y revisa la <b>Nota</b>.
                </div>

                <div style={{ marginTop: 8, display:'flex', flexDirection:'column', gap:6 }}>
                  {devolPend.slice(0, 3).map((d) => (
                    <div key={d.key} className="dev-item" style={{ display:'flex', gap:8, alignItems:'center' }}>
                      <span className="muted">
                        Caso #{d.casoId}: {(d.detalle || '').slice(0, 180)}{(d.detalle || '').length > 180 ? '…' : ''}
                      </span>
                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={() => abrirDevolucionItem(d)}
                      >
                        Abrir
                      </button>
                    </div>
                  ))}
                  {devolPend.length > 3 && (
                    <div className="muted">…y {devolPend.length - 3} más.</div>
                  )}
                </div>
              </div>

              <div className="dev-actions" style={{ display:'flex', gap:8, alignItems:'center' }}>
                <button type="button" className="btn-secondary" onClick={verBandeja}>
                  Ver bandeja
                </button>
                <button type="button" className="btn-secondary" onClick={onEntendidoDevolucion}>
                  Entendido
                </button>
              </div>
            </div>
          )}

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
                    onClick={() => navigate(`/albergue/casos/nuevo?victima_id=${victimaId}`)}
                    title={`Crear proceso para: ${victimaNombre || 'la sobreviviente'}`}
                  >
                    Crear proceso para {victimaNombre || 'la sobreviviente'}
                  </button>
                )}
              </div>
            </div>

            {msgVictima && <div className="alert-info">{msgVictima}</div>}

            <form onSubmit={registrarVictima}>
              <div className="form-row form-row-identidad">
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

              <div className="form-row">
                <div className="form-item">
                  <label className="small-label">Ocupación / Actividad</label>

                  {(cat.ocupaciones || []).length > 0 ? (
                    ocupacionCustom ? (
                      <>
                        <input
                          className="input"
                          name="ocupacion"
                          value={vForm.ocupacion}
                          onChange={onVictimaChange}
                          placeholder="Escribe la nueva ocupación…"
                        />
                        <button
                          type="button"
                          className="btn-secondary"
                          style={{ marginTop: 8 }}
                          onClick={() => { setOcupacionCustom(false); setVForm(f => ({ ...f, ocupacion: '' })); }}
                        >
                          Volver a la lista
                        </button>
                      </>
                    ) : (
                      <select
                        className="input"
                        value={vForm.ocupacion || ''}
                        onChange={(e) => {
                          const val = e.target.value;
                          if (val === '__new__') {
                            setOcupacionCustom(true);
                            setVForm(f => ({ ...f, ocupacion: '' }));
                          } else {
                            setOcupacionCustom(false);
                            setVForm(f => ({ ...f, ocupacion: val }));
                          }
                        }}
                      >
                        <option value="">— Selecciona —</option>
                        {(cat.ocupaciones || []).map((o) => (
                          <option key={o.id ?? o.nombre} value={o.nombre}>{o.nombre}</option>
                        ))}
                        <option value="__new__">+ Agregar nueva…</option>
                      </select>
                    )
                  ) : (
                    <input
                      className="input"
                      name="ocupacion"
                      value={vForm.ocupacion}
                      onChange={onVictimaChange}
                      placeholder="Ej. Comerciante"
                    />
                  )}
                </div>

                <div className="form-item">
                  <label className="small-label">Dirección</label>
                  <input className="input" name="direccion" value={vForm.direccion} onChange={onVictimaChange} placeholder="Dirección" />
                </div>

                {/* ✅ Residencia SIEMPRE es desplegable */}
                <div className="form-item">
                  <label className="small-label">Residencia</label>
                  <select
                    className="input"
                    name="residencia"
                    value={vForm.residencia}
                    onChange={onVictimaChange}
                  >
                    <option value="">— Selecciona —</option>

                    {(cat.residencias || []).length > 0
                      ? (cat.residencias || []).map((r) => {
                          const label =
                            (r?.nombre ?? r?.descripcion ?? r?.label ?? String(r?.id ?? "")).toString().trim();
                          return (
                            <option key={r?.id ?? label} value={label}>
                              {label}
                            </option>
                          );
                        })
                      : ["Barrio", "Colonia", "Aldea"].map((x) => (
                          <option key={x} value={x}>{x}</option>
                        ))
                    }
                  </select>
                </div>
              </div>

              <div className="form-row">
                <div className="form-item">
                  <label className="small-label">Nacionalidad</label>
                  <input className="input" name="nacionalidad" value={vForm.nacionalidad} onChange={onVictimaChange} placeholder="Guatemalteca, ..." />
                </div>
                <div className="form-item">
                  <label className="small-label">Lugar de origen</label>
                  <input className="input" name="lugar_origen" value={vForm.lugar_origen} onChange={onVictimaChange} placeholder="Departamento/Municipio" />
                </div>
                <div className="form-item" />
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
              Luego de registrar, puedes crear el proceso con el botón de arriba.
            </div>
          </section>

          {/* ===== Nuevo proceso (atajo) ===== */}
          <section className="card">
            <div className="card-header">
              <h3>Nuevo proceso</h3>
              <div className="card-actions">
                <Link to="/albergue/casos/nuevo" className="btn-primary">+ Nuevo proceso</Link>
              </div>
            </div>

            <details className="details-quick">
              <summary className="summary-quick">Atajo rápido (escribe nombre de sobreviviente y área)</summary>
              <div className="quick-body">
                <form className="form-row" onSubmit={crearCasoRapido}>
                  <input
                    name="victima_id"
                    value={nuevo.victima_id}
                    onChange={handleChangeCaso}
                    placeholder="Escribe el nombre de la sobreviviente…"
                    list="victimas-datalist"
                    required
                  />
                  <datalist id="victimas-datalist">
                    {(victimasLookup || []).map(v => {
                      const nombre = buildNombreVictima(v);
                      return nombre ? <option key={v.id} value={nombre} /> : null;
                    })}
                  </datalist>

                  <input name="area_id" value={nuevo.area_id} onChange={handleChangeCaso} placeholder="area_id" required />
                  <button className="btn-primary">Crear</button>
                </form>
                <div className="muted">
                  ¿No aparece? <Link className="link" to="/albergue/victimas">Ver sobrevivientes</Link>
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
                      <th>Sobreviviente</th>
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
                        <td className="td-center" colSpan={7}>
                          Sin procesos · <Link to="/albergue/casos/nuevo" className="link">Crear el primero</Link>
                        </td>
                      </tr>
                    )}
                    {casosFiltrados.map((c) => {
                      const vid = getCasoVictimaId(c);
                      const nombreVictima =
                        vid != null
                          ? (victimasById[String(vid)] || `ID #${vid}`)
                          : '-';

                      return (
                        <tr key={c.id}>
                          <td>{c.id}</td>
                          <td>{nombreVictima}</td>
                          <td>{c.codigo || '-'}</td>
                          <td>{(notasDev[c.id] || '').trim() || '-'}</td>
                          <td>
                            <span className={`badge dot ${norm(c.estado)}`}>{prettyEstado(c.estado)}</span>
                          </td>
                          <td>{formatFecha(c.fecha_atencion || c.fecha_creacion)}</td>
                          <td>
                            <button className="btn-secondary" onClick={() => navigate(`/albergue/casos/${c.id}`)}>Ver detalle</button>
                          </td>
                        </tr>
                      );
                    })}
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

function buildNombreVictima(v) {
  if (!v) return '';
  const direct = (v.nombre_completo || v.nombre || '').toString().trim();
  if (direct) return direct;

  const parts = [v.primer_nombre, v.segundo_nombre, v.primer_apellido, v.segundo_apellido]
    .filter(Boolean)
    .map(x => String(x).trim());
  return parts.join(' ').trim();
}

function resolveVictimaByName(input, victimas) {
  const s = norm(input || '');
  if (!s) return null;

  const exact = (victimas || []).find(v => norm(buildNombreVictima(v)) === s);
  if (exact) return exact;

  const matches = (victimas || []).filter(v => norm(buildNombreVictima(v)).includes(s));
  if (matches.length === 1) return matches[0];

  return null;
}

function getCasoVictimaId(c) {
  const raw =
    c?.victima_id ??
    c?.victimaId ??
    c?.victima ??
    c?.sobreviviente_id ??
    c?.sobrevivienteId ??
    c?.victima_fk ??
    null;

  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export default AlbergueHome;




