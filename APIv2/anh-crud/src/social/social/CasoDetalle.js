// src/servicios/CasoDetalle.js
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
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

  const [caso, setCaso] = useState(null);
  const [victima, setVictima] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");

  // Edición inline
  const [edit, setEdit] = useState(false);

  // ✅ snapshot para Cancelar edición correctamente
  const [formSnapshot, setFormSnapshot] = useState(null);

  // ✅ NUEVO: edición sobreviviente
  const [victimaForm, setVictimaForm] = useState({
    primer_nombre: "",
    segundo_nombre: "",
    primer_apellido: "",
    segundo_apellido: "",
    nombre: "",
    dpi: "",
    telefono: "",
    fecha_nacimiento: "",
    estado_civil_id: "",
    escolaridad_id: "",
    etnia_id: "",
    ocupacion: "",
    direccion_actual: "",
    residencia: "",
    nacionalidad: "",
    municipio_origen_id: "",
    lugar_origen: "",
  });
  const [victimaSnapshot, setVictimaSnapshot] = useState(null);

  // ✅ NUEVO: deletes (para hijos/agresores)
  const [hijosDeleted, setHijosDeleted] = useState([]);
  const [agresoresDeleted, setAgresoresDeleted] = useState([]);

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
    municipios: [],
    departamentos: [],
    relacionesAgresor: [],
    residencias: [],
    ocupaciones: [],
  });
  const [cargandoCat, setCargandoCat] = useState(true);

  const isBorrador = useMemo(
    () => String(caso?.estado || "").toLowerCase() === "borrador",
    [caso]
  );

  const isCompletado = useMemo(
    () => String(caso?.estado || "").toLowerCase() === "completado",
    [caso]
  );

  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        if (!alive) return;

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

        if (!alive) return;

        setCaso({ ...c, hijos, agresores });

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
          if (!alive) return;
          setVictima(v);

          // ✅ NUEVO: inicializa victimaForm
          setVictimaForm({
            primer_nombre: v?.primer_nombre ?? "",
            segundo_nombre: v?.segundo_nombre ?? "",
            primer_apellido: v?.primer_apellido ?? "",
            segundo_apellido: v?.segundo_apellido ?? "",
            nombre: v?.nombre ?? v?.nombre_completo ?? "",
            dpi: v?.dpi ?? v?.cui ?? "",
            telefono: v?.telefono ?? "",
            fecha_nacimiento: v?.fecha_nacimiento ? new Date(v.fecha_nacimiento).toISOString().slice(0, 10) : "",
            estado_civil_id: v?.estado_civil_id ?? "",
            escolaridad_id: v?.escolaridad_id ?? "",
            etnia_id: v?.etnia_id ?? "",
            ocupacion: v?.ocupacion ?? "",
            direccion_actual: v?.direccion_actual ?? v?.direccion ?? "",
            residencia: v?.residencia ?? v?.barrio_colonia ?? "",
            nacionalidad: v?.nacionalidad ?? "",
            municipio_origen_id: v?.municipio_origen_id ?? "",
            lugar_origen: v?.lugar_origen ?? v?.lugar_de_origen ?? "",
          });
        } else {
          if (!alive) return;
          setVictima(null);
        }
      } catch (e) {
        console.error(e);
        if (!alive) return;
        setMsg(e?.response?.data?.error || "No se pudo cargar el detalle del proceso.");
      } finally {
        if (!alive) return;
        setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [id]);

  // Cargar catálogos
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
        residencias,
        ocupaciones,
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
          getCatalogo("residencias").then((r) => r.data).catch(() => []),
          api.get("/catalogos/ocupaciones").then((r) => r.data).catch(() => []),
        ]);
        if (!alive) return;

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

        const residenciasNorm = Array.isArray(residencias)
          ? residencias
              .map((x) => ({
                id: x.id ?? x.codigo ?? x.clave ?? x.residencia_id,
                nombre: x.nombre ?? x.descripcion ?? x.label ?? String(x.id ?? ""),
              }))
              .filter((r) => r?.nombre && String(r.nombre).trim() !== "")
          : [];

        const ocupacionesRaw = Array.isArray(ocupaciones)
          ? ocupaciones
          : (Array.isArray(ocupaciones?.data) ? ocupaciones.data : []);
        const ocupacionesNorm = (ocupacionesRaw || [])
          .map((o) => {
            const nombre =
              o?.nombre ??
              o?.ocupacion ??
              o?.actividad ??
              o?.descripcion ??
              o?.label;
            const id =
              o?.id ??
              o?.ocupacion_id ??
              o?.actividad_id ??
              nombre;
            return nombre ? { id, nombre } : null;
          })
          .filter(Boolean);

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
          residencias: residenciasNorm,
          ocupaciones: ocupacionesNorm,
        });
      } finally {
        if (alive) setCargandoCat(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const onChange = (e) => {
    const { name, value, type, checked } = e.target;
    setForm((f) => ({ ...f, [name]: type === "checkbox" ? checked : value }));
  };

  const onVictimaChange = (e) => {
    const { name, value } = e.target;
    setVictimaForm((v) => ({ ...v, [name]: value }));
  };

  // Detectar id del chip "Otro/Otras"
  const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const findOtroId = (list = []) => {
    for (const o of list) {
      const n = norm(o?.nombre);
      if (n === "otro" || n === "otra" || n === "otros" || n === "otras") return o.id;
    }
    return null;
  };

  // ✅ snapshot profundo
  const cloneForm = (obj) => {
    try {
      return JSON.parse(JSON.stringify(obj));
    } catch {
      return obj;
    }
  };

  // ✅ NUEVO: helpers hijos/agresores (edición)
  function addHijo() {
    setForm((f) => ({
      ...f,
      hijos: [...(f.hijos || []), { id: null, nombre: "", sexo: "F", edad_anios: "", reconocido: false }],
    }));
  }
  function updHijo(idx, key, val) {
    setForm((f) => ({
      ...f,
      hijos: (f.hijos || []).map((h, i) => (i === idx ? { ...h, [key]: val } : h)),
    }));
  }
  function delHijo(idx) {
    setForm((f) => {
      const arr = [...(f.hijos || [])];
      const item = arr[idx];
      if (item?.id) setHijosDeleted((d) => [...d, item.id]);
      arr.splice(idx, 1);
      return { ...f, hijos: arr };
    });
  }

  function addAgresor() {
    setForm((f) => ({
      ...f,
      agresores: [
        ...(f.agresores || []),
        {
          id: null,
          nombre: "",
          relacion_agresor_id: "",
          edad: "",
          dpi_pasaporte: "",
          ocupacion: "",
          telefono: "",
          ingreso_mensual: "",
          direccion: "",
          lugar_residencia: "",
          lugar_trabajo: "",
          horario_trabajo: "",
          observacion: "",
        },
      ],
    }));
  }
  function updAgresor(idx, key, val) {
    setForm((f) => ({
      ...f,
      agresores: (f.agresores || []).map((a, i) => (i === idx ? { ...a, [key]: val } : a)),
    }));
  }
  function delAgresor(idx) {
    setForm((f) => {
      const arr = [...(f.agresores || [])];
      const item = arr[idx];
      if (item?.id) setAgresoresDeleted((d) => [...d, item.id]);
      arr.splice(idx, 1);
      return { ...f, agresores: arr };
    });
  }

  // ✅ NUEVO: try endpoints sin romper (si no existen, no explota)
  async function tryPutVictima(vId, payload) {
    try {
      return await api.put(`/victimas/${vId}`, payload, { headers: { "Content-Type": "application/json" } });
    } catch {
      return await api.patch(`/victimas/${vId}`, payload, { headers: { "Content-Type": "application/json" } });
    }
  }

  async function tryUpsertHijo(casoId, h) {
    const payload = {
      caso_id: Number(casoId),
      nombre: emptyToNull(h.nombre),
      sexo: emptyToNull(h.sexo),
      edad_anios: h.edad_anios === "" ? null : Number(h.edad_anios),
      reconocido: !!h.reconocido,
    };

    if (h?.id) {
      try {
        await api.put(`/hijos/${h.id}`, payload);
        return;
      } catch {}
      try {
        await api.patch(`/hijos/${h.id}`, payload);
        return;
      } catch {}
    } else {
      try {
        await api.post(`/casos/${casoId}/hijos`, payload);
        return;
      } catch {}
      try {
        await api.post(`/hijos`, payload);
        return;
      } catch {}
    }
  }

  async function tryDeleteHijo(hId, casoId) {
    try { await api.delete(`/hijos/${hId}`); return; } catch {}
    try { await api.delete(`/casos/${casoId}/hijos/${hId}`); return; } catch {}
  }

  async function tryUpsertAgresor(casoId, a) {
    const payload = {
      caso_id: Number(casoId),
      nombre: emptyToNull(a.nombre),
      relacion_agresor_id: a.relacion_agresor_id ? Number(a.relacion_agresor_id) : null,
      edad: a.edad === "" ? null : Number(a.edad),
      dpi_pasaporte: emptyToNull(a.dpi_pasaporte),
      ocupacion: emptyToNull(a.ocupacion),
      telefono: emptyToNull(a.telefono),
      ingreso_mensual: a.ingreso_mensual === "" ? null : Number(a.ingreso_mensual),
      direccion: emptyToNull(a.direccion),
      lugar_residencia: emptyToNull(a.lugar_residencia),
      lugar_trabajo: emptyToNull(a.lugar_trabajo),
      horario_trabajo: emptyToNull(a.horario_trabajo),
      observacion: emptyToNull(a.observacion),
    };

    if (a?.id) {
      try { await api.put(`/agresores/${a.id}`, payload); return; } catch {}
      try { await api.patch(`/agresores/${a.id}`, payload); return; } catch {}
    } else {
      try { await api.post(`/casos/${casoId}/agresores`, payload); return; } catch {}
      try { await api.post(`/agresores`, payload); return; } catch {}
    }
  }

  async function tryDeleteAgresor(aId, casoId) {
    try { await api.delete(`/agresores/${aId}`); return; } catch {}
    try { await api.delete(`/casos/${casoId}/agresores/${aId}`); return; } catch {}
  }

  async function guardar() {
    try {
      setBusy("guardar");
      setMsg("");

      // ✅ 1) Guardar sobreviviente (si existe)
      if (victima?.id) {
        const vPayload = {
          primer_nombre: emptyToNull(victimaForm.primer_nombre),
          segundo_nombre: emptyToNull(victimaForm.segundo_nombre),
          primer_apellido: emptyToNull(victimaForm.primer_apellido),
          segundo_apellido: emptyToNull(victimaForm.segundo_apellido),
          nombre: emptyToNull(victimaForm.nombre),
          dpi: emptyToNull(victimaForm.dpi),
          telefono: emptyToNull(victimaForm.telefono),
          fecha_nacimiento: victimaForm.fecha_nacimiento || null,
          estado_civil_id: victimaForm.estado_civil_id ? Number(victimaForm.estado_civil_id) : null,
          escolaridad_id: victimaForm.escolaridad_id ? Number(victimaForm.escolaridad_id) : null,
          etnia_id: victimaForm.etnia_id ? Number(victimaForm.etnia_id) : null,
          ocupacion: emptyToNull(victimaForm.ocupacion),
          direccion_actual: emptyToNull(victimaForm.direccion_actual),
          residencia: emptyToNull(victimaForm.residencia),
          nacionalidad: emptyToNull(victimaForm.nacionalidad),
          municipio_origen_id: victimaForm.municipio_origen_id ? Number(victimaForm.municipio_origen_id) : null,
          lugar_origen: emptyToNull(victimaForm.lugar_origen),
        };

        // si tu backend es estricto, esto normalmente funciona con PUT/PATCH
        await tryPutVictima(victima.id, vPayload);
      }

      // ✅ 2) Guardar caso (tu payload original intacto)
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
        otros_tipos_violencia: emptyToNull(form.otros_tipos_violencia),
        otros_medios_agresion: emptyToNull(form.otros_medios_agresion),
        ref_interna_otro: emptyToNull(form.ref_interna_otro),
        ref_externa_otro: emptyToNull(form.ref_externa_otro),
        acciones: emptyToNull(form.acciones),
        tipos_violencia_ids: form.tipos_violencia_ids,
        medios_agresion_ids: form.medios_agresion_ids,
        ref_interna_ids: form.ref_interna_ids,
        ref_externa_ids: form.ref_externa_ids,
        situaciones_riesgo: form.situaciones_riesgo,
      };
      await updateCaso(id, payload);

      // ✅ 3) Guardar hijos/agresores (si hay endpoints, genial; si no, no rompe)
      const casoIdNum = Number(id);

      for (const hid of hijosDeleted) {
        await tryDeleteHijo(hid, casoIdNum).catch(() => {});
      }
      for (const aid of agresoresDeleted) {
        await tryDeleteAgresor(aid, casoIdNum).catch(() => {});
      }

      for (const h of (form.hijos || [])) {
        await tryUpsertHijo(casoIdNum, h).catch(() => {});
      }
      for (const a of (form.agresores || [])) {
        await tryUpsertAgresor(casoIdNum, a).catch(() => {});
      }

      // ✅ Respaldo local (como ya lo tenías)
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

      // reset modo edición
      setEdit(false);
      setFormSnapshot(null);
      setVictimaSnapshot(null);
      setHijosDeleted([]);
      setAgresoresDeleted([]);

      // refrescar
      const { data: c2 } = await getCasoById(id);
      setCaso(c2);

      if (c2?.victima_id) {
        const { data: v2 } = await getVictimaById(c2.victima_id);
        setVictima(v2);
      }

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
      setFormSnapshot(null);
      setVictimaSnapshot(null);
      setHijosDeleted([]);
      setAgresoresDeleted([]);
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
      nav("/social");
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
          <Link to="/social" className="cd-back">← Volver</Link>
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

            {!edit ? (
              <>
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

                  <Item label="Lugar de origen">
                    {prettyLugarOrigen(victima, cat) || "-"}
                  </Item>
                </div>
                {!victima && <div className="cd-muted">No se pudieron cargar los datos de la sobreviviente.</div>}
              </>
            ) : (
              <>
                <div className="cd-grid">
                  <EditItem label="Primer nombre">
                    <input name="primer_nombre" value={victimaForm.primer_nombre} onChange={onVictimaChange} />
                  </EditItem>
                  <EditItem label="Segundo nombre">
                    <input name="segundo_nombre" value={victimaForm.segundo_nombre} onChange={onVictimaChange} />
                  </EditItem>
                  <EditItem label="Primer apellido">
                    <input name="primer_apellido" value={victimaForm.primer_apellido} onChange={onVictimaChange} />
                  </EditItem>
                  <EditItem label="Segundo apellido">
                    <input name="segundo_apellido" value={victimaForm.segundo_apellido} onChange={onVictimaChange} />
                  </EditItem>

                  <EditItem label="DPI">
                    <input name="dpi" value={victimaForm.dpi} onChange={onVictimaChange} />
                  </EditItem>
                  <EditItem label="Teléfono">
                    <input name="telefono" value={victimaForm.telefono} onChange={onVictimaChange} />
                  </EditItem>
                  <EditItem label="Fecha de nacimiento">
                    <input type="date" name="fecha_nacimiento" value={victimaForm.fecha_nacimiento} onChange={onVictimaChange} />
                  </EditItem>

                  <EditItem label="Estado civil">
                    <select name="estado_civil_id" value={String(victimaForm.estado_civil_id ?? "")} onChange={onVictimaChange}>
                      <option value="">— Selecciona —</option>
                      {cat.estadosCiviles.map((x) => (
                        <option key={x.id} value={String(x.id)}>{x.nombre}</option>
                      ))}
                    </select>
                  </EditItem>

                  <EditItem label="Escolaridad">
                    <select name="escolaridad_id" value={String(victimaForm.escolaridad_id ?? "")} onChange={onVictimaChange}>
                      <option value="">— Selecciona —</option>
                      {cat.escolaridades.map((x) => (
                        <option key={x.id} value={String(x.id)}>{x.nombre}</option>
                      ))}
                    </select>
                  </EditItem>

                  <EditItem label="Etnia">
                    <select name="etnia_id" value={String(victimaForm.etnia_id ?? "")} onChange={onVictimaChange}>
                      <option value="">— Selecciona —</option>
                      {cat.etnias.map((x) => (
                        <option key={x.id} value={String(x.id)}>{x.nombre}</option>
                      ))}
                    </select>
                  </EditItem>

                  <EditItem label="Ocupación">
                    {(cat.ocupaciones || []).length ? (
                      <select
                        name="ocupacion"
                        value={victimaForm.ocupacion || ""}
                        onChange={onVictimaChange}
                      >
                        <option value="">— Selecciona —</option>
                        {victimaForm.ocupacion &&
                          !(cat.ocupaciones || []).some((o) => String(o?.nombre || "") === String(victimaForm.ocupacion)) && (
                            <option value={victimaForm.ocupacion}>{victimaForm.ocupacion}</option>
                          )}
                        {(cat.ocupaciones || []).map((o) => (
                          <option key={o.id ?? o.nombre} value={o.nombre}>{o.nombre}</option>
                        ))}
                      </select>
                    ) : (
                      <input name="ocupacion" value={victimaForm.ocupacion} onChange={onVictimaChange} />
                    )}
                  </EditItem>

                  <EditItem label="Dirección">
                    <input name="direccion_actual" value={victimaForm.direccion_actual} onChange={onVictimaChange} />
                  </EditItem>

                  <EditItem label="Residencia">
                    {(cat.residencias || []).length ? (
                      <select name="residencia" value={victimaForm.residencia || ""} onChange={onVictimaChange}>
                        <option value="">— Selecciona —</option>
                        {victimaForm.residencia &&
                          !(cat.residencias || []).some((r) => String(r?.nombre || "") === String(victimaForm.residencia)) && (
                            <option value={victimaForm.residencia}>{victimaForm.residencia}</option>
                          )}
                        {(cat.residencias || []).map((r) => (
                          <option key={r.id ?? r.nombre} value={r.nombre}>{r.nombre}</option>
                        ))}
                      </select>
                    ) : (
                      <input name="residencia" value={victimaForm.residencia} onChange={onVictimaChange} />
                    )}
                  </EditItem>

                  <EditItem label="Nacionalidad">
                    <input name="nacionalidad" value={victimaForm.nacionalidad} onChange={onVictimaChange} />
                  </EditItem>

                  <EditItem label="Lugar de origen (Municipio)">
                    {cargandoCat ? (
                      <div className="cd-muted">Cargando catálogos…</div>
                    ) : (
                      <select
                        name="municipio_origen_id"
                        value={String(victimaForm.municipio_origen_id ?? "")}
                        onChange={onVictimaChange}
                      >
                        <option value="">— Selecciona —</option>
                        {cat.municipios.map((m) => {
                          const depto = nombreDe(cat.departamentos, m.departamento_id) || "";
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

                  <EditItem label="Lugar de origen (texto libre)">
                    <input
                      name="lugar_origen"
                      value={victimaForm.lugar_origen}
                      onChange={onVictimaChange}
                      placeholder="Si aplica (ej. extranjero / sin municipio)"
                    />
                  </EditItem>
                </div>
              </>
            )}
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

          {/* HIJAS E HIJOS */}
          <section className="cd-section">
            <h3>Hijas e hijos</h3>

            {!edit ? (
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
            ) : (
              <>
                <div className="cd-grid">
                  {(form.hijos || []).map((h, i) => (
                    <div key={h.id ?? `h-${i}`} className="cd-grid" style={{ width: "100%" }}>
                      <EditItem label={`Hijo/a #${i + 1} · Nombre`}>
                        <input value={h.nombre || ""} onChange={(e) => updHijo(i, "nombre", e.target.value)} />
                      </EditItem>
                      <EditItem label="Sexo">
                        <select value={h.sexo || "F"} onChange={(e) => updHijo(i, "sexo", e.target.value)}>
                          <option value="F">Femenino</option>
                          <option value="M">Masculino</option>
                        </select>
                      </EditItem>
                      <EditItem label="Edad (años)">
                        <input value={h.edad_anios ?? ""} onChange={(e) => updHijo(i, "edad_anios", e.target.value)} />
                      </EditItem>
                      <EditItem label="Reconocido/a">
                        <label className="cd-check">
                          <input
                            type="checkbox"
                            checked={!!h.reconocido}
                            onChange={(e) => updHijo(i, "reconocido", e.target.checked)}
                          />
                          <span>Reconocido</span>
                        </label>
                      </EditItem>
                      <EditItem label="">
                        <button type="button" className="btn-danger" onClick={() => delHijo(i)}>Quitar</button>
                      </EditItem>
                    </div>
                  ))}

                  <EditItem label="">
                    <button type="button" className="btn-secondary" onClick={addHijo}>
                      + Agregar hijo/a
                    </button>
                  </EditItem>
                </div>
              </>
            )}
          </section>

          {/* AGRESORES */}
          <section className="cd-section">
            <h3>Agresores</h3>

            {!edit ? (
              (caso?.agresores?.length || form?.agresores?.length) ? (
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
              )
            ) : (
              <>
                {(form.agresores || []).map((a, i) => (
                  <div key={a.id ?? `a-${i}`} className="cd-grid" style={{ marginBottom: 12 }}>
                    <EditItem label={`Agresor #${i + 1} · Nombre`}>
                      <input value={a.nombre || ""} onChange={(e) => updAgresor(i, "nombre", e.target.value)} />
                    </EditItem>

                    <EditItem label="Relación con la sobreviviente">
                      {(cat.relacionesAgresor || []).length ? (
                        <select
                          value={String(a.relacion_agresor_id ?? "")}
                          onChange={(e) => updAgresor(i, "relacion_agresor_id", e.target.value)}
                        >
                          <option value="">— Selecciona —</option>
                          {cat.relacionesAgresor.map((x) => (
                            <option key={x.id} value={String(x.id)}>{x.nombre}</option>
                          ))}
                        </select>
                      ) : (
                        <input value={a.relacion_agresor_id || ""} onChange={(e) => updAgresor(i, "relacion_agresor_id", e.target.value)} />
                      )}
                    </EditItem>

                    <EditItem label="Edad">
                      <input value={a.edad ?? ""} onChange={(e) => updAgresor(i, "edad", e.target.value)} />
                    </EditItem>

                    <EditItem label="Documento">
                      <input value={a.dpi_pasaporte || ""} onChange={(e) => updAgresor(i, "dpi_pasaporte", e.target.value)} />
                    </EditItem>

                    <EditItem label="Ocupación">
                      <input value={a.ocupacion || ""} onChange={(e) => updAgresor(i, "ocupacion", e.target.value)} />
                    </EditItem>

                    <EditItem label="Teléfono">
                      <input value={a.telefono || ""} onChange={(e) => updAgresor(i, "telefono", e.target.value)} />
                    </EditItem>

                    <EditItem label="Ingreso mensual (Q)">
                      <input value={a.ingreso_mensual ?? ""} onChange={(e) => updAgresor(i, "ingreso_mensual", e.target.value)} />
                    </EditItem>

                    <EditItem label="Dirección">
                      <input value={a.direccion || ""} onChange={(e) => updAgresor(i, "direccion", e.target.value)} />
                    </EditItem>

                    <EditItem label="Lugar de residencia">
                      <input value={a.lugar_residencia || ""} onChange={(e) => updAgresor(i, "lugar_residencia", e.target.value)} />
                    </EditItem>

                    <EditItem label="Lugar de trabajo">
                      <input value={a.lugar_trabajo || ""} onChange={(e) => updAgresor(i, "lugar_trabajo", e.target.value)} />
                    </EditItem>

                    <EditItem label="Horario de trabajo">
                      <input value={a.horario_trabajo || ""} onChange={(e) => updAgresor(i, "horario_trabajo", e.target.value)} />
                    </EditItem>

                    <EditItem label="Observación">
                      <input value={a.observacion || ""} onChange={(e) => updAgresor(i, "observacion", e.target.value)} />
                    </EditItem>

                    <EditItem label="">
                      <button type="button" className="btn-danger" onClick={() => delAgresor(i)}>
                        Quitar agresor
                      </button>
                    </EditItem>
                  </div>
                ))}

                <div className="cd-grid">
                  <EditItem label="">
                    <button type="button" className="btn-secondary" onClick={addAgresor}>
                      + Agregar agresor
                    </button>
                  </EditItem>
                </div>
              </>
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
                  {(cat.residencias || []).length ? (
                    <select
                      name="residencia"
                      value={form.residencia || ""}
                      onChange={onChange}
                    >
                      <option value="">— Selecciona —</option>

                      {form.residencia &&
                        !(cat.residencias || []).some((r) => String(r?.nombre || "") === String(form.residencia)) && (
                          <option value={form.residencia}>{form.residencia}</option>
                        )}

                      {(cat.residencias || []).map((r) => (
                        <option key={r.id ?? r.nombre} value={r.nombre}>
                          {r.nombre}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      name="residencia"
                      value={form.residencia}
                      onChange={onChange}
                      placeholder="Colonia/Barrio…"
                    />
                  )}
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
                onClick={() => {
                  setFormSnapshot(cloneForm(form));
                  setVictimaSnapshot(cloneForm(victimaForm));
                  setHijosDeleted([]);
                  setAgresoresDeleted([]);
                  setEdit(true);
                }}
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
                    if (formSnapshot) setForm(formSnapshot);
                    if (victimaSnapshot) setVictimaForm(victimaSnapshot);
                    setEdit(false);
                    setFormSnapshot(null);
                    setVictimaSnapshot(null);
                    setHijosDeleted([]);
                    setAgresoresDeleted([]);
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
  const txt = String(extraText || "").trim();
  if (!txt) return base;
  const parts = base.split(",").map((s) => s.trim());
  const isOtro = (s) => {
    const n = s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    return n === "otro" || n === "otra" || n === "otros" || n === "otras";
  };
  const replaced = parts.map((p) => (isOtro(p) ? `${p}: ${txt}` : p));
  return replaced.join(", ");
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

function prettyMunicipioCaso(caso, victima, cat) {
  if (isNumeric(caso?.municipio_id)) {
    const out = municipioYDepto(cat, caso.municipio_id);
    return out || `(${caso.municipio_id})`;
  }
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

function prettyLugarOrigen(victima, cat) {
  if (!victima) return null;

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

  if (victima.extra && typeof victima.extra === "object") {
    const ciudad = victima.extra.ciudad_origen || victima.extra.ciudadOrigen;
    const deptoExt = victima.extra.depto_origen_extranjero || victima.extra.deptoOrigenExtranjero;
    const pais = victima.extra.pais_origen || victima.extra.paisOrigen;
    const parts = [ciudad, deptoExt, pais].map((x) => (x && String(x).trim()) || null).filter(Boolean);
    if (parts.length) return parts.join(" / ");
  }

  return null;
}

function sexoLabel(s) {
  const v = String(s || "").toUpperCase();
  return v === "M" ? "Masculino" : v === "F" ? "Femenino" : "Sexo no indicado";
}
function qMoneda(n) {
  const num = Number(n);
  if (!Number.isFinite(num)) return String(n ?? "-");
  return `Q ${num.toLocaleString("es-GT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
