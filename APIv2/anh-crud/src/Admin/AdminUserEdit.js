// src/Admin/AdminUserEdit.js
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Navigate, useNavigate, useParams, Link } from "react-router-dom";
import { getCatalogo, getUsuarioById, updateUsuario, whoAmI } from "../servicios/Servicios";
import "./admin.css";

export default function AdminUserEdit() {
  const me = useMemo(() => whoAmI(), []);
  const { id } = useParams();
  const nav = useNavigate();

  const [form, setForm] = useState({
    username: "",
    nombre_completo: "",
    email: "",
    role_id: "",
    area_id: "",
  });
  const [roles, setRoles] = useState([]);
  const [areas, setAreas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);
  const [err, setErr] = useState(null);
  const [blocked, setBlocked] = useState(false); // ✅ si el usuario objetivo es rol 4 (admin), bloqueamos edición

  const msgRef = useRef(null);                  // ✅ foco accesible en mensajes
  const didSaveRef = useRef(false);             // ✅ evita doble submit rápido

  // cargar catálogos + usuario
  useEffect(() => {
    let on = true;
    (async () => {
      try {
        const [rRoles, rAreas, rUser] = await Promise.all([
          getCatalogo("roles"),
          getCatalogo("areas"),
          getUsuarioById(id),
        ]);
        if (!on) return;

        const user = rUser?.data || {};
        const roleId = user.role_id ?? "";
        const areaId = user.area_id ?? "";

        setForm({
          username: user.username || "",
          nombre_completo: user.nombre_completo || "",
          email: user.email || "",
          role_id: roleId,
          area_id: areaId,
        });

        setRoles(Array.isArray(rRoles.data) ? rRoles.data : []);
        setAreas(Array.isArray(rAreas.data) ? rAreas.data : []);

        // ✅ No permitir editar administradores (rol 4)
        if (Number(roleId) === 4) {
          setBlocked(true);
        }
      } catch {
        if (!on) return;
        setErr("No se pudo cargar el usuario");
      } finally {
        if (on) setLoading(false);
      }
    })();
    return () => { on = false; };
  }, [id]);

  // no permitir asignar rol 4 desde el select
  const rolesForSelect = useMemo(
    () => roles.filter((r) => Number(r.id) !== 4),
    [roles]
  );

  useEffect(() => {
    if ((msg || err) && msgRef.current) {
      msgRef.current.focus();
    }
  }, [msg, err]);

  function onChange(e) {
    const { name, value } = e.target;
    // ✅ normaliza email suavemente
    if (name === "email") {
      return setForm((f) => ({ ...f, email: value.trim().toLowerCase() }));
    }
    setForm((f) => ({ ...f, [name]: value }));
  }

  function validate() {
    if (!form.nombre_completo.trim()) return "El nombre completo es obligatorio.";
    if (!form.email.trim()) return "El email es obligatorio.";
    const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim());
    if (!emailOk) return "El email no es válido.";
    if (!form.role_id) return "Selecciona un rol.";
    if (!form.area_id) return "Selecciona un área.";

    // ✅ no permitir asignar rol admin en edición
    if (Number(form.role_id) === 4) return "No puedes asignar el rol Administrador (4).";
    return null;
  }

  async function onSubmit(e) {
    e.preventDefault();
    if (saving || didSaveRef.current) return; // ✅ evita doble click
    setMsg(null); setErr(null);

    const v = validate();
    if (v) {
      setErr(v);
      return;
    }

    setSaving(true);
    didSaveRef.current = true;
    try {
      const payload = {
        nombre_completo: form.nombre_completo.trim(),
        email: form.email.trim().toLowerCase(),
        role_id: Number(form.role_id),
        area_id: Number(form.area_id),
      };
      await updateUsuario(id, payload);
      setMsg("Cambios guardados.");
      setTimeout(() => nav("/admin/usuarios"), 600);
    } catch (e) {
      setErr(e?.response?.data?.error || "No se pudo guardar.");
    } finally {
      setSaving(false);
      didSaveRef.current = false;
    }
  }

  if (!me) return <Navigate to="/login" replace />;
  if (Number(me.role) !== 4) return <Navigate to="/" replace />;

  return (
    <div className="page">
      <div className="page-header">
        <h2>Editar usuario</h2>
        <div className="header-actions">
          <Link to="/admin/usuarios" className="btn">Volver</Link>
        </div>
      </div>

      {(msg || err) && (
        <div
          ref={msgRef}
          tabIndex={-1}
          className={`msg ${msg ? "ok" : "error"}`}
          aria-live="polite"
        >
          {msg || err}
        </div>
      )}

      {/* ✅ Bloqueo si el usuario objetivo es Admin (rol 4) */}
      {!loading && blocked && (
        <div className="msg error" style={{ marginTop: 10 }}>
          Este usuario tiene rol <strong>Administrador (4)</strong>. Por seguridad, no es editable desde esta pantalla.
        </div>
      )}

      {!loading && !blocked && (
        <form onSubmit={onSubmit} className="admin-form" autoComplete="on">
          <div className="grid">
            <div className="field">
              <label>Usuario</label>
              <input
                className="input"
                value={form.username}
                readOnly
                aria-readonly="true"
              />
              <div className="hint">(No editable)</div>
            </div>

            <div className="field">
              <label>Nombre completo</label>
              <input
                className="input"
                name="nombre_completo"
                value={form.nombre_completo}
                onChange={onChange}
                required
                autoFocus
                placeholder="Nombre y apellidos"
              />
            </div>

            <div className="field">
              <label>Email</label>
              <input
                className="input"
                name="email"
                type="email"
                value={form.email}
                onChange={onChange}
                required
                inputMode="email"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck="false"
                placeholder="correo@ejemplo.com"
              />
            </div>

            <div className="field">
              <label>Rol</label>
              <select
                className="input"
                name="role_id"
                value={form.role_id}
                onChange={onChange}
                required
              >
                <option value="">Selecciona rol…</option>
                {rolesForSelect.map((r) => (
                  <option key={r.id} value={r.id}>{r.nombre}</option>
                ))}
              </select>
              <div className="hint">(El rol Administrador no es asignable.)</div>
            </div>

            <div className="field">
              <label>Área</label>
              <select
                className="input"
                name="area_id"
                value={form.area_id}
                onChange={onChange}
                required
              >
                <option value="">Selecciona área…</option>
                {areas.map((a) => (
                  <option key={a.id} value={a.id}>{a.nombre}</option>
                ))}
              </select>
            </div>

            <div className="actions">
              <button className="btn btn-primary" disabled={saving}>
                {saving ? "Guardando…" : "Guardar cambios"}
              </button>
              <Link className="btn" to="/admin/usuarios">Cancelar</Link>
            </div>
          </div>
        </form>
      )}
    </div>
  );
}
