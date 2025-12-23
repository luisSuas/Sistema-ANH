// src/legal/LegalHomeCoordinacion.jsx
import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, NavLink } from 'react-router-dom';
import api, { setToken } from "../servicios/Servicios";
import './LegalHomeCoordinación.css';

function getUserFromToken(){
  try{
    const t = localStorage.getItem('access_token');
    if(!t) return null;
    const p = JSON.parse(atob(t.split('.')[1]));
    return { id:p.sub, nombre:p.name, role:Number(p.role), area:Number(p.area) };
  }catch{ return null; }
}

function norm(s){ return String(s||'').trim().toLowerCase(); }
function formatFecha(v){ if(!v) return '-'; try{ return String(v).slice(0,10);}catch{ return '-'; } }

export default function LegalHomeCoordinacion(){
  const navigate = useNavigate();
  const user = getUserFromToken();
  const [isMobile, setIsMobile] = useState(() => (typeof window !== 'undefined' ? window.innerWidth <= 780 : false));
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const [tab, setTab] = useState('revision'); // 'revision' | 'casos'
  const [casos, setCasos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState('');
  const [q, setQ] = useState('');

  // ✅ NUEVO: lookup de sobrevivientes (id -> nombre)
  const [victimasLookup, setVictimasLookup] = useState([]);

  const victimasById = useMemo(() => {
    const m = {};
    (victimasLookup || []).forEach(v => {
      if (v?.id == null) return;
      const nombre = buildNombreVictima(v);
      m[String(v.id)] = nombre || `ID #${v.id}`;
    });
    return m;
  }, [victimasLookup]);

  useEffect(() => {
    const handleResize = () => {
      const mobile = typeof window !== 'undefined' ? window.innerWidth <= 780 : false;
      setIsMobile(mobile);
      setSidebarOpen(!mobile);
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(()=>{ fetchCasos(); },[]);
  async function fetchCasos(){
    setLoading(true); setMsg('');
    try{
      const { data } = await api.get('/casos'); // backend ya restringe por área/rol
      setCasos(Array.isArray(data)?data:[]);
    }catch(e){
      if (e?.response?.status===401){ setToken(null); navigate('/login'); return;}
      setMsg('No se pudieron cargar los procesos');
    }finally{ setLoading(false); }
  }

  // ✅ NUEVO: cargar sobrevivientes (para mostrar nombre en lugar de ID/código)
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { data } = await api.get('/victimas');
        if (!alive) return;
        setVictimasLookup(Array.isArray(data) ? data : []);
      } catch {
        if (!alive) return;
        setVictimasLookup([]);
      }
    })();
    return () => { alive = false; };
  }, []);

  // Listas por estado
  const pendientes  = useMemo(()=> (casos||[]).filter(c=>norm(c.estado)==='pendiente'), [casos]);
  const validados   = useMemo(()=> (casos||[]).filter(c=>norm(c.estado)==='validado' || norm(c.estado)==='enviado'), [casos]);
  const enProgreso  = useMemo(()=> (casos||[]).filter(c=>norm(c.estado)==='en_progreso'), [casos]);

  // Filtros de búsqueda (por tab)
  const pendFiltradas = useMemo(()=>{
    if(!q) return pendientes;
    const s = q.toLowerCase();
    return pendientes.filter(v => JSON.stringify(v).toLowerCase().includes(s));
  },[pendientes,q]);

  const valFiltradas = useMemo(()=>{
    if(!q) return validados;
    const s = q.toLowerCase();
    return validados.filter(v => JSON.stringify(v).toLowerCase().includes(s));
  },[validados,q]);

  const progFiltradas = useMemo(()=>{
    if(!q) return enProgreso;
    const s = q.toLowerCase();
    return enProgreso.filter(v => JSON.stringify(v).toLowerCase().includes(s));
  },[enProgreso,q]);

  // Acciones
  async function aprobar(id){
    try{ await api.post(`/casos/${id}/validar`); await fetchCasos(); }
    catch(e){ alert(e?.response?.data?.error || 'No se pudo aprobar'); }
  }
  async function devolver(id){
    const motivo = window.prompt('Motivo/observación para devolver al Operativo:');
    if (motivo===null) return;
    try{ await api.post(`/casos/${id}/devolver`, { motivo }); await fetchCasos(); }
    catch(e){ alert(e?.response?.data?.error || 'No se pudo devolver'); }
  }
  async function pasarAProgreso(id){
    try{ await api.post(`/casos/${id}/en-progreso`); await fetchCasos(); }
    catch(e){ alert(e?.response?.data?.error || 'No se pudo poner en progreso'); }
  }
  async function completar(id){
    if(!window.confirm('¿Marcar el proceso como COMPLETADO?')) return;
    try{ await api.post(`/casos/${id}/completar`); await fetchCasos(); }
    catch(e){ alert(e?.response?.data?.error || 'No se pudo completar'); }
  }

  function logout(){ setToken(null); navigate('/login'); }

  return (
    <div className={`legal-shell social-shell ${sidebarOpen ? 'sidebar-open' : 'sidebar-closed'}`}>
      {isMobile && sidebarOpen && <div className="sidebar-backdrop" onClick={() => setSidebarOpen(false)} />}
      <aside className="legal-sidebar social-sidebar">
        <div className="sidebar-header">
          <div className="legal-brand social-brand">ANH · Legal</div>
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
        <nav className="legal-nav social-nav">
          <button className={`nav-item ${tab==='revision'?'active':''}`} onClick={()=>setTab('revision')}>Revisión</button>
          <button className={`nav-item ${tab==='casos'?'active':''}`} onClick={()=>setTab('casos')}>Procesos</button>
        </nav>
        <div className="legal-userbox social-userbox">
          <div className="legal-userline social-userline">{user?.nombre || 'Usuario'}</div>
          <div className="social-userline small">Coord. Área · Área: {String(user?.area ?? '-')}</div>
          <button className="link-ghost" onClick={logout}>Salir</button>
        </div>
      </aside>

      <div className="legal-main social-main">
        <header className="social-topbar coord-topbar" data-avoid-fab>
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
          <h1>{tab==='revision' ? 'Procesos por revisión' : 'Procesos del área'}</h1>
          <div className="topbar-actions">
            <input className="input" placeholder="Buscar…" value={q} onChange={(e)=>setQ(e.target.value)} />
          </div>
        </header>

        <div className="legal-content social-content">
          {msg && <div className="alert-info">{msg}</div>}

          {/* ======= TAB: REVISIÓN ======= */}
          {tab==='revision' && (
            <section className="card">
              <div className="card-header">
                <h3>Pendientes</h3>
                <div className="muted">Acciones: Aprobar (✔) o Devolver (↩)</div>
              </div>

              {loading ? <div className="pad">Cargando…</div> : (
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr><th>ID</th><th>Sobreviviente</th><th>Estado</th><th>Fecha</th><th>Acciones</th></tr>
                    </thead>
                    <tbody>
                      {pendFiltradas.length===0 && (
                        <tr><td className="td-center" colSpan={5}>No hay procesos pendientes</td></tr>
                      )}
                      {pendFiltradas.map(c=>{
                        const vid = getCasoVictimaId(c);
                        const nombreVictima =
                          vid != null ? (victimasById[String(vid)] || `ID #${vid}`) : '-';
                        const enviadoPor = getCasoUsuarioNombre(c) || '-';

                        return (
                          <tr key={c.id}>
                            <td>{c.id}</td>
                            <td>
                              <div>{nombreVictima}</div>
                              <div className="muted" style={{ fontSize: 12 }}>Enviado por: {enviadoPor}</div>
                            </td>
                            <td><span className="badge dot pendiente">Pendiente</span></td>
                            <td>{formatFecha(c.fecha_atencion || c.fecha_creacion)}</td>
                            <td className="coord-actions">
                              <button className="btn-secondary" onClick={()=>navigate(`/legal/casos/${c.id}`)}>Ver</button>
                              <button className="btn-green" onClick={()=>aprobar(c.id)}>Aprobar</button>
                              <button className="btn-danger" onClick={()=>devolver(c.id)}>Devolver</button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}

          {/* ======= TAB: CASOS ======= */}
          {tab==='casos' && (
            <>
              {/* Validados / Enviados */}
              <section className="card">
                <div className="card-header">
                  <h3>Validados</h3>
                  <div className="muted">Acción: Pasar a <strong>En Progreso</strong></div>
                </div>
                {loading ? <div className="pad">Cargando…</div> : (
                  <div className="table-wrap">
                    <table className="table">
                      <thead>
                      <tr><th>ID</th><th>Sobreviviente</th><th>Estado</th><th>Fecha</th><th>Acciones</th></tr>
                      </thead>
                      <tbody>
                      {valFiltradas.length===0 && (
                        <tr><td className="td-center" colSpan={5}>No hay procesos validados</td></tr>
                      )}
                      {valFiltradas.map(c=>{
                        const vid = getCasoVictimaId(c);
                        const nombreVictima =
                          vid != null ? (victimasById[String(vid)] || `ID #${vid}`) : '-';
                        const enviadoPor = getCasoUsuarioNombre(c) || '-';

                        return (
                          <tr key={c.id}>
                            <td>{c.id}</td>
                            <td>
                              <div>{nombreVictima}</div>
                              <div className="muted" style={{ fontSize: 12 }}>Enviado por: {enviadoPor}</div>
                            </td>
                            <td><span className="badge dot validado">{norm(c.estado)==='enviado' ? 'Enviado' : 'Validado'}</span></td>
                            <td>{formatFecha(c.fecha_atencion || c.fecha_revision || c.fecha_creacion)}</td>
                            <td className="coord-actions">
                              <button className="btn-secondary" onClick={()=>navigate(`/legal/casos/${c.id}`)}>Ver</button>
                              <button className="btn-primary" onClick={()=>pasarAProgreso(c.id)}>En Progreso</button>
                            </td>
                          </tr>
                        );
                      })}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>

              {/* En Progreso */}
              <section className="card">
                <div className="card-header">
                  <h3>En Progreso</h3>
                  <div className="muted">Acción: <strong>Completar</strong> cuando finalice la atención</div>
                </div>
                {loading ? <div className="pad">Cargando…</div> : (
                  <div className="table-wrap">
                    <table className="table">
                      <thead>
                      <tr><th>ID</th><th>Sobreviviente</th><th>Estado</th><th>Fecha inicio</th><th>Acciones</th></tr>
                      </thead>
                      <tbody>
                      {progFiltradas.length===0 && (
                        <tr><td className="td-center" colSpan={5}>No hay procesos en progreso</td></tr>
                      )}
                      {progFiltradas.map(c=>{
                        const vid = getCasoVictimaId(c);
                        const nombreVictima =
                          vid != null ? (victimasById[String(vid)] || `ID #${vid}`) : '-';
                        const enviadoPor = getCasoUsuarioNombre(c) || '-';

                        return (
                          <tr key={c.id}>
                            <td>{c.id}</td>
                            <td>
                              <div>{nombreVictima}</div>
                              <div className="muted" style={{ fontSize: 12 }}>Enviado por: {enviadoPor}</div>
                            </td>
                            <td><span className="badge dot en_progreso">En Progreso</span></td>
                            <td>{formatFecha(c.fecha_inicio || c.fecha_atencion || c.fecha_creacion)}</td>
                            <td className="coord-actions">
                              <button className="btn-secondary" onClick={()=>navigate(`/legal/casos/${c.id}`)}>Ver</button>
                              <button className="btn-green" onClick={()=>completar(c.id)}>Completar</button>
                            </td>
                          </tr>
                        );
                      })}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* ===== Helpers extra (solo para mostrar nombres) ===== */
function buildNombreVictima(v){
  if(!v) return '';
  const direct = (v.nombre_completo || v.nombre || '').toString().trim();
  if (direct) return direct;

  const parts = [v.primer_nombre, v.segundo_nombre, v.primer_apellido, v.segundo_apellido]
    .filter(Boolean)
    .map(x => String(x).trim());
  return parts.join(' ').trim();
}

function getCasoVictimaId(c){
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

function getCasoUsuarioNombre(c){
  // Intenta usar el “nombre completo” si viene en el payload del caso
  const direct =
    c?.usuario_nombre_completo ??
    c?.usuario_nombre ??
    c?.enviado_por_nombre ??
    c?.creado_por_nombre ??
    c?.operativo_nombre ??
    c?.usuario?.nombre_completo ??
    c?.usuario?.nombre ??
    c?.creado_por?.nombre_completo ??
    c?.creado_por?.nombre ??
    c?.operativo?.nombre_completo ??
    c?.operativo?.nombre ??
    '';

  const s = String(direct || '').trim();
  return s ? s : null;
}

