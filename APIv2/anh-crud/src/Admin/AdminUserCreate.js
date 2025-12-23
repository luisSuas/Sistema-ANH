// src/Admin/AdminUserCreate.js
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Navigate } from "react-router-dom";
import api, { getCatalogo, whoAmI } from "../servicios/Servicios";
import "./admin.css";

export default function AdminUserCreate() {
  // Acceso del usuario actual
  const me = useMemo(() => whoAmI(), []);

  const [form, setForm] = useState({
    username: "",
    nombre_completo: "",
    email: "",
    role_id: "",
    area_id: "",
    password_default: "",
  });

  const [roles, setRoles] = useState([]);
  const [areas, setAreas] = useState([]);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState(null);
  const [err, setErr] = useState(null);

  const msgRef = useRef(null);            // ✅ para enfocar mensajes
  const didSubmit = useRef(false);        // ✅ evita doble submit rápido

  // ✅ para no pisar username si el admin lo editó manualmente
  const usernameTouchedRef = useRef(false);

  // Oculta el rol 4 (Administrador) para no asignarlo a otros usuarios
  const rolesForSelect = useMemo(
    () => roles.filter((r) => Number(r.id) !== 4),
    [roles]
  );

  const roleIdNum = Number(form.role_id);
  const isCoordGeneral = roleIdNum === 1;

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const [rRoles, rAreas] = await Promise.all([
          getCatalogo("roles"),
          getCatalogo("areas"),
        ]);
        if (!mounted) return;
        setRoles(Array.isArray(rRoles.data) ? rRoles.data : []);
        setAreas(Array.isArray(rAreas.data) ? rAreas.data : []);
      } catch {
        if (!mounted) return;
        setRoles([]);
        setAreas([]);
      }
    })();
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    if ((msg || err) && msgRef.current) {
      msgRef.current.focus();            // ✅ accesible en lectores de pantalla
    }
  }, [msg, err]);

  // ✅ Helpers para username automático
  function normalizeUser(s) {
    return String(s || "")
      .toLowerCase()
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9._-]+/g, "")
      .replace(/^[_\-.]+|[_\-.]+$/g, "")
      .slice(0, 32);
  }

  function generateUsernameFromFullName(full) {
    const parts = String(full).trim().split(/\s+/).filter(Boolean);
    const first = parts[0] || "user";
    const last  = parts[parts.length - 1] || "user";
    const base = normalizeUser(`${first}${last}`) || `user${Date.now()}`;
    return base.length >= 3 ? base : `${base}${Math.floor(Math.random() * 90 + 10)}`;
  }

  // ✅ Autogenera username desde nombre completo (solo si no lo tocaron manualmente)
  useEffect(() => {
    const full = form.nombre_completo.trim();
    if (!full) return;

    // si el admin ya escribió un username y no está vacío, respetarlo
    if (usernameTouchedRef.current && form.username.trim()) return;

    const suggested = generateUsernameFromFullName(full);
    setForm((f) => ({
      ...f,
      username: f.username.trim() ? f.username : suggested,
    }));
  }, [form.nombre_completo]); // eslint-disable-line react-hooks/exhaustive-deps

  function onChange(e) {
    const { name, value } = e.target;

    // ✅ email siempre normalizado
    if (name === "email") {
      return setForm((f) => ({ ...f, email: value.trim().toLowerCase() }));
    }

    // ✅ username: marcar como “tocado” para no autogenerarlo encima
    if (name === "username") {
      usernameTouchedRef.current = true;
      const v = value.replace(/\s+/g, "");
      return setForm((f) => ({ ...f, username: v }));
    }

    // ✅ si cambia rol: si es CG (1) limpiamos area_id porque NO aplica
    if (name === "role_id") {
      return setForm((f) => ({
        ...f,
        role_id: value,
        area_id: Number(value) === 1 ? "" : f.area_id,
      }));
    }

    setForm((f) => ({ ...f, [name]: value }));
  }

  function validate() {
    const { username, nombre_completo, email, role_id, area_id } = form;

    if (!username.trim() || !nombre_completo.trim() || !email.trim() || !role_id) {
      return "Todos los campos son obligatorios: usuario, nombre completo, email y rol.";
    }

    if (Number(role_id) !== 1 && !area_id) {
      return "El área es obligatoria para Coordinación de Área y Personal Operativo.";
    }

    if (username.trim().length < 3) return "El usuario debe tener al menos 3 caracteres.";

    const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
    if (!emailOk) return "El email no es válido.";

    return null;
  }

  async function onSubmit(e) {
    e.preventDefault();
    if (loading || didSubmit.current) return; // ✅ debouncing
    setMsg(null);
    setErr(null);

    const v = validate();
    if (v) {
      setErr(v);
      return;
    }

    setLoading(true);
    didSubmit.current = true;

    try {
      const roleId = parseInt(form.role_id, 10);

      if (roleId === 4) {
        setErr("No puedes asignar el rol Administrador (4) a otros usuarios.");
        return;
      }

      const payload = {
        username: form.username.trim(),
        nombre_completo: form.nombre_completo.trim(),
        email: form.email.trim().toLowerCase(),
        role_id: roleId,
        // ✅ si es CG, mandamos null explícito (backend también soporta vacío)
        area_id: roleId === 1 ? null : parseInt(form.area_id, 10),
      };

      if (form.password_default && form.password_default.trim()) {
        payload.password_default = form.password_default.trim();
      }

      await api.post("/admin/create-user", payload);

      setMsg("✅ Usuario creado. Se envió (si hay SMTP) el enlace para establecer contraseña.");
      setForm({
        username: "",
        nombre_completo: "",
        email: "",
        role_id: "",
        area_id: "",
        password_default: "",
      });
      usernameTouchedRef.current = false;
    } catch (e) {
      const status = e?.response?.status;
      const apiErr =
        e?.response?.data?.error ||
        (status === 409
          ? "Ya existe un usuario con este correo para ese rol y esa área."
          : "No se pudo crear el usuario");

      setErr(apiErr);
    } finally {
      setLoading(false);
      didSubmit.current = false;
    }
  }

  // Solo Admin (rol 4)
  if (!me) return <Navigate to="/login" replace />;
  if (Number(me.role) !== 4) return <Navigate to="/" replace />;

  return (
    <div className="admin-create">
      <div className="admin-create__header">
        <div>
          <h1>Administración · Crear usuario</h1>
          <p className="admin-create__subtitle">
            Asigna <strong>rol</strong>, <strong>área</strong> y <strong>correo</strong>. Se enviará un enlace para establecer contraseña.
          </p>
        </div>
      </div>

      {(msg || err) && (
        <div
          ref={msgRef}
          tabIndex={-1}
          className={`msg ${msg ? "ok" : "error"}`}
          aria-live="polite"
          // ✅ mejora contraste en tema oscuro cuando el fondo es claro
          style={{ color: msg ? "var(--success-text, #0f2f1d)" : "var(--error-text, #1b1b1b)" }}
        >
          {msg || err}
        </div>
      )}

      <form onSubmit={onSubmit} className="admin-card form-grid" autoComplete="on">
        <div className="form-row">
          <label htmlFor="username">Usuario *</label>
          <input
            id="username"
            name="username"
            value={form.username}
            onChange={onChange}
            required
            minLength={3}
            maxLength={32}
            inputMode="latin"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck="false"
            placeholder="p.ej. jvelasquez"
          />
          <small className="hint">Solo letras/números y . _ -</small>
        </div>

        <div className="form-row">
          <label htmlFor="nombre_completo">Nombre completo *</label>
          <input
            id="nombre_completo"
            name="nombre_completo"
            value={form.nombre_completo}
            onChange={(e) => {
              // ✅ si el admin NO tocó username, al cambiar nombre se sugiere username
              setForm((f) => ({ ...f, nombre_completo: e.target.value }));
            }}
            required
            placeholder="Nombre y apellidos"
            autoCapitalize="words"
          />
        </div>

        <div className="form-row">
          <label htmlFor="email">Email *</label>
          <input
            id="email"
            type="email"
            name="email"
            value={form.email}
            onChange={onChange}
            required
            placeholder="correo@ejemplo.com"
            inputMode="email"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck="false"
          />
        </div>

        <div className="form-row">
          <label htmlFor="role_id">Rol *</label>
          <select id="role_id" name="role_id" value={form.role_id} onChange={onChange} required>
            <option value="">Selecciona rol…</option>
            {rolesForSelect.map((r) => (
              <option key={r.id} value={r.id}>{r.nombre}</option>
            ))}
          </select>
          <small className="hint">
            El rol <strong>Administrador</strong> no es asignable.
            {isCoordGeneral ? " · Coordinación General no lleva área." : ""}
          </small>
        </div>

        {/* ✅ Área solo si NO es Coordinación General */}
        {!isCoordGeneral && (
          <div className="form-row">
            <label htmlFor="area_id">Área *</label>
            <select
              id="area_id"
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
        )}

        <div className="form-row">
          <label htmlFor="password_default">Contraseña temporal (opcional)</label>
          <input
            id="password_default"
            name="password_default"
            value={form.password_default}
            onChange={onChange}
            placeholder="Si la dejas vacía se genera una aleatoria"
            autoComplete="new-password"
            minLength={8}
          />
          <small className="hint">
            Mínimo 8 caracteres. Puedes dejarla vacía para que se genere automáticamente.
          </small>
        </div>

        <div className="form-actions">
          <button type="submit" className="btn btn-primary" disabled={loading}>
            {loading ? "Creando…" : "Crear usuario"}
          </button>

          <button
            type="button"
            className="btn btn-soft"
            disabled={loading}
            onClick={() => {
              setForm({
                username: "",
                nombre_completo: "",
                email: "",
                role_id: "",
                area_id: "",
                password_default: "",
              });
              usernameTouchedRef.current = false;
              setErr(null);
              setMsg(null);
              msgRef.current?.focus();
            }}
          >
            Limpiar
          </button>
        </div>
      </form>

      <div className="footnote">
        * Requiere sesión con rol <strong>4</strong> (Administrador).
      </div>
    </div>
  );
}
