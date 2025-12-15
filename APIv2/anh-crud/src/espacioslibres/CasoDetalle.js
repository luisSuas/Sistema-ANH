// src/servicios/CasoDetalle.js
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, Link, useLocation } from "react-router-dom";
import api, {
  getCasoById,
  getVictimaById,
  updateCaso,
  enviarRevision as enviarRevisionApi,
  deleteCaso,
  getCatalogo,
} from "../servicios/Servicios";
import "./CasoDetalle.css";

/** Badges por estado */
const EstadoBadge = ({ estado }) => {
  const map = {
    borrador: { txt: "Borrador", cls: "badge pendiente" },
    pendiente: { txt: "Pendiente", cls: "badge pendiente" },
    en_progreso: { txt: "En progreso", cls: "badge en_progreso" },
    validado: { txt: "Validado", cls: "badge validado" },
    enviado: { txt: "Enviado", cls: "badge enviado" },
    completado: { txt: "Completado", cls: "badge completado" },
  };
  const m = map[String(estado || "").toLowerCase()] || {
    txt: String(estado || "-"),
    cls: "badge",
  };
  return <span className={`${m.cls} dot`}>{m.txt}</span>;
};

export default function CasoDetalle() {
  const { id } = useParams();
  const nav = useNavigate();
  const location = useLocation();

  // ✅ BASE dinámico (incluye EspaciosLibres)
  const areaFromToken = useMemo(() => getAreaFromToken(), []);
  const areaSlug = useMemo(
    () => normalizeAreaSlug(inferAreaFromPath(location.pathname) || areaFromToken),
    [location.pathname, areaFromToken]
  );
  const BASE = `/${areaSlug}`;

  const [caso, setCaso] = useState(null);
  const [victima, setVictima] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");

  // Edición inline
  const [edit, setEdit] = useState(false);
  const [form, setForm] = useState({
    motivo_consulta: "",
    fecha_atencion: "",
    residencia: "",
    telefono: "",
    municipio_id: "",
    // Campos adicionales del caso
    sexual_conocido: false,
    embarazo_semanas: "",
    tiempo_agresion: "",
    riesgo_otro: "",
    acciones: "",
    // multivalor
    tipos_violencia_ids: [],
    medios_agresion_ids: [],
    ref_interna_ids: [],
    ref_externa_ids: [],
    situaciones_riesgo: [], // [{ situacion_id, detalle }]

    // Fallback UI
    hijos: [],
    agresores: [],

    // "Otros/Otras" (texto libre)
    otros_tipos_violencia: "",
    otros_medios_agresion: "",
    ref_interna_otro: "",
    ref_externa_otro: "",
  });

  // Catálogos
  const [cat, setCat] = useState({
    tiposViolencia: [],
    mediosAgresion: [],
    situacionesRiesgo: [],
    refInterna: [],
    refExterna: [],
    estadosCiviles: [],
    escolaridades: [],
    etnias: [],
    municipios: [],        // ← con departamento_id
    departamentos: [],
    relacionesAgresor: [], // ← para mostrar nombre de la relación
  });
  const [cargandoCat, setCargandoCat] = useState(true);

  const isBorrador = useMemo(
    () => String(caso?.estado || "").toLowerCase() === "borrador",
    [caso]
  );

  // NUEVO: detectar si el caso ya está completado (para deshabilitar Eliminar)
  const isCompletado = useMemo(
    () => String(caso?.estado || "").toLowerCase() === "completado",
    [caso]
  );

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        setMsg("");

        const { data: c } = await getCasoById(id);

        // Helpers para normalizar arrays
        const toIds = (arr) => {
          if (!Array.isArray(arr)) return [];
          return arr
            .map((x) =>
              typeof x === "object"
                ? x.id ??
                  x.tipo_violencia_id ??
                  x.medio_agresion_id ??
                  x.destino_id ??
                  x.situacion_id
                : x
            )
            .filter((x) => x != null);
        };
        const toRiesgos = (arr) => {
          if (!Array.isArray(arr)) return [];
          return arr.map((r) => ({
            situacion_id: r.situacion_id ?? r.id ?? r.situacion ?? "",
            detalle: r.detalle ?? r.descripcion ?? "",
          }));
        };

        // Base desde API
        let hijos = Array.isArray(c.hijos) ? c.hijos : [];
        let agresores = Array.isArray(c.agresores) ? c.agresores : [];

        // ---- Fallback completo desde localStorage ----
        try {
          const mv = JSON.parse(localStorage.getItem(`caso_mv_${id}`) || "null");
          if (mv) {
            if (!hijos.length && Array.isArray(mv.hijos)) hijos = mv.hijos;
            if (!agresores.length && Array.isArray(mv.agresores)) agresores = mv.agresores;
          }
        } catch {}

        // Guardamos caso con hijos/agresores resueltos
        setCaso({ ...c, hijos, agresores });

        // Form base (multivalor con fallback más abajo)
        setForm({
          motivo_consulta: c.motivo_consulta ?? "",
          fecha_atencion: c.fecha_atencion ? new Date(c.fecha_atencion).toISOString().slice(0, 10) : "",
          residencia: c.residencia ?? "",
          telefono: c.telefono ?? "",
          municipio_id: c.municipio_id ?? "",
          sexual_conocido: !!c.sexual_conocido,
          embarazo_semanas: c.embarazo_semanas ?? "",
          tiempo_agresion: c.tiempo_agresion ?? "",
          riesgo_otro: c.riesgo_otro ?? "",
          acciones: c.acciones ?? "",
          tipos_violencia_ids: toIds(c.tipos_violencia_ids ?? c.tipos_violencia ?? c.violencias),
          medios_agresion_ids: toIds(c.medios_agresion_ids ?? c.medios_agresion),
          ref_interna_ids: toIds(c.ref_interna_ids ?? c.ref_interna),
          ref_externa_ids: toIds(c.ref_externa_ids ?? c.ref_externa),
          situaciones_riesgo: toRiesgos(c.situaciones_riesgo),
          hijos,
          agresores,
          // otros_* desde columna directa o JSON extra
          otros_tipos_violencia: c.otros_tipos_violencia ?? c.extra?.otros_tipos_violencia ?? "",
          otros_medios_agresion: c.otros_medios_agresion ?? c.extra?.otros_medios_agresion ?? "",
          ref_interna_otro: c.ref_interna_otro ?? c.extra?.ref_interna_otro ?? "",
          ref_externa_otro: c.ref_externa_otro ?? c.extra?.ref_externa_otro ?? "",
        });

        // Completar multivalor desde localStorage si aún vienen vacíos
        try {
          const mv = JSON.parse(localStorage.getItem(`caso_mv_${id}`) || "null");
          if (mv) {
            setForm((f) => ({
              ...f,
              tipos_violencia_ids: f.tipos_violencia_ids?.length ? f.tipos_violencia_ids : (mv.tipos_violencia_ids || []),
              medios_agresion_ids: f.medios_agresion_ids?.length ? f.medios_agresion_ids : (mv.medios_agresion_ids || []),
              ref_interna_ids:     f.ref_interna_ids?.length     ? f.ref_interna_ids     : (mv.ref_interna_ids     || []),
              ref_externa_ids:     f.ref_externa_ids?.length     ? f.ref_externa_ids     : (mv.ref_externa_ids     || []),
              situaciones_riesgo:  f.situaciones_riesgo?.length  ? f.situaciones_riesgo  : (mv.situaciones_riesgo  || []),
            }));
          }
        } catch {}

        // Sobreviviente
        if (c?.victima_id) {
          const { data: v } = await getVictimaById(c.victima_id);
          setVictima(v);
        } else {
          setVictima(null);
        }
      } catch (e) {
        console.error(e);
        setMsg(e?.response?.data?.error || "No se pudo cargar el detalle del proceso.");
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  // Cargar catálogos (incluye relaciones del agresor)
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setCargandoCat(true);
        const [
          tiposViolencia,
          mediosAgresion,
          situacionesRiesgo,
          refInterna,
          refExterna,
          estadosCiviles,
          escolaridades,
          etnias,
          municipios,
          departamentos,
          relacionesAgresor,
        ] = await Promise.all([
          getCatalogo("tipos-violencia").then((r) => r.data).catch(() => []),
          getCatalogo("medios-agresion").then((r) => r.data).catch(() => []),
          getCatalogo("situaciones-riesgo").then((r) => r.data).catch(() => []),
          api.get("/catalogos/destinos-ref-interna").then((r) => r.data).catch(() => []),
          api.get("/catalogos/destinos-ref-externa").then((r) => r.data).catch(() => []),
          getCatalogo("estados-civiles").then((r) => r.data).catch(() => []),
          getCatalogo("escolaridades").then((r) => r.data).catch(() => []),
          getCatalogo("etnias").then((r) => r.data).catch(() => []),
          getCatalogo("municipios").then((r) => r.data).catch(() => []),
          getCatalogo("departamentos").then((r) => r.data).catch(() => []),
          getCatalogo("relaciones-agresor").then((r) => r.data).catch(() => []),
        ]);
        if (!alive) return;

        // Conservamos departamento_id para armar “Municipio, Departamento”
        const municipiosNorm = Array.isArray(municipios)
          ? municipios
              .map((x) => ({
                id:
                  x.id ??
                  x.codigo ??
                  x.cod ??
                  x.municipio_id ??
                  x.id_municipio ??
                  x.clave,
                nombre:
                  x.nombre ??
                  x.nombre_municipio ??
                  x.municipio ??
                  x.descripcion ??
                  x.nombreMunicipio ??
                  x.municipio_descripcion ??
                  String(x.id ?? x.codigo ?? x.municipio_id ?? x.id_municipio ?? ""),
                departamento_id:
                  x.departamento_id ??
                  x.depto_id ??
                  x.id_departamento ??
                  x.departamento ??
                  x.dep_id ??
                  null,
              }))
              .filter((m) => m.id != null)
          : [];

        const departamentosNorm = Array.isArray(departamentos)
          ? departamentos.map((x) => ({
              id: x.id ?? x.codigo ?? x.clave ?? x.departamento_id,
              nombre:
                x.nombre ??
                x.departamento ??
                x.descripcion ??
                String(x.id ?? x.codigo ?? x.departamento_id ?? ""),
            }))
          : [];

        const relAgresorNorm = Array.isArray(relacionesAgresor)
          ? relacionesAgresor.map((x) => ({
              id: x.id ?? x.relacion_agresor_id ?? x.codigo ?? x.clave,
              nombre: x.nombre ?? x.descripcion ?? String(x.id ?? ""),
            }))
          : [];

        setCat({
          tiposViolencia,
          mediosAgresion,
          situacionesRiesgo,
          refInterna,
          refExterna,
          estadosCiviles,
          escolaridades,
          etnias,
          municipios: municipiosNorm,
          departamentos: departamentosNorm,
          relacionesAgresor: relAgresorNorm,
        });
      } finally {
        if (alive) setCargandoCat(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  const onChange = (e) => {
    const { name, value, type, checked } = e.target;
    setForm((f) => ({ ...f, [name]: type === "checkbox" ? checked : value }));
  };

  // Detectar id del chip "Otro/Otras"
  const norm = (s) => String(s || "").toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const findOtroId = (list = []) => {
    for (const o of list) {
      const n = norm(o?.nombre);
      if (n === 'otro' || n === 'otra' || n === 'otros' || n === 'otras') return o.id;
    }
    return null;
  };

  async function guardar() {
    try {
      setBusy("guardar");
      setMsg("");
      const payload = {
        motivo_consulta: emptyToNull(form.motivo_consulta),
        fecha_atencion: form.fecha_atencion || null,
        residencia: emptyToNull(form.residencia),
        telefono: emptyToNull(form.telefono),
        municipio_id: form.municipio_id ? Number(form.municipio_id) : null,
        sexual_conocido: !!form.sexual_conocido,
        embarazo_semanas: form.embarazo_semanas ? Number(form.embarazo_semanas) : null,
        tiempo_agresion: emptyToNull(form.tiempo_agresion),
        riesgo_otro: emptyToNull(form.riesgo_otro),
        // textos libres si aplica
        otros_tipos_violencia: emptyToNull(form.otros_tipos_violencia),
        otros_medios_agresion: emptyToNull(form.otros_medios_agresion),
        ref_interna_otro: emptyToNull(form.ref_interna_otro),
        ref_externa_otro: emptyToNull(form.ref_externa_otro),
        acciones: emptyToNull(form.acciones),
        // multivalor (el backend los toma de forma idempotente si vienen)
        tipos_violencia_ids: form.tipos_violencia_ids,
        medios_agresion_ids: form.medios_agresion_ids,
        ref_interna_ids: form.ref_interna_ids,
        ref_externa_ids: form.ref_externa_ids,
        situaciones_riesgo: form.situaciones_riesgo,
      };
      await updateCaso(id, payload);

      // Respaldo local
      try {
        const backup = {
          tipos_violencia_ids: form.tipos_violencia_ids,
          medios_agresion_ids: form.medios_agresion_ids,
          ref_interna_ids: form.ref_interna_ids,
          ref_externa_ids: form.ref_externa_ids,
          situaciones_riesgo: form.situaciones_riesgo,
          otros_tipos_violencia: form.otros_tipos_violencia,
          otros_medios_agresion: form.otros_medios_agresion,
          ref_interna_otro: form.ref_interna_otro,
          ref_externa_otro: form.ref_externa_otro,
          hijos: form.hijos,
          agresores: form.agresores,
        };
        localStorage.setItem(`caso_mv_${id}`, JSON.stringify(backup));
      } catch {}

      setEdit(false);

      const { data: c2 } = await getCasoById(id);
      setCaso(c2);
      setMsg("Cambios guardados.");
    } catch (e) {
      console.error(e);
      setMsg(e?.response?.data?.error || "No se pudo guardar.");
    } finally {
      setBusy("");
    }
  }

  // Helpers multivalor (riesgos)
  function addRiesgo() {
    setForm((f) => ({
      ...f,
      situaciones_riesgo: [...(f.situaciones_riesgo || []), { situacion_id: "", detalle: "" }],
    }));
  }
  function delRiesgo(idx) {
    setForm((f) => ({
      ...f,
      situaciones_riesgo: (f.situaciones_riesgo || []).filter((_, i) => i !== idx),
    }));
  }
  function updRiesgo(idx, key, val) {
    setForm((f) => ({
      ...f,
      situaciones_riesgo: (f.situaciones_riesgo || []).map((r, i) =>
        i === idx ? { ...r, [key]: val } : r
      ),
    }));
  }

  async function enviarRevision() {
    if (!isBorrador) return;
    if (!window.confirm("¿Enviar a revisión?")) return;
    try {
      setBusy("enviar");
      setMsg("");
      await enviarRevisionApi(id);
      const { data: c2 } = await getCasoById(id);
      setCaso(c2);
      setEdit(false);
      setMsg("Proceso enviado a revisión.");
    } catch (e) {
      console.error(e);
      setMsg(e?.response?.data?.error || "No se pudo enviar a revisión.");
    } finally {
      setBusy("");
    }
  }

  async function eliminar() {
    if (!window.confirm("¿Eliminar este proceso? Esta acción no se puede deshacer.")) {
      return;
    }
    try {
      setBusy("eliminar");
      setMsg("");
      await deleteCaso(id);
      nav(BASE);
    } catch (e) {
      console.error(e);
      setMsg(e?.response?.data?.error || "No se pudo eliminar.");
    } finally {
      setBusy("");
    }
  }

  const nombreVictima =
    victima?.nombre ||
    [victima?.primer_nombre, victima?.segundo_nombre, victima?.primer_apellido, victima?.segundo_apellido]
      .filter(Boolean)
      .join(" ");

  return (
    <div className="cd-wrap">
      <div className="cd-header">
        <div className="cd-header-l">
          <Link to={BASE} className="cd-back">← Volver</Link>
          <h2>Detalle del proceso #{id}</h2>
          {caso && (
            <div className="cd-header-meta">
              <EstadoBadge estado={caso.estado} />
              <span className="cd-dot">•</span>
              <span>Área: <b>{caso.area_id ?? "-"}</b></span>
            </div>
          )}
        </div>
      </div>

      {loading && <div className="cd-card"><div className="cd-muted">Cargando…</div></div>}
      {msg && <div className="cd-alert">{msg}</div>}

      {!loading && caso && (
        <div className="cd-card">
          {/* SOBREviviente */}
          <section className="cd-section">
            <h3>Sobreviviente</h3>
            <div className="cd-grid">
              <Item label="Nombre">{nombreVictima || "-"}</Item>
              <Item label="DPI">{victima?.dpi || victima?.cui || "-"}</Item>
              <Item label="Teléfono">{victima?.telefono || "-"}</Item>
              <Item label="Estado civil">
                {nombreDe(cat.estadosCiviles, victima?.estado_civil_id) ||
                  victima?.estado_civil ||
                  "-"}
              </Item>
              <Item label="Fecha de nacimiento">
                {victima?.fecha_nacimiento
                  ? new Date(victima.fecha_nacimiento).toLocaleDateString("es-GT")
                  : "-"}
              </Item>
              <Item label="Escolaridad">
                {nombreDe(cat.escolaridades, victima?.escolaridad_id) || "-"}
              </Item>
              <Item label="Etnia">
                {nombreDe(cat.etnias, victima?.etnia_id) || "-"}
              </Item>
              <Item label="Ocupación">{victima?.ocupacion || "-"}</Item>

              {/* DIRECCIÓN: prioriza direccion_actual */}
              <Item label="Dirección">
                {pickAny(
                  victima,
                  [
                    "direccion_actual", "direccionActual", "direccion_victima",
                    "direccion_residencia", "direccion", "domicilio",
                    "direccion_completa", "direccion_exacta", "calle_avenida",
                    "zona", "barrio_direccion", "direccion_casa",
                  ],
                  /(dir|domic|calle|avenida|zona)/i
                ) || caso?.direccion || "-"}
              </Item>

              <Item label="Residencia">
                {pickAny(
                  victima,
                  ["residencia","barrio","barrio_colonia","colonia","aldea","lugar_residencia","residencia_domicilio"],
                  /(resid|barrio|colonia|aldea)/i
                ) || caso?.residencia || "-"}
              </Item>

              <Item label="Nacionalidad">{victima?.nacionalidad || "-"}</Item>

              {/* LUGAR DE ORIGEN */}
              <Item label="Lugar de origen">
                {prettyLugarOrigen(victima, cat) || "-"}
              </Item>
            </div>
            {!victima && <div className="cd-muted">No se pudieron cargar los datos de la sobreviviente.</div>}
          </section>

          {/* MULTIVALOR: Tipos de violencia */}
          <section className="cd-section">
            <h3>Tipos de violencia</h3>
            {!edit ? (
              <div className="cd-grid">
                <Item label="Seleccionados">
                  {renderConOtro(cat.tiposViolencia, form.tipos_violencia_ids, form.otros_tipos_violencia)}
                </Item>
              </div>
            ) : (
              <div className="cd-grid">
                <EditItem label="Selecciona uno o más">
                  {cargandoCat ? (
                    <div className="cd-muted">Cargando catálogos.</div>
                  ) : (
                    <MultiSelect
                      options={cat.tiposViolencia}
                      selected={form.tipos_violencia_ids}
                      onChange={(ids) =>
                        setForm((f) => ({ ...f, tipos_violencia_ids: ids }))
                      }
                    />
                  )}
                </EditItem>
                {(() => {
                  const otroId = findOtroId(cat.tiposViolencia);
                  const show = otroId != null && (form.tipos_violencia_ids || []).includes(otroId);
                  return (
                    show && (
                      <EditItem label="Otras (especifica)">
                        <input
                          name="otros_tipos_violencia"
                          value={form.otros_tipos_violencia}
                          onChange={onChange}
                          placeholder="Describe otras violencias"
                        />
                      </EditItem>
                    )
                  );
                })()}
              </div>
            )}
          </section>

          {/* MULTIVALOR: Medios de agresión */}
          <section className="cd-section">
            <h3>Medios de agresión</h3>
            {!edit ? (
              <div className="cd-grid">
                <Item label="Seleccionados">
                  {renderConOtro(cat.mediosAgresion, form.medios_agresion_ids, form.otros_medios_agresion)}
                </Item>
              </div>
            ) : (
              <div className="cd-grid">
                <EditItem label="Selecciona uno o más">
                  {cargandoCat ? (
                    <div className="cd-muted">Cargando catálogos.</div>
                  ) : (
                    <MultiSelect
                      options={cat.mediosAgresion}
                      selected={form.medios_agresion_ids}
                      onChange={(ids) =>
                        setForm((f) => ({ ...f, medios_agresion_ids: ids }))
                      }
                    />
                  )}
                </EditItem>
                {(() => {
                  const otroId = findOtroId(cat.mediosAgresion);
                  const show = otroId != null && (form.medios_agresion_ids || []).includes(otroId);
                  return (
                    show && (
                      <EditItem label="Otros (especifica)">
                        <input
                          name="otros_medios_agresion"
                          value={form.otros_medios_agresion}
                          onChange={onChange}
                          placeholder="Describe otros medios de agresión"
                        />
                      </EditItem>
                    )
                  );
                })()}
              </div>
            )}
          </section>

          {/* MULTIVALOR: Situaciones de riesgo */}
          <section className="cd-section">
            <h3>Situaciones de riesgo</h3>
            {!edit ? (
              <div className="cd-grid">
                {form.situaciones_riesgo?.length ? (
                  form.situaciones_riesgo.map((r, i) => (
                    <Item key={i} label={`Riesgo #${i + 1}`}>
                      {nombreDe(cat.situacionesRiesgo, r.situacion_id) || "-"}
                      {r.detalle ? ` — ${r.detalle}` : ""}
                    </Item>
                  ))
                ) : (
                  <div className="cd-muted">Sin registros.</div>
                )}
              </div>
            ) : (
              <div className="cd-grid">
                {form.situaciones_riesgo.map((r, i) => (
                  <EditItem key={i} label={`Riesgo #${i + 1}`}>
                    <select
                      value={r.situacion_id}
                      onChange={(e) => updRiesgo(i, "situacion_id", e.target.value)}
                    >
                      <option value="">- Selecciona -</option>
                      {cat.situacionesRiesgo.map((o) => (
                        <option key={o.id} value={o.id}>{o.nombre}</option>
                      ))}
                    </select>
                    <input
                      style={{ marginLeft: 8 }}
                      value={r.detalle || ""}
                      onChange={(e) => updRiesgo(i, "detalle", e.target.value)}
                      placeholder="Detalle (opcional)"
                    />
                    <button
                      type="button"
                      className="btn-danger"
                      style={{ marginLeft: 8 }}
                      onClick={() => delRiesgo(i)}
                    >
                      Quitar
                    </button>
                  </EditItem>
                ))}
                <EditItem label="">
                  <button type="button" className="btn-secondary" onClick={addRiesgo}>
                    Añadir riesgo
                  </button>
                </EditItem>
              </div>
            )}
          </section>

          {/* REFERENCIAS */}
          <section className="cd-section">
            <h3>Referencias</h3>
            {!edit ? (
              <div className="cd-grid">
                <Item label="Interna">{renderConOtro(cat.refInterna, form.ref_interna_ids, form.ref_interna_otro)}</Item>
                <Item label="Externa">{renderConOtro(cat.refExterna, form.ref_externa_ids, form.ref_externa_otro)}</Item>
              </div>
            ) : (
              <div className="cd-grid">
                <EditItem label="Interna">
                  {cargandoCat ? (
                    <div className="cd-muted">Cargando catálogos.</div>
                  ) : (
                    <MultiSelect
                      options={cat.refInterna}
                      selected={form.ref_interna_ids}
                      onChange={(ids) =>
                        setForm((f) => ({ ...f, ref_interna_ids: ids }))
                      }
                    />
                  )}
                </EditItem>
                {(() => {
                  const otroId = findOtroId(cat.refInterna);
                  const show = otroId != null && (form.ref_interna_ids || []).includes(otroId);
                  return (
                    show && (
                      <EditItem label="Interna (otro)">
                        <input
                          name="ref_interna_otro"
                          value={form.ref_interna_otro}
                          onChange={onChange}
                          placeholder="Especifica la referencia interna"
                        />
                      </EditItem>
                    )
                  );
                })()}
                <EditItem label="Externa">
                  {cargandoCat ? (
                    <div className="cd-muted">Cargando catálogos.</div>
                  ) : (
                    <MultiSelect
                      options={cat.refExterna}
                      selected={form.ref_externa_ids}
                      onChange={(ids) =>
                        setForm((f) => ({ ...f, ref_externa_ids: ids }))
                      }
                    />
                  )}
                </EditItem>
                {(() => {
                  const otroId = findOtroId(cat.refExterna);
                  const show = otroId != null && (form.ref_externa_ids || []).includes(otroId);
                  return (
                    show && (
                      <EditItem label="Externa (otro)">
                        <input
                          name="ref_externa_otro"
                          value={form.ref_externa_otro}
                          onChange={onChange}
                          placeholder="Especifica la referencia externa"
                        />
                      </EditItem>
                    )
                  );
                })()}
              </div>
            )}
          </section>

          {/* HIJAS E HIJOS — SOLO LECTURA (con fallback) */}
          <section className="cd-section">
            <h3>Hijas e hijos</h3>
            <div className="cd-grid">
              {(caso?.hijos?.length || form?.hijos?.length) ? (
                (caso?.hijos?.length ? caso.hijos : form.hijos).map((h, i) => (
                  <Item key={i} label={`Hijo/a #${i + 1}`}>
                    {[
                      (h?.nombre && String(h.nombre).trim()) || "Sin nombre",
                      `(${sexoLabel(h?.sexo)}`,
                      (h?.edad_anios != null && h.edad_anios !== "" ? `${Number(h.edad_anios)} años` : "edad no indicada"),
                      `— ${h?.reconocido ? "reconocido/a" : "no reconocido/a"})`
                    ].filter(Boolean).join(" ")}
                  </Item>
                ))
              ) : (
                <div className="cd-muted">No se tienen hijas o hijos registrados.</div>
              )}
            </div>
          </section>

          {/* AGRESORES — SOLO LECTURA (con fallback) */}
          <section className="cd-section">
            <h3>Agresores</h3>
            {(caso?.agresores?.length || form?.agresores?.length) ? (
              (caso?.agresores?.length ? caso.agresores : form.agresores).map((a, i) => (
                <div key={i} className="cd-grid">
                  <Item label={`Agresor #${i + 1}`}>{(a?.nombre && String(a.nombre).trim()) || "Sin nombre"}</Item>
                  <Item label="Relación con la sobreviviente">
                    {nombreDe(cat.relacionesAgresor, a?.relacion_agresor_id) || "-"}
                  </Item>
                  <Item label="Edad">{a?.edad != null && a.edad !== "" ? `${Number(a.edad)} años` : "-"}</Item>
                  <Item label="Documento">{a?.dpi_pasaporte || "-"}</Item>
                  <Item label="Ocupación">{a?.ocupacion || "-"}</Item>
                  <Item label="Teléfono">{a?.telefono || "-"}</Item>
                  <Item label="Ingreso mensual">{a?.ingreso_mensual != null ? qMoneda(a.ingreso_mensual) : "-"}</Item>
                  <Item label="Dirección">{a?.direccion || "-"}</Item>
                  <Item label="Lugar de residencia">{a?.lugar_residencia || "-"}</Item>
                  <Item label="Lugar de trabajo">{a?.lugar_trabajo || "-"}</Item>
                  <Item label="Horario de trabajo">{a?.horario_trabajo || "-"}</Item>
                  <Item label="Observación">{a?.observacion || "-"}</Item>
                </div>
              ))
            ) : (
              <div className="cd-muted">Se desconoce al agresor.</div>
            )}
          </section>

          {/* CASO */}
          <section className="cd-section">
            <h3>Datos del proceso</h3>

            {!edit ? (
              <div className="cd-grid">
                <Item label="Fecha de atención">
                  {caso.fecha_atencion
                    ? new Date(caso.fecha_atencion).toISOString().slice(0, 10)
                    : "-"}
                </Item>
                <Item label="Motivo de la consulta">{caso.motivo_consulta || "-"}</Item>
                <Item label="Residencia">{caso.residencia || "-"}</Item>
                <Item label="Teléfono">{caso.telefono || "-"}</Item>

                {/* MUNICIPIO del caso */}
                <Item label="Municipio">
                  {prettyMunicipioCaso(caso, victima, cat) || "-"}
                </Item>

                <Item label="Agresor sexual conocido">
                  {caso.sexual_conocido ? "Sí" : "No"}
                </Item>
                <Item label="Semanas de gestación">{caso.embarazo_semanas || "-"}</Item>
                <Item label="Tiempo de agresión">{caso.tiempo_agresion || "-"}</Item>
                <Item label="Otro riesgo">{caso.riesgo_otro || "-"}</Item>
                <Item label="Acciones realizadas">{caso.acciones || "-"}</Item>
              </div>
            ) : (
              <div className="cd-grid">
                <EditItem label="Fecha de atención">
                  <input
                    type="date"
                    name="fecha_atencion"
                    value={form.fecha_atencion}
                    onChange={onChange}
                  />
                </EditItem>
                <EditItem label="Motivo de la consulta">
                  <input
                    name="motivo_consulta"
                    value={form.motivo_consulta}
                    onChange={onChange}
                    placeholder="Motivo…"
                  />
                </EditItem>
                <EditItem label="Residencia">
                  <input
                    name="residencia"
                    value={form.residencia}
                    onChange={onChange}
                    placeholder="Colonia/Barrio…"
                  />
                </EditItem>
                <EditItem label="Teléfono">
                  <input
                    name="telefono"
                    value={form.telefono}
                    onChange={onChange}
                    placeholder="Ej. 5555-5555"
                  />
                </EditItem>
                <EditItem label="Municipio">
                  {cargandoCat ? (
                    <div className="cd-muted">Cargando catálogos…</div>
                  ) : (
                    <select
                      name="municipio_id"
                      value={String(form.municipio_id ?? "")}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, municipio_id: e.target.value }))
                      }
                    >
                      <option value="">— Selecciona —</option>
                      {cat.municipios.map((m) => {
                        const depto =
                          nombreDe(cat.departamentos, m.departamento_id) || "";
                        const label = depto ? `${m.nombre}, ${depto}` : m.nombre;
                        return (
                          <option key={m.id} value={String(m.id)}>
                            {label}
                          </option>
                        );
                      })}
                    </select>
                  )}
                </EditItem>
                <EditItem label="Agresor sexual conocido">
                  <label className="cd-check">
                    <input
                      type="checkbox"
                      name="sexual_conocido"
                      checked={!!form.sexual_conocido}
                      onChange={onChange}
                    />
                    <span>Conocido</span>
                  </label>
                </EditItem>
                <EditItem label="Semanas de gestación">
                  <input
                    name="embarazo_semanas"
                    value={form.embarazo_semanas}
                    onChange={onChange}
                    placeholder="Ej. 12"
                  />
                </EditItem>
                <EditItem label="Tiempo de agresión">
                  <input
                    name="tiempo_agresion"
                    value={form.tiempo_agresion}
                    onChange={onChange}
                    placeholder="Ej. 2 años, ocasional"
                  />
                </EditItem>
                <EditItem label="Otro riesgo (texto libre)">
                  <input
                    name="riesgo_otro"
                    value={form.riesgo_otro}
                    onChange={onChange}
                    placeholder="Detalle (opcional)"
                  />
                </EditItem>
                <EditItem label="Acciones realizadas">
                  <textarea
                    name="acciones"
                    rows={4}
                    value={form.acciones}
                    onChange={onChange}
                    placeholder="Describe las acciones realizadas…"
                  />
                </EditItem>
              </div>
            )}
          </section>

          {/* ACCIONES */}
          <div className="cd-actions">
            <button className="btn-secondary" onClick={() => nav(-1)}>
              Volver
            </button>

            {!edit ? (
              <button
                className="btn-primary"
                onClick={() => setEdit(true)}
                disabled={!isBorrador}
                title={isBorrador ? "" : "Solo editable en estado Borrador"}
              >
                Editar
              </button>
            ) : (
              <>
                <button className="btn-primary" onClick={guardar} disabled={busy === "guardar"}>
                  {busy === "guardar" ? "Guardando…" : "Guardar"}
                </button>
                <button
                  className="btn-secondary"
                  onClick={() => {
                    setEdit(false);
                    setForm({
                      motivo_consulta: caso.motivo_consulta ?? "",
                      fecha_atencion: caso.fecha_atencion ? new Date(caso.fecha_atencion).toISOString().slice(0, 10) : "",
                      residencia: caso.residencia ?? "",
                      telefono: caso.telefono ?? "",
                      municipio_id: caso.municipio_id ?? "",
                      sexual_conocido: !!caso.sexual_conocido,
                      embarazo_semanas: caso.embarazo_semanas ?? "",
                      tiempo_agresion: caso.tiempo_agresion ?? "",
                      riesgo_otro: caso.riesgo_otro ?? "",
                      acciones: caso.acciones ?? "",
                      tipos_violencia_ids: form.tipos_violencia_ids || [],
                      medios_agresion_ids: form.medios_agresion_ids || [],
                      ref_interna_ids: form.ref_interna_ids || [],
                      ref_externa_ids: form.ref_externa_ids || [],
                      situaciones_riesgo: form.situaciones_riesgo || [],
                      hijos: form.hijos || [],
                      agresores: form.agresores || [],
                    });
                  }}
                >
                  Cancelar
                </button>
              </>
            )}

            {isBorrador && (
              <button
                className="btn-green"
                onClick={enviarRevision}
                disabled={busy === "enviar" || edit}
                title={edit ? "Guarda los cambios antes de enviar" : ""}
              >
                {busy === "enviar" ? "Enviando…" : "Enviar a revisión"}
              </button>
            )}

            <div className="cd-spacer" />
            {/* ⬇️ NUEVO: deshabilitar si está completado */}
            <button
              className="btn-danger"
              onClick={eliminar}
              disabled={busy === "eliminar" || isCompletado}
              title={isCompletado ? "No se puede eliminar un proceso completado" : ""}
            >
              {busy === "eliminar" ? "Eliminando…" : "Eliminar"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ========= Subcomponentes UI ========= */
const Item = ({ label, children }) => (
  <div className="cd-item">
    <div className="cd-label">{label}</div>
    <div className="cd-value">{children}</div>
  </div>
);
const EditItem = ({ label, children }) => (
  <div className="cd-item">
    <div className="cd-label">{label}</div>
    <div className="cd-value cd-value-edit">{children}</div>
  </div>
);

function MultiSelect({ options = [], selected = [], onChange }) {
  const selectedS = (selected || []).map((x) => String(x));
  const onToggle = (id) => {
    const sId = String(id);
    const has = selectedS.includes(sId);
    const next = has
      ? (selected || []).filter((x) => String(x) !== sId)
      : [...(selected || []), id];
    onChange(next);
  };
  return (
    <div>
      {options.map((o) => (
        <label
          key={o.id}
          style={{ display: "inline-flex", alignItems: "center", marginRight: 12, marginBottom: 6 }}
        >
          <input
            type="checkbox"
            checked={selectedS.includes(String(o.id))}
            onChange={() => onToggle(o.id)}
          />
          <span style={{ marginLeft: 6 }}>{displayNombre(o) || o.id}</span>
        </label>
      ))}
    </div>
  );
}

/* ===== Helpers ===== */
function displayNombre(o) {
  return (
    o?.nombre ??
    o?.descripcion ??
    o?.label ??
    o?.nombre_municipio ??
    o?.municipio ??
    o?.nombreMunicipio ??
    o?.municipio_descripcion ??
    null
  );
}
function nombreDe(options, id) {
  if (id == null || id === "") return null;
  const arr = options || [];
  const sId = String(id);
  const o = arr.find(
    (x) =>
      String(
        x.id ?? x.codigo ?? x.cod ?? x.municipio_id ?? x.clave ?? x.departamento_id
      ) === sId
  );
  if (!o) return null;
  return displayNombre(o);
}
function renderNombres(options, ids) {
  if (!ids?.length) return "-";
  const keyOf = (x) => String(x.id ?? x.codigo ?? x.cod ?? x.municipio_id ?? x.departamento_id ?? x.clave);
  const map = new Map((options || []).map((o) => [keyOf(o), displayNombre(o) || String(o.id)]));
  const names = ids.map((id) => map.get(String(id))).filter(Boolean);
  return names.length ? names.join(", ") : ids.join(", ");
}
function renderConOtro(options, ids, extraText) {
  const base = renderNombres(options, ids);
  const txt = String(extraText || '').trim();
  if (!txt) return base;
  const parts = base.split(',').map((s) => s.trim());
  const isOtro = (s) => {
    const n = s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    return n === 'otro' || n === 'otra' || n === 'otros' || n === 'otras';
  };
  const replaced = parts.map((p) => (isOtro(p) ? `${p}: ${txt}` : p));
  return replaced.join(', ');
}
function emptyToNull(v) {
  const s = String(v ?? "").trim();
  return s ? s : null;
}
function pickAny(obj, keys = [], regex = null) {
  if (!obj) return null;
  for (const k of keys) {
    const val = obj?.[k];
    if (val != null && String(val).trim() !== "") return val;
  }
  if (regex) {
    for (const k of Object.keys(obj)) {
      if (regex.test(k)) {
        const val = obj[k];
        if (val != null && String(val).trim() !== "") return val;
      }
    }
  }
  return null;
}
function isNumeric(x) {
  if (x == null) return false;
  const n = Number(x);
  return Number.isFinite(n) && String(x).trim() !== "";
}

/* Catálogo helpers */
function findById(list, id) {
  return (list || []).find((o) => String(o.id) === String(id)) || null;
}
function municipioYDepto(cat, muniId) {
  if (!isNumeric(muniId)) return null;
  const muni = findById(cat.municipios, muniId);
  if (!muni) return nombreDe(cat.municipios, muniId) || `(${muniId})`;
  const depto = muni.departamento_id != null ? findById(cat.departamentos, muni.departamento_id) : null;
  return depto ? `${muni.nombre}, ${depto?.nombre || ""}`.replace(/,\s*$/, "") : muni.nombre;
}

/** Municipio mostrado en "Datos del caso"
 * Prioridad: caso.municipio_id -> texto en caso -> municipio de residencia de la víctima
 */
function prettyMunicipioCaso(caso, victima, cat) {
  // 1) ID numérico en caso
  if (isNumeric(caso?.municipio_id)) {
    const out = municipioYDepto(cat, caso.municipio_id);
    return out || `(${caso.municipio_id})`;
  }
  // 2) Texto/código en caso
  const fromCasoText = pickAny(
    caso,
    ["municipio_nombre", "municipio_texto", "municipio"],
    /muni/i
  );
  if (fromCasoText) {
    if (isNumeric(fromCasoText))
      return municipioYDepto(cat, fromCasoText) || String(fromCasoText);
    return String(fromCasoText);
  }
  // 3) Fallback a víctima (municipio de residencia)
  const vicMuniId =
    victima?.municipio_residencia_id ??
    victima?.residencia_municipio_id ??
    victima?.municipio_id ??
    victima?.id_municipio;
  if (isNumeric(vicMuniId)) {
    const out = municipioYDepto(cat, vicMuniId);
    return out || `(${vicMuniId})`;
  }
  const vicMuniTxt = pickAny(
    victima,
    ["municipio_nombre", "residencia_municipio", "municipio_texto"],
    /muni/i
  );
  return vicMuniTxt ? String(vicMuniTxt) : null;
}

/** Lugar de origen (víctima) */
function prettyLugarOrigen(victima, cat) {
  if (!victima) return null;

  // Posibles IDs
  const muniId =
    victima.municipio_origen_id ??
    victima.municipioOrigenId ??
    victima.municipio_de_origen_id ??
    victima.origen_municipio_id ??
    victima.lugar_origen_municipio_id ??
    victima.mun_origen_id ??
    victima.mun_origen;

  if (muniId != null) {
    const out = municipioYDepto(cat, muniId);
    if (out) return out;
  }

  // Nombres sueltos
  const raw = pickAny(
    victima,
    [
      "lugar_origen","lugar_de_origen","origen","procedencia",
      "lugar_procedencia","lugar_nacimiento","origen_texto",
    ],
    /(origen|proced|nacim|depto|muni)/i
  );
  if (raw != null && String(raw).trim() !== "") {
    const s = String(raw);
    if (!/^\d{4}-\d{2}-\d{2}/.test(s)) {
      if (isNumeric(s)) {
        return municipioYDepto(cat, s) || nombreDe(cat.departamentos, s) || s;
      }
      return s;
    }
  }

  // Extranjera (datos en extra)
  if (victima.extra && typeof victima.extra === "object") {
    const ciudad = victima.extra.ciudad_origen || victima.extra.ciudadOrigen;
    const deptoExt = victima.extra.depto_origen_extranjero || victima.extra.deptoOrigenExtranjero;
    const pais = victima.extra.pais_origen || victima.extra.paisOrigen;
    const parts = [ciudad, deptoExt, pais].map((x) => (x && String(x).trim()) || null).filter(Boolean);
    if (parts.length) return parts.join(" / ");
  }

  return null;
}

/* Presentación */
function sexoLabel(s) {
  const v = String(s || "").toUpperCase();
  return v === "M" ? "Masculino" : v === "F" ? "Femenino" : "Sexo no indicado";
}
function qMoneda(n) {
  const num = Number(n);
  if (!Number.isFinite(num)) return String(n ?? "-");
  return `Q ${num.toLocaleString("es-GT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/* ✅ Helpers de área (incluye EspaciosLibres) */
function inferAreaFromPath(pathname = "") {
  const p = String(pathname || "").toLowerCase();
  if (p.includes("/espacioslibres")) return "espacioslibres";
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
    return ({ 1: "social", 2: "legal", 3: "medica", 4: "psicologica", 5: "albergue", 6: "espacioslibres" }[n]) || "social";
  }
  const map = {
    social: "social", s: "social", soc: "social",
    legal: "legal", l: "legal",
    medica: "medica", "médica": "medica", m: "medica", med: "medica",
    psicologica: "psicologica", "psicológica": "psicologica", psi: "psicologica", p: "psicologica",
    albergue: "albergue", a: "albergue",
    espacioslibres: "espacioslibres", "espacios libres": "espacioslibres", espacios: "espacioslibres", el: "espacioslibres",
  };
  return map[s] || "social";
}
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
