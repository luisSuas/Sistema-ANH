// src/espacioslibres/CasoNuevo.js
import React, { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import api, { getCatalogo } from "../servicios/Servicios";
import { crearOBuscarBorrador } from "../servicios/ServiciosCasos";
import "./CasoNuevo.css";

/**
 * CASO NUEVO — flujo
 * - No crea nada al cargar.
 * - Prellena victima_id desde ?victima_id=
 * - “Guardar borrador”: crea o reutiliza (backend exige victima_id)
 * - Si hay id, permite “Ir al detalle”.
 */

export default function CasoNuevo() {
  const nav = useNavigate();
  const { search } = useLocation();

  // ===== Usuario desde JWT (área, nombre, rol)
  const usuario = useMemo(() => getUserFromToken(), []);
  const areaIdFromToken = usuario?.area ?? "";

  // ===== Catálogos (DB)
  const [cat, setCat] = useState({
    estados: [],
    etnias: [],
    escolaridades: [],
    tiposViolencia: [],
    mediosAgresion: [],
    relacionesAgresor: [],
    situacionesRiesgo: [],
    fuentesReferencia: [],
    refInterna: [],
    refExterna: [],
    municipios: [],       // [{id, nombre, departamento_id}]
    departamentos: [], 
    residencias: [],   // [{id, nombre}]
  });
  const [cargandoCat, setCargandoCat] = useState(true);

  // ===== Estado de caso (id de borrador si existe)
  const [casoId, setCasoId] = useState(null);

  // ===== Form principal (tabla CASOS)
  const [form, setForm] = useState(() => ({
    victima_id: "",
    motivo_consulta: "",
    fecha_atencion: new Date().toISOString().slice(0, 10),
    residencia: "",
    residencia_id: "",
    telefono: "",
    municipio_id: "",
    sexual_conocido: false,
    embarazo_semanas: "",
    riesgo_otro: "",
    tiempo_agresion: "",
    fuente_referencia_id: "",
    fuente_referencia_otro: "",
    acciones: "",

    // multivalores (relacionales)
    tipos_violencia_ids: [],
    medios_agresion_ids: [],
    ref_interna_ids: [],
    ref_externa_ids: [],
    situaciones_riesgo: [], // [{ situacion_id, detalle }]

    // hijos (UI)
    hijos: [], // [{ nombre, sexo, edad_anios, reconocido }]

    // agresores (UI)
    agresores: [], // [{ ... }]

    // campos "otro/otras" (solo UI)
    otros_tipos_violencia: "",
    otros_medios_agresion: "",
    ref_interna_otro: "",
    ref_externa_otro: "",
  }));

  const [enviando, setEnviando] = useState(false);
  const [msg, setMsg] = useState("");

  // ===== NUEVO: lookup de sobrevivientes (para mostrar nombre en vez de ID)
  const [victimasLookup, setVictimasLookup] = useState([]);
  const [victimaNombreInput, setVictimaNombreInput] = useState("");

  // ===== NUEVO: mapa id -> nombre
  const victimasById = useMemo(() => {
    const m = {};
    (victimasLookup || []).forEach((v) => {
      if (v?.id == null) return;
      const nombre = buildNombreVictima(v);
      m[String(v.id)] = nombre || `ID #${v.id}`;
    });
    return m;
  }, [victimasLookup]);

  // ===== Prellenar victima_id desde ?victima_id=
  useEffect(() => {
    const q = new URLSearchParams(search);
    const v = q.get("victima_id");
    if (v && !form.victima_id) {
      setForm((f) => ({ ...f, victima_id: v }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  // ===== NUEVO: cargar sobrevivientes para autocompletar por nombre
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { data } = await api.get("/victimas");
        if (!alive) return;
        setVictimasLookup(Array.isArray(data) ? data : []);
      } catch {
        if (!alive) return;
        setVictimasLookup([]);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // ===== NUEVO: cuando ya hay victima_id, mostrar el nombre automáticamente
  useEffect(() => {
    const vId = String(form.victima_id || "").trim();
    if (!vId) return;
    const nombre = victimasById[vId];
    if (nombre && nombre !== victimaNombreInput) {
      setVictimaNombreInput(nombre);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.victima_id, victimasById]);

  // ===== NUEVO: escribir/seleccionar nombre -> resolver victima_id sin romper el flujo
  const onVictimaNombreChange = (e) => {
    const val = e.target.value;
    setVictimaNombreInput(val);

    // si escribe solo números, lo tratamos como ID (por compatibilidad)
    const maybeId = Number(String(val).trim());
    if (Number.isInteger(maybeId) && maybeId > 0) {
      setForm((f) => ({ ...f, victima_id: String(maybeId) }));
      return;
    }

    const found = resolveVictimaByName(val, victimasLookup);
    if (found?.id) {
      setForm((f) => ({ ...f, victima_id: String(found.id) }));
    } else {
      // no adivinamos; solo dejamos el nombre escrito
      // (victima_id se valida al guardar)
    }
  };

  // ===== Si ya hay borrador para esa víctima, úsalo (endpoint dedicado)
  useEffect(() => {
    let alive = true;

    async function checkBorrador() {
      const vId = Number(form.victima_id);

      // si limpian el campo, limpia el casoId
      if (!Number.isInteger(vId) || vId <= 0) {
        if (alive) setCasoId(null);
        return;
      }

      try {
        // ✅ Endpoint nuevo (más correcto y más rápido)
        const { data } = await api.get(`/casos/draft`, { params: { victima_id: vId } });
        if (!alive) return;
        if (data?.id) setCasoId(data.id);
      } catch (e) {
        if (!alive) return;

        // 404 = no hay borrador, no es error real
        if (e?.response?.status === 404) {
          setCasoId(null);
          return;
        }

        // Si por rol da 403 o cualquier otro error, NO rompa el flujo
        // (deja casoId como está y permite que el usuario cree uno con "Guardar borrador")
        console.warn("[CasoNuevo] draft no disponible:", e?.response?.status, e?.message);
      }
    }

    checkBorrador();
    return () => { alive = false; };
  }, [form.victima_id]);

  // ===== Cargar catálogos
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setCargandoCat(true);
        const [
          tiposViolencia,
          mediosAgresion,
          relacionesAgresor,
          situacionesRiesgo,
          fuentesRef,
          estados,
          etnias,
          escolaridades,
          refInt,
          refExt,
          municipios,
          departamentos,
          residencias,
        ] = await Promise.all([
          getCatalogo("tipos-violencia").then((r) => r.data).catch(() => []),
          getCatalogo("medios-agresion").then((r) => r.data).catch(() => []),
          getCatalogo("relaciones-agresor").then((r) => r.data).catch(() => []),
          getCatalogo("situaciones-riesgo").then((r) => r.data).catch(() => []),
          getCatalogo("fuentes-referencia").then((r) => r.data).catch(() => []),
          getCatalogo("estados-civiles").then((r) => r.data).catch(() => []),
          getCatalogo("etnias").then((r) => r.data).catch(() => []),
          getCatalogo("escolaridades").then((r) => r.data).catch(() => []),
          api.get("/catalogos/destinos-ref-interna").then((r) => r.data).catch(() => []),
          api.get("/catalogos/destinos-ref-externa").then((r) => r.data).catch(() => []),
          getCatalogo("municipios").then((r) => r.data).catch(() => []),
          getCatalogo("departamentos").then((r) => r.data).catch(() => []),
          getCatalogo("residencias").then((r) => r.data).catch(() => []),
        ]);
        if (!alive) return;
        setCat({
          tiposViolencia: toOpt(tiposViolencia),
          mediosAgresion: toOpt(mediosAgresion),
          relacionesAgresor: toOpt(relacionesAgresor),
          situacionesRiesgo: toOpt(situacionesRiesgo),
          fuentesReferencia: toOpt(fuentesRef),
          estados: toOpt(estados),
          etnias: toOpt(etnias),
          escolaridades: toOpt(escolaridades),
          refInterna: toOpt(refInt),
          refExterna: toOpt(refExt),
          municipios: toMuni(municipios), // preserva departamento_id
          departamentos: toOpt(departamentos),
          residencias: toOpt(residencias),
        });
      } catch (e) {
        console.error(e);
      } finally {
        if (alive) setCargandoCat(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  // ===== Handlers base
  const onChange = (e) => {
    const { name, value, type, checked } = e.target;
    setForm((f) => ({ ...f, [name]: type === "checkbox" ? !!checked : value }));
  };

  // normalizador simple para detectar "otro/otras" en opciones
  const norm = (s) =>
    String(s || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
  const findOtroId = (options = []) => {
    for (const o of options) {
      const n = norm(o?.nombre);
      // Coincide solo con la palabra exacta: otro/otra/otros/otras
      if (n === "otro" || n === "otra" || n === "otros" || n === "otras") {
        return o.id;
      }
    }
    return null;
  };

  const onMultiToggle = (name, id) => {
    setForm((f) => {
      const set = new Set(f[name] || []);
      const had = set.has(id);
      if (had) set.delete(id);
      else set.add(id);

      const next = { ...f, [name]: Array.from(set) };

      // Si se desmarca la opción "otro/otras", limpiar el texto asociado
      const otroIds = {
        tipos_violencia_ids: findOtroId(cat.tiposViolencia),
        medios_agresion_ids: findOtroId(cat.mediosAgresion),
        ref_interna_ids: findOtroId(cat.refInterna),
        ref_externa_ids: findOtroId(cat.refExterna),
      };
      const idOtro = otroIds[name];
      if (idOtro != null && id === idOtro && had) {
        if (name === "tipos_violencia_ids") next.otros_tipos_violencia = "";
        if (name === "medios_agresion_ids") next.otros_medios_agresion = "";
        if (name === "ref_interna_ids") next.ref_interna_otro = "";
        if (name === "ref_externa_ids") next.ref_externa_otro = "";
      }

      return next;
    });
  };

  // ===== Hijos (UI)
  const addHijo = () =>
    setForm((f) => ({
      ...f,
      hijos: [
        ...f.hijos,
        { nombre: "", sexo: "F", edad_anios: "", reconocido: false },
      ],
    }));
  const delHijo = (i) =>
    setForm((f) => ({ ...f, hijos: f.hijos.filter((_, k) => k !== i) }));
  const updHijo = (i, key, val) =>
    setForm((f) => ({
      ...f,
      hijos: f.hijos.map((h, k) => (k === i ? { ...h, [key]: val } : h)),
    }));

  // ===== Agresores (UI)
  const addAgresor = () =>
    setForm((f) => ({
      ...f,
      agresores: [
        ...f.agresores,
        {
          nombre: "",
          edad: "",
          dpi_pasaporte: "",
          ocupacion: "",
          direccion: "",
          lugar_residencia: "",
          lugar_trabajo: "",
          horario_trabajo: "",
          telefono: "",
          ingreso_mensual: "",
          relacion_agresor_id: "",
          observacion: "",
        },
      ],
    }));
  const delAgresor = (i) =>
    setForm((f) => ({
      ...f,
      agresores: f.agresores.filter((_, k) => k !== i),
    }));
  const updAgresor = (i, key, val) =>
    setForm((f) => ({
      ...f,
      agresores: f.agresores.map((a, k) => (k === i ? { ...a, [key]: val } : a)),
    }));

  // ===== Situaciones de riesgo (UI)
  const addRiesgo = () =>
    setForm((f) => ({
      ...f,
      situaciones_riesgo: [
        ...f.situaciones_riesgo,
        { situacion_id: "", detalle: "" },
      ],
    }));
  const delRiesgo = (i) =>
    setForm((f) => ({
      ...f,
      situaciones_riesgo: f.situaciones_riesgo.filter((_, k) => k !== i),
    }));
  const updRiesgo = (i, key, val) =>
    setForm((f) => ({
      ...f,
      situaciones_riesgo: f.situaciones_riesgo.map((r, k) =>
        k === i ? { ...r, [key]: val } : r
      ),
    }));

  // ===== Guardar borrador (crear o reutilizar)
  const onGuardarBorrador = async (e) => {
    e.preventDefault();
    if (enviando) return;

    const vId = Number(form.victima_id);
    if (!Number.isInteger(vId) || vId <= 0) {
      setMsg("Debes indicar la víctima.");
      return;
    }

    setEnviando(true);
    setMsg("");
    try {
      // Solo columnas reales de "casos"
      const payloadCaso = {
        motivo_consulta: emptyToNull(form.motivo_consulta),
        fecha_atencion: form.fecha_atencion || null,
        residencia: emptyToNull(form.residencia),
        residencia_id: form.residencia_id ? Number(form.residencia_id) : null,
        telefono: emptyToNull(form.telefono),
        municipio_id: form.municipio_id ? Number(form.municipio_id) : null,
        sexual_conocido: !!form.sexual_conocido,
        embarazo_semanas: form.embarazo_semanas
          ? Number(form.embarazo_semanas)
          : null,
        riesgo_otro: emptyToNull(form.riesgo_otro),
        tiempo_agresion: emptyToNull(form.tiempo_agresion),
        fuente_referencia_id: form.fuente_referencia_id
          ? Number(form.fuente_referencia_id)
          : null,
        fuente_referencia_otro: emptyToNull(form.fuente_referencia_otro),
        // textos libres cuando se elige "Otro/Otras"
        otros_tipos_violencia: emptyToNull(form.otros_tipos_violencia),
        otros_medios_agresion: emptyToNull(form.otros_medios_agresion),
        ref_interna_otro: emptyToNull(form.ref_interna_otro),
        ref_externa_otro: emptyToNull(form.ref_externa_otro),
        acciones: emptyToNull(form.acciones),
      };

      const { id, reused } = await crearOBuscarBorrador(vId, payloadCaso);
      setCasoId(id);

      // 🔒 Asegura persistencia de campos "core" aun si se reutiliza borrador
      try {
        await api.put(`/casos/${id}`, payloadCaso, {
          headers: { "Content-Type": "application/json" },
        });
      } catch (_) {}

      // Guarda multivalores + hijos/agresores
      try {
        await attachTodo(id, form);
      } catch (_) {}

      // Respaldo local del detalle
      try {
        const mv = {
          tipos_violencia_ids: form.tipos_violencia_ids,
          medios_agresion_ids: form.medios_agresion_ids,
          ref_interna_ids: form.ref_interna_ids,
          ref_externa_ids: form.ref_externa_ids,
          situaciones_riesgo: form.situaciones_riesgo,
          // textos libres asociados a "otro/otras"
          otros_tipos_violencia: form.otros_tipos_violencia,
          otros_medios_agresion: form.otros_medios_agresion,
          ref_interna_otro: form.ref_interna_otro,
          ref_externa_otro: form.ref_externa_otro,
          hijos: form.hijos,
          agresores: form.agresores,
        };
        localStorage.setItem(`caso_mv_${id}`, JSON.stringify(mv));
      } catch {}

      setMsg(
        reused
          ? `Se reutilizó el borrador #${id}.`
          : `Borrador creado #${id}.`
      );
    } catch (e) {
      console.error(e);
      setMsg(
        e?.response?.data?.error ||
          "No se pudo guardar el borrador. Revisa los datos."
      );
    } finally {
      setEnviando(false);
    }
  };

  const irDetalle = () => {
    if (casoId) nav(`/espacioslibres/casos/${casoId}`);
  };

  return (
    <div className="cn-wrap cn-wrap-social">
      <div className="cn-header">
        <div>
          <Link to="/espacioslibres" className="cn-back">
            ← Volver
          </Link>
          <h2>Nuevo proceso</h2>
          <p className="cn-muted">
            Área (desde token):{" "}
            <strong>{String(areaIdFromToken || "-")}</strong>
          </p>
        </div>
      </div>

      {msg && <div className="cn-alert">{msg}</div>}

      <form className="cn-form" onSubmit={onGuardarBorrador}>
        {/* SECCIÓN 1: Identificación mínima */}
        <Fieldset title="Identificación">
          <Row>
            <Col>
              <Label>
                Sobreviviente <Req />
              </Label>

              {/* ✅ Se muestra el NOMBRE (y por debajo se resuelve victima_id internamente) */}
              <input
                value={victimaNombreInput}
                onChange={onVictimaNombreChange}
                placeholder="Escribe el nombre de la sobreviviente…"
                list="cn-victimas-datalist"
                required
              />

              <datalist id="cn-victimas-datalist">
                {(victimasLookup || []).map((v) => {
                  const nombre = buildNombreVictima(v);
                  return nombre ? <option key={v.id} value={nombre} /> : null;
                })}
              </datalist>

              <small className="cn-help">
                ¿No aparece? Ve a <Link to="/espacioslibres/victimas">Sobrevivientes</Link>{" "}
                y búscala por nombre.
              </small>
            </Col>

            <Col>
              <Label>Fecha de atención</Label>
              <input
                type="date"
                name="fecha_atencion"
                value={form.fecha_atencion}
                onChange={onChange}
              />
            </Col>
          </Row>
        </Fieldset>

        {/* SECCIÓN 2: Datos del proceso */}
        <Fieldset title="Datos del proceso">
          <Row>
            <Col>
              <Label>Motivo de la consulta</Label>
              <input
                name="motivo_consulta"
                value={form.motivo_consulta}
                onChange={onChange}
                placeholder="Motivo…"
              />
            </Col>
          </Row>
          <Row>
           <Col>
  <Label>Residencia</Label>
  {cargandoCat ? (
    <div className="cn-muted">Cargando catálogos…</div>
  ) : (
    <select
      name="residencia_id"
      value={String(form.residencia_id ?? "")}
      onChange={(e) => {
        const rid = e.target.value;
        const nombre = rid
          ? (cat.residencias || []).find((r) => String(r.id) === String(rid))
              ?.nombre || ""
          : "";
        setForm((f) => ({ ...f, residencia_id: rid, residencia: nombre }));
      }}
    >
      <option value="">— Selecciona —</option>
      {(cat.residencias || []).map((r) => (
        <option key={r.id} value={String(r.id)}>
          {r.nombre}
        </option>
      ))}
    </select>
  )}
</Col>

            <Col>
              <Label>Teléfono</Label>
              <input
                name="telefono"
                value={form.telefono}
                onChange={onChange}
                placeholder="Ej. 5555-5555"
              />
            </Col>
          </Row>

          {/* === Municipio con SELECT (nombre visible) === */}
          <Row>
            <Col>
              <Label>
                Municipio <span className="cn-optional">opcional</span>
              </Label>
              {cargandoCat ? (
                <div className="cn-muted">Cargando catálogos…</div>
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
                      nombreById(cat.departamentos, m.departamento_id) || "";
                    const label = depto ? `${m.nombre}, ${depto}` : m.nombre;
                    return (
                      <option key={m.id} value={String(m.id)}>
                        {label}
                      </option>
                    );
                  })}
                </select>
              )}
            </Col>
          </Row>

          <Row>
            <Col>
              <label className="cn-check">
                <input
                  type="checkbox"
                  name="sexual_conocido"
                  checked={!!form.sexual_conocido}
                  onChange={onChange}
                />
                Agresor sexual conocido
              </label>
            </Col>
            <Col>
              <Label>
                Semanas de gestación <span className="cn-optional">opcional</span>
              </Label>
              <input
                name="embarazo_semanas"
                value={form.embarazo_semanas}
                onChange={onChange}
                placeholder="Ej. 12"
              />
            </Col>
          </Row>
          <Row>
            <Col>
              <Label>Tiempo de agresión</Label>
              <input
                name="tiempo_agresion"
                value={form.tiempo_agresion}
                onChange={onChange}
                placeholder="Ej. 2 años, ocasional"
              />
            </Col>
            <Col>
              <Label>Otro riesgo (texto libre)</Label>
              <input
                name="riesgo_otro"
                value={form.riesgo_otro}
                onChange={onChange}
                placeholder="Detalle (opcional)"
              />
            </Col>
          </Row>
        </Fieldset>

        {/* SECCIÓN 3: Tipos de violencia */}
        <Fieldset title="Tipos de violencia" optional>
          {cargandoCat ? (
            <Muted>Cargando catálogos…</Muted>
          ) : (
            <Chips
              options={cat.tiposViolencia}
              selected={form.tipos_violencia_ids}
              onToggle={(id) => onMultiToggle("tipos_violencia_ids", id)}
            />
          )}
          {!cargandoCat && (() => {
            const otroId = findOtroId(cat.tiposViolencia);
            const show = otroId != null && (form.tipos_violencia_ids || []).includes(otroId);
            return (
              show && (
                <div style={{ marginTop: 8 }}>
                  <Label>Otras (especifica)</Label>
                  <input
                    name="otros_tipos_violencia"
                    value={form.otros_tipos_violencia}
                    onChange={onChange}
                    placeholder="Describe otras violencias"
                  />
                </div>
              )
            );
          })()}
        </Fieldset>

        {/* SECCIÓN 4: Medios de agresión */}
        <Fieldset title="Medios de agresión" optional>
          {cargandoCat ? (
            <Muted>Cargando catálogos…</Muted>
          ) : (
            <Chips
              options={cat.mediosAgresion}
              selected={form.medios_agresion_ids}
              onToggle={(id) => onMultiToggle("medios_agresion_ids", id)}
            />
          )}
          {!cargandoCat && (() => {
            const otroId = findOtroId(cat.mediosAgresion);
            const show = otroId != null && (form.medios_agresion_ids || []).includes(otroId);
            return (
              show && (
                <div style={{ marginTop: 8 }}>
                  <Label>Otros (especifica)</Label>
                  <input
                    name="otros_medios_agresion"
                    value={form.otros_medios_agresion}
                    onChange={onChange}
                    placeholder="Describe otros medios de agresión"
                  />
                </div>
              )
            );
          })()}
        </Fieldset>

        {/* SECCIÓN 5: Situaciones de riesgo */}
        <Fieldset title="Situaciones de riesgo" optional>
          {form.situaciones_riesgo.map((r, i) => (
            <Row key={i}>
              <Col>
                <Label>Situación</Label>
                <select
                  value={r.situacion_id}
                  onChange={(e) => updRiesgo(i, "situacion_id", e.target.value)}
                >
                  <option value="">— Selecciona —</option>
                  {cat.situacionesRiesgo.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.nombre}
                    </option>
                  ))}
                </select>
              </Col>
              <Col>
                <Label>Detalle</Label>
                <input
                  value={r.detalle}
                  onChange={(e) => updRiesgo(i, "detalle", e.target.value)}
                  placeholder="Descripción corta"
                />
              </Col>
              <Col small>
                <button
                  type="button"
                  className="btn-danger"
                  onClick={() => delRiesgo(i)}
                >
                  Quitar
                </button>
              </Col>
            </Row>
          ))}
          <button type="button" className="btn-secondary" onClick={addRiesgo}>
            + Agregar situación
          </button>
        </Fieldset>

        {/* SECCIÓN 6: Referencias */}
        <Fieldset title="Referencias">
          <Row>
            <Col>
              <Label>Fuente que refiere</Label>
              <select
                name="fuente_referencia_id"
                value={form.fuente_referencia_id}
                onChange={onChange}
              >
                <option value="">— Selecciona —</option>
                {cat.fuentesReferencia.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.nombre}
                  </option>
                ))}
              </select>
            </Col>
            <Col>
              <Label>Fuente (otro)</Label>
              <input
                name="fuente_referencia_otro"
                value={form.fuente_referencia_otro}
                onChange={onChange}
                placeholder="Si aplica"
              />
            </Col>
          </Row>
          <Row>
            <Col>
              <Label>Referencia interna</Label>
              <Chips
                options={cat.refInterna}
                selected={form.ref_interna_ids}
                onToggle={(id) => onMultiToggle("ref_interna_ids", id)}
              />
              {(() => {
                const otroId = findOtroId(cat.refInterna);
                const show = otroId != null && (form.ref_interna_ids || []).includes(otroId);
                return (
                  show && (
                    <div style={{ marginTop: 8 }}>
                      <Label>Referencia interna (otro)</Label>
                      <input
                        name="ref_interna_otro"
                        value={form.ref_interna_otro}
                        onChange={onChange}
                        placeholder="Especifica la referencia interna"
                      />
                    </div>
                  )
                );
              })()}
            </Col>
            <Col>
              <Label>Referencia externa</Label>
              <Chips
                options={cat.refExterna}
                selected={form.ref_externa_ids}
                onToggle={(id) => onMultiToggle("ref_externa_ids", id)}
              />
              {(() => {
                const otroId = findOtroId(cat.refExterna);
                const show = otroId != null && (form.ref_externa_ids || []).includes(otroId);
                return (
                  show && (
                    <div style={{ marginTop: 8 }}>
                      <Label>Referencia externa (otro)</Label>
                      <input
                        name="ref_externa_otro"
                        value={form.ref_externa_otro}
                        onChange={onChange}
                        placeholder="Especifica la referencia externa"
                      />
                    </div>
                  )
                );
              })()}
            </Col>
          </Row>
        </Fieldset>

        {/* SECCIÓN 7: Hijas e hijos */}
        <Fieldset title="Hijas e hijos" optional>
          {form.hijos.map((h, i) => (
            <Row key={i}>
              <Col>
                <Label>Nombre</Label>
                <input
                  value={h.nombre}
                  onChange={(e) => updHijo(i, "nombre", e.target.value)}
                  placeholder="Nombre"
                />
              </Col>
              <Col>
                <Label>Sexo</Label>
                <select
                  value={h.sexo}
                  onChange={(e) => updHijo(i, "sexo", e.target.value)}
                >
                  <option value="F">Femenino</option>
                  <option value="M">Masculino</option>
                </select>
              </Col>
              <Col>
                <Label>Edad (años)</Label>
                <input
                  value={h.edad_anios}
                  onChange={(e) => updHijo(i, "edad_anios", e.target.value)}
                  placeholder="Ej. 7"
                />
              </Col>
              <Col>
                <Label>Reconocido</Label>
                <select
                  value={h.reconocido ? "true" : "false"}
                  onChange={(e) =>
                    updHijo(i, "reconocido", e.target.value === "true")
                  }
                >
                  <option value="false">No</option>
                  <option value="true">Sí</option>
                </select>
              </Col>
              <Col small>
                <button
                  type="button"
                  className="btn-danger"
                  onClick={() => delHijo(i)}
                >
                  Quitar
                </button>
              </Col>
            </Row>
          ))}
          <button type="button" className="btn-secondary" onClick={addHijo}>
            + Agregar hijo/a
          </button>
        </Fieldset>

        {/* SECCIÓN 8: Agresores */}
        <Fieldset title="Agresores" optional>
          {form.agresores.map((a, i) => (
            <div key={i} className="cn-card">
              <Row>
                <Col>
                  <Label>Nombre</Label>
                  <input
                    value={a.nombre}
                    onChange={(e) => updAgresor(i, "nombre", e.target.value)}
                    placeholder="Nombre"
                  />
                </Col>
                <Col>
                  <Label>Edad</Label>
                  <input
                    value={a.edad}
                    onChange={(e) => updAgresor(i, "edad", e.target.value)}
                    placeholder="Ej. 34"
                  />
                </Col>
                <Col>
                  <Label>DPI/Pasaporte</Label>
                  <input
                    value={a.dpi_pasaporte}
                    onChange={(e) =>
                      updAgresor(i, "dpi_pasaporte", e.target.value)
                    }
                    placeholder="Documento"
                  />
                </Col>
                <Col>
                  <Label>Ocupación</Label>
                  <input
                    value={a.ocupacion}
                    onChange={(e) => updAgresor(i, "ocupacion", e.target.value)}
                    placeholder="Ocupación"
                  />
                </Col>
              </Row>
              <Row>
                <Col>
                  <Label>Dirección</Label>
                  <input
                    value={a.direccion}
                    onChange={(e) => updAgresor(i, "direccion", e.target.value)}
                    placeholder="Dirección"
                  />
                </Col>
                <Col>
                  <Label>Lugar de residencia</Label>
                  <input
                    value={a.lugar_residencia}
                    onChange={(e) =>
                      updAgresor(i, "lugar_residencia", e.target.value)
                    }
                    placeholder="Barrio / Municipio"
                  />
                </Col>
                <Col>
                  <Label>Lugar de trabajo</Label>
                  <input
                    value={a.lugar_trabajo}
                    onChange={(e) =>
                      updAgresor(i, "lugar_trabajo", e.target.value)
                    }
                    placeholder="Empresa / Sitio"
                  />
                </Col>
                <Col>
                  <Label>Horario de trabajo</Label>
                  <input
                    value={a.horario_trabajo}
                    onChange={(e) =>
                      updAgresor(i, "horario_trabajo", e.target.value)
                    }
                    placeholder="Ej. 8:00–17:00"
                  />
                </Col>
              </Row>
              <Row>
                <Col>
                  <Label>Teléfono</Label>
                  <input
                    value={a.telefono}
                    onChange={(e) => updAgresor(i, "telefono", e.target.value)}
                    placeholder="Ej. 5555-5555"
                  />
                </Col>
                <Col>
                  <Label>Ingreso mensual (Q)</Label>
                  <input
                    value={a.ingreso_mensual}
                    onChange={(e) =>
                      updAgresor(i, "ingreso_mensual", e.target.value)
                    }
                    placeholder="Ej. 3500"
                  />
                </Col>
                <Col>
                  <Label>Relación con la víctima</Label>
                  <select
                    value={a.relacion_agresor_id}
                    onChange={(e) =>
                      updAgresor(i, "relacion_agresor_id", e.target.value)
                    }
                  >
                    <option value="">— Selecciona —</option>
                    {cat.relacionesAgresor.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.nombre}
                      </option>
                    ))}
                  </select>
                </Col>
                <Col>
                  <Label>Observación</Label>
                  <input
                    value={a.observacion}
                    onChange={(e) => updAgresor(i, "observacion", e.target.value)}
                    placeholder="Observaciones"
                  />
                </Col>
              </Row>
              <div className="cn-card-actions">
                <button
                  type="button"
                  className="btn-danger"
                  onClick={() => delAgresor(i)}
                >
                  Eliminar agresor
                </button>
              </div>
            </div>
          ))}
          <button type="button" className="btn-secondary" onClick={addAgresor}>
            + Agregar agresor
          </button>
        </Fieldset>

        {/* SECCIÓN 9: Acciones realizadas */}
        <Fieldset title="Acciones realizadas" optional>
          <textarea
            name="acciones"
            value={form.acciones}
            onChange={onChange}
            rows={4}
            placeholder="Describir acciones efectuadas en la atención"
          ></textarea>
        </Fieldset>

        {/* ACCIONES */}
        <div className="cn-actions">
          <button
            type="submit"
            className="btn-primary"
            disabled={enviando}
            title="Guarda (crea o reutiliza) un borrador"
          >
            {enviando ? "Guardando…" : "Guardar borrador"}
          </button>

          <button
            type="button"
            className="btn-secondary"
            disabled={!casoId}
            onClick={irDetalle}
            title={
              casoId
                ? `Ir al detalle del proceso #${casoId}`
                : "Primero guarda el borrador"
            }
          >
            Ir al detalle del proceso
          </button>
        </div>
      </form>
    </div>
  );
}

/* ============== Helpers y subcomponentes UI ============== */
function Fieldset({ title, optional, children }) {
  return (
    <fieldset className="cn-fieldset">
      <legend>
        {title} {optional && <span className="cn-optional">opcional</span>}
      </legend>
      {children}
    </fieldset>
  );
}
function Row({ children }) {
  return <div className="cn-row">{children}</div>;
}
function Col({ children, small }) {
  return (
    <div className={"cn-col" + (small ? " cn-col-small" : "")}>{children}</div>
  );
}
function Label({ children }) {
  return <label>{children}</label>;
}
function Req() {
  return <span className="cn-required">*</span>;
}
function Muted({ children }) {
  return <div className="cn-muted">{children}</div>;
}

function Chips({ options = [], selected = [], onToggle }) {
  return (
    <div className="cn-chips">
      {options.map((opt) => (
        <button
          type="button"
          key={opt.id}
          className={selected.includes(opt.id) ? "chip chip-active" : "chip"}
          onClick={() => onToggle(opt.id)}
          title={`ID ${opt.id}`}
        >
          {opt.nombre}
        </button>
      ))}
    </div>
  );
}

function getUserFromToken() {
  try {
    const t = localStorage.getItem("access_token");
    if (!t) return null;
    const p = JSON.parse(atob(t.split(".")[1]));
    return { id: p.sub, nombre: p.name, role: p.role, area: p.area };
  } catch {
    return null;
  }
}

function toOpt(arr) {
  if (!Array.isArray(arr)) return [];
  return arr.map((x) => ({
    id: x.id ?? x.codigo ?? x.clave ?? x.departamento_id,
    nombre:
      x.nombre ?? x.descripcion ?? x.label ?? String(x.id ?? x.codigo ?? ""),
  }));
}

/** Municipios con departamento_id preservado */
function toMuni(arr) {
  if (!Array.isArray(arr)) return [];
  return arr
    .map((x) => ({
      id: x.id ?? x.codigo ?? x.municipio_id ?? x.id_municipio ?? x.clave,
      nombre:
        x.nombre ??
        x.nombre_municipio ??
        x.municipio ??
        x.descripcion ??
        x.nombreMunicipio ??
        x.municipio_descripcion ??
        String(x.id ?? x.codigo ?? x.municipio_id ?? ""),
      departamento_id:
        x.departamento_id ??
        x.depto_id ??
        x.id_departamento ??
        x.departamento ??
        x.dep_id ??
        null,
    }))
    .filter((m) => m.id != null);
}

function nombreById(list, id) {
  const s = String(id ?? "");
  const o = (list || []).find((x) => String(x.id) === s);
  return o?.nombre ?? null;
}

function emptyToNull(v) {
  const s = String(v ?? "").trim();
  return s ? s : null;
}

// (Opcional) checker no usado pero útil si lo quieres
async function existeVictima(id) {
  try {
    await api.get(`/victimas/${id}`);
    return true;
  } catch {
    return false;
  }
}

/** ====== NUEVO: adjunta todo lo relacional/repetible ======
 *  Usa PUT /casos/:id (backend ya guarda en tablas correctas).
 */
async function attachTodo(casoId, f) {
  try {
    await api.put(
      `/casos/${casoId}`,
      {
        tipos_violencia_ids: Array.isArray(f.tipos_violencia_ids) ? f.tipos_violencia_ids : [],
        medios_agresion_ids: Array.isArray(f.medios_agresion_ids) ? f.medios_agresion_ids : [],
        ref_interna_ids: Array.isArray(f.ref_interna_ids) ? f.ref_interna_ids : [],
        ref_externa_ids: Array.isArray(f.ref_externa_ids) ? f.ref_externa_ids : [],
        situaciones_riesgo: Array.isArray(f.situaciones_riesgo) ? f.situaciones_riesgo : [],
        hijos: Array.isArray(f.hijos) ? f.hijos : [],
        agresores: Array.isArray(f.agresores) ? f.agresores : [],
      },
      { headers: { "Content-Type": "application/json" } }
    );
  } catch (_) {
    // Silencioso para no bloquear el flujo
  }
}

/* ===== NUEVO: helpers de sobrevivientes (nombre <-> id) ===== */
function buildNombreVictima(v) {
  if (!v) return "";
  const direct = (v.nombre_completo || v.nombre || "").toString().trim();
  if (direct) return direct;

  const parts = [v.primer_nombre, v.segundo_nombre, v.primer_apellido, v.segundo_apellido]
    .filter(Boolean)
    .map((x) => String(x).trim());
  return parts.join(" ").trim();
}

function normText(s) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function resolveVictimaByName(input, victimas) {
  const s = normText(input || "");
  if (!s) return null;

  const exact = (victimas || []).find((v) => normText(buildNombreVictima(v)) === s);
  if (exact) return exact;

  const matches = (victimas || []).filter((v) => normText(buildNombreVictima(v)).includes(s));
  if (matches.length === 1) return matches[0];

  return null;
}

