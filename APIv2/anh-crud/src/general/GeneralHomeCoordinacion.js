// src/general/GeneralHomeCoordinacion.jsx
import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, NavLink } from 'react-router-dom';
import api, { setToken } from "../servicios/Servicios";
import './GeneralHomeCoordinacion.css';

function getUserFromToken(){
  try{
    const t = localStorage.getItem('access_token');
    if(!t) return null;
    const p = JSON.parse(atob(t.split('.')[1]));
    return { id:p.sub, nombre:p.name, role:Number(p.role), area:Number(p.area) };
  }catch{ return null; }
}

function ymd(d){
  const dt = new Date(d);
  const yyyy = dt.getFullYear();
  const mm = String(dt.getMonth()+1).padStart(2,'0');
  const dd = String(dt.getDate()).padStart(2,'0');
  return `${yyyy}-${mm}-${dd}`;
}
function monthBounds(date=new Date()){
  const d1 = new Date(date.getFullYear(), date.getMonth(), 1);
  const d2 = new Date(date.getFullYear(), date.getMonth()+1, 0);
  return { start: ymd(d1), end: ymd(d2) };
}
function prevMonthBounds(date=new Date()){
  const d1 = new Date(date.getFullYear(), date.getMonth()-1, 1);
  const d2 = new Date(date.getFullYear(), date.getMonth(), 0);
  return { start: ymd(d1), end: ymd(d2) };
}

function yearFromYMD(ymdStr){
  // NO uses new Date('YYYY-MM-DD'); solo lee el año del string
  const m = /^(\d{4})/.exec(String(ymdStr || '').trim());
  return m ? Number(m[1]) : (new Date()).getFullYear();
}

function yearBounds(y = (new Date()).getFullYear()){
  const d1 = new Date(y, 0, 1);
  const d2 = new Date(y, 11, 31);
  return { start: ymd(d1), end: ymd(d2) };
}

export default function GeneralHomeCoordinacion(){
  const navigate = useNavigate();
  const user = getUserFromToken();

  const [tab, setTab] = useState('general'); // 'general' | 'resumen'
  const [areas, setAreas] = useState([]);
  const [areaId, setAreaId] = useState(''); // vacío = todas
  const thisMonth = monthBounds();
  const [start, setStart] = useState(thisMonth.start);
  const [end, setEnd] = useState(thisMonth.end);

  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState('');
  const [rows, setRows] = useState([]);         // vista previa informe general
  const [resumen, setResumen] = useState([]);    // resumen por área
  const [q, setQ] = useState('');

  useEffect(()=>{
    // seguridad mínima en UI: CG = 1
    if (!user || user.role !== 1){ navigate('/login'); return; }
    fetchAreas();
    fetchData(); // carga inicial según pestaña
    // eslint-disable-next-line
  }, [tab]);

  async function fetchAreas(){
    try{
      const { data } = await api.get('/catalogos/areas');
      setAreas(Array.isArray(data)?data:[]);
    }catch(e){ /* opcional */ }
  }

  async function fetchData(){
    setLoading(true); setMsg('');
    try{
      if (tab === 'general'){
        const { data } = await api.get('/informes/general', {
          params: { start, end, area_id: areaId || undefined }
        });
        setRows(Array.isArray(data)?data:[]);
      }else{
        const { data } = await api.get('/informes/resumen', {
          params: { start, end, area_id: areaId || undefined }
        });
        setResumen(Array.isArray(data)?data:[]);
      }
    }catch(e){
      const m = e?.response?.data?.error || 'No se pudo cargar la información';
      setMsg(m);
      if (e?.response?.status===401){ setToken(null); navigate('/login'); }
    }finally{ setLoading(false); }
  }

  // ──────────────────────────────
  // Descargas
  // ──────────────────────────────
  async function downloadBlob(url, params, filename){
    try{
      const resp = await api.get(url, { params, responseType:'blob' });
      const blob = new Blob(
        [resp.data],
        { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }
      );
      const href = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = href; a.download = filename;
      document.body.appendChild(a); a.click(); a.remove();
      window.URL.revokeObjectURL(href);
    }catch(e){
      alert(e?.response?.data?.error || 'No se pudo descargar el archivo');
      if (e?.response?.status===401){ setToken(null); navigate('/login'); }
    }
  }

  // Excel (registros “formato amarillo” – solo completados)
  async function downloadExcelGeneral(customRange=null, filenameHint='informe_general'){
    const p = customRange ? customRange : { start, end };
    const params = { ...p, area_id: areaId || undefined };
    const suf = p.start && p.end ? `${p.start}_a_${p.end}` : `${Date.now()}`;
    await downloadBlob('/informes/excel/general', params, `${filenameHint}_${suf}.xlsx`);
  }

  // Excel (reporte agregado mensual/anual – solo completados)
  async function downloadExcelMensual(customRange=null, filenameHint='reporte_mensual'){
    const p = customRange ? customRange : { start, end };
    const params = { ...p, area_id: areaId || undefined };
    const suf = p.start && p.end ? `${p.start}_a_${p.end}` : `${Date.now()}`;
    await downloadBlob('/informes/excel/mensual', params, `${filenameHint}_${suf}.xlsx`);
  }
// Excel ANUAL – usa el año del filtro "Desde" si no se pasa explícito
async function downloadExcelAnual(year = null, filenameHint = 'reporte_anual'){
  const y = (year != null) ? year : yearFromYMD(start);
  const params = { year: y, area_id: areaId || undefined };
  await downloadBlob('/informes/excel/anual', params, `${filenameHint}_${y}.xlsx`);
}



  // CSV (se conserva lo que ya tenías)
  async function downloadCSV(customRange=null, filenameHint='informe_general'){
    try{
      const p = customRange ? customRange : { start, end };
      const params = { ...p, area_id: areaId || undefined, format:'csv' };
      const resp = await api.get('/informes/general', {
        params, responseType:'blob'
      });
      const blob = new Blob([resp.data], { type: 'text/csv;charset=utf-8;' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      const suf = p.start && p.end ? `${p.start}_a_${p.end}` : `${Date.now()}`;
      a.href = url;
      a.download = `${filenameHint}_${suf}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    }catch(e){
      alert(e?.response?.data?.error || 'No se pudo descargar el CSV');
      if (e?.response?.status===401){ setToken(null); navigate('/login'); }
    }
  }

  const filtered = useMemo(()=>{
    if (tab!=='general') return [];
    if(!q) return rows;
    const s = q.toLowerCase();
    return (rows||[]).filter(r => JSON.stringify(r).toLowerCase().includes(s));
  },[rows,q,tab]);

  // rangos rápidos
  const now = new Date();
  const rMesActual   = monthBounds(now);
  const rMesAnterior = prevMonthBounds(now);
  const rAnioActual  = yearBounds(now.getFullYear());
  const rAnioAnterior= yearBounds(now.getFullYear()-1);

  function logout(){ setToken(null); navigate('/login'); }

  return (
    <div className="general-shell">
      <aside className="general-sidebar">
        <div className="general-brand">ANH · General</div>
        <nav className="general-nav">
          <button className={`nav-item ${tab==='general'?'active':''}`} onClick={()=>setTab('general')}>Informes (Registros)</button>
          <button className={`nav-item ${tab==='resumen'?'active':''}`} onClick={()=>setTab('resumen')}>Resumen por Área</button>
        </nav>
        <div className="general-userbox">
          <div className="general-userline">{user?.nombre || 'Usuario'}</div>
          <div className="general-userline small">Coord. General</div>
          <button className="link-ghost" onClick={logout}>Salir</button>
        </div>
      </aside>

      <div className="general-main">
        <header className="general-topbar">
          <h1>Panel de Coordinación General</h1>
          <div className="topbar-actions">
            {tab==='general' && (
              <input className="input" placeholder="Buscar en vista previa…" value={q} onChange={(e)=>setQ(e.target.value)} />
            )}
          </div>
        </header>

        <div className="general-content">
          {/* Filtros */}
          <section className="card">
            <div className="card-header">
              <h3>Filtros</h3>
              <div className="card-header-right">
                <button className="btn-secondary" onClick={fetchData} disabled={loading}>Aplicar</button>
              </div>
            </div>

            <div className="filter-grid">
              <div className="fg-item">
                <label>Área</label>
                <select className="input" value={areaId} onChange={(e)=>setAreaId(e.target.value)}>
                  <option value="">Todas</option>
                  {areas.map(a => <option key={a.id} value={a.id}>{a.nombre || `Área ${a.id}`}</option>)}
                </select>
              </div>
              <div className="fg-item">
                <label>Desde</label>
                <input type="date" className="input" value={start} onChange={(e)=>setStart(e.target.value)} />
              </div>
              <div className="fg-item">
                <label>Hasta</label>
                <input type="date" className="input" value={end} onChange={(e)=>setEnd(e.target.value)} />
              </div>
              <div className="fg-item fg-actions">
                {tab==='general' ? (
                  <>
                    {/* NUEVO: Excel registros (solo completados) */}
                    <button className="btn-primary" onClick={()=>downloadExcelGeneral(null,'informe_general')} disabled={loading}>
                      Descargar Excel (General)
                    </button>
                       {/* NUEVO: Excel mensual (agregado) según Desde/Hasta actuales */}
                    <button  
                      className="btn-primary" onClick={()=>downloadExcelMensual(null,'reporte_mensual')} disabled={loading}
                    >
                    Descargar Excel (Mensual)
                    </button>
                    <button
  className="btn-primary"
  onClick={()=>downloadExcelAnual(null,'reporte_anual')}
  disabled={loading}
>
  Descargar Excel (Anual)
</button>

                  </>
                ) : (
                  <>
                    <button className="btn-secondary" onClick={fetchData} disabled={loading}>Actualizar resumen</button>
                    {/* NUEVO: Excel agregado (mensual/anual) */}
                    <button className="btn-primary" onClick={()=>downloadExcelMensual(null,'reporte_agregado')} disabled={loading}>
                      Descargar Excel (Resumen)
                    </button>
                  </>
                )}
              </div>
            </div>

            {/* Rápidos */}
            <div className="quick-range">
              <span className="muted">Rangos rápidos:</span>

              {/* NUEVOS: descargas rápidas del Excel agregado */}
              <button className="chip chip-download" onClick={()=>downloadExcelMensual(rMesActual,'reporte_mensual')}>Descargar mes actual (Excel)</button>
              <button className="chip chip-download" onClick={()=>downloadExcelMensual(rMesAnterior,'reporte_mensual_anterior')}>Descargar mes anterior (Excel)</button>
              <button className="chip chip-download" onClick={()=>downloadExcelAnual(yearFromYMD(rAnioActual.start),'reporte_anual')}>Descargar año actual (Excel)</button>
              <button className="chip chip-download" onClick={()=>downloadExcelAnual(yearFromYMD(rAnioAnterior.start),'reporte_anual_anterior')}>Descargar año anterior (Excel)</button>
            </div>
          </section>

          {msg && <div className="alert-info">{msg}</div>}

          {/* Contenido según pestaña */}
          {tab==='general' ? (
            <section className="card">
              <div className="card-header">
                <h3>Vista previa</h3>
                <div className="muted">
                  Solo se descargan <strong>COMPLETADOS</strong> en Excel. Fuente: <code>informe_coordinacion_general</code>
                </div>
              </div>
              {loading ? (
                <div className="pad">Cargando…</div>
              ) : (
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>No. orden</th>
                        <th>Nombre</th>
                        <th>CUI</th>
                        <th>Fecha atención</th>
                        <th>Área</th>
                        {/* NUEVO bloque visible en la vista previa */}
                        <th>Estado civil</th>
                        <th>Lugar de origen</th>
                        {/* /NUEVO */}
                        <th>Estado</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.length===0 && (
                        <tr><td colSpan={8} className="td-center">Sin resultados</td></tr>
                      )}
                      {filtered.map((r, i)=>(
                        <tr key={i}>
                          <td>{r.no_orden}</td>
                          <td>{r.nombre_persona}</td>
                          <td>{r.cui || '-'}</td>
                          <td>{r.fecha_atencion ? String(r.fecha_atencion).slice(0,10) : '-'}</td>
                          <td>{r.area_id}</td>
                          {/* NUEVO: datos alineados con Excel */}
                          <td>{r.estado_civil || '-'}</td>
                          <td>{r.lugar_origen || '-'}</td>
                          {/* /NUEVO */}
                          <td><span className={`badge dot ${String(r.estado).toLowerCase()}`}>{r.estado}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          ) : (
            <section className="card">
              <div className="card-header">
                <h3>Resumen por área</h3>
                <div className="muted">Conteos por estado dentro del rango seleccionado</div>
              </div>
              {loading ? (
                <div className="pad">Cargando…</div>
              ) : (
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Área</th>
                        <th>Total</th>
                        <th>Pendientes</th>
                        <th>En progreso</th>
                        <th>Validados</th>
                        <th>Enviados</th>
                        <th>Completados</th>
                      </tr>
                    </thead>
                    <tbody>
                      {resumen.length===0 && (
                        <tr><td colSpan={7} className="td-center">Sin resultados</td></tr>
                      )}
                      {resumen.map((r,i)=>(
                        <tr key={i}>
                          <td>{r.area_nombre || `Área ${r.area_id}`}</td>
                          <td>{r.total}</td>
                          <td>{r.pendientes}</td>
                          <td>{r.en_progreso}</td>
                          <td>{r.validados}</td>
                          <td>{r.enviados}</td>
                          <td>{r.completados}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
