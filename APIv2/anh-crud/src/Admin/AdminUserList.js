// src/Admin/AdminUserList.js
import React, { useEffect, useMemo, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import {
  adminGetUsers,
  adminDeleteUser,
  getUsuarios,      // fallback legacy
  getCatalogo,
  whoAmI
} from "../servicios/Servicios";
import "./admin.css";

export default function AdminUserList() {
  const me = useMemo(() => whoAmI(), []);
  const nav = useNavigate();

  const [q, setQ] = useState("");
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);

  useEffect(() => {
    let on = true;
    (async () => {
      try {
        setLoading(true);
        setErr(null);

        // Carga catálogos para mapear nombres legibles
        const [rRoles, rAreas] = await Promise.all([
          getCatalogo("roles").catch(() => ({ data: [] })),
          getCatalogo("areas").catch(() => ({ data: [] })),
        ]);
        const rolesMap = new Map(
          (Array.isArray(rRoles.data) ? rRoles.data : []).map((r) => [Number(r.id), r.nombre])
        );
        const areasMap = new Map(
          (Array.isArray(rAreas.data) ? rAreas.data : []).map((a) => [Number(a.id), a.nombre])
        );

        // 1) Intentar endpoint del panel admin
        let list;
        try {
          const { data } = await adminGetUsers();
          const arr = Array.isArray(data?.users) ? data.users : (Array.isArray(data) ? data : []);
          list = arr;
        } catch {
          // 2) Fallback a legacy /usuarios si el admin endpoint no existe
          const { data } = await getUsuarios();
          list = Array.isArray(data) ? data : [];
        }

        if (!on) return;

        // Enriquecer con nombres de rol/área y ocultar ADMIN (rol 4)
        const enriched = list
          .map((u) => {
            const roleId = Number(u.role_id ?? u.roleId ?? u.role);
            const areaId = Number(u.area_id ?? u.areaId ?? u.area);
            const roleName = u.role_nombre || u.roleName || rolesMap.get(roleId) || `#${roleId || "-"}`;
            const areaName = u.area_nombre || u.areaName || areasMap.get(areaId) || `#${areaId || "-"}`;
            return { ...u, roleId, areaId, roleName, areaName };
          })
          .filter((u) => u.roleId !== 4); // No mostrar superadmin para evitar borrados accidentales

        setRows(enriched);
      } catch (e) {
        if (!on) return;
        setErr("No se pudo cargar la lista");
      } finally {
        if (on) setLoading(false);
      }
    })();
    return () => { on = false; };
  }, []);

  const filtered = rows.filter((r) => {
    const needle = q.trim().toLowerCase();
    if (!needle) return true;
    return (
      String(r.username || "").toLowerCase().includes(needle) ||
      String(r.roleName || "").toLowerCase().includes(needle) ||
      String(r.areaName || "").toLowerCase().includes(needle)
    );
  });

  async function onDelete(id) {
    if (!id) return;
    const ok = window.confirm("¿Eliminar este usuario? Esta acción no se puede deshacer.");
    if (!ok) return;
    try {
      // Intentar ruta admin
      try {
        await adminDeleteUser(id);
      } catch {
        // Fallback legacy si no existe la ruta admin aún
        const { deleteUsuario } = await import("../servicios/Servicios");
        await deleteUsuario(id);
      }
      setRows((rs) => rs.filter((r) => r.id !== id));
    } catch {
      alert("No se pudo eliminar.");
    }
  }

  // Solo ADMIN (rol 4) puede entrar a este listado
  if (!me) return <Navigate to="/login" replace />;
  if (Number(me.role) !== 4) return <Navigate to="/" replace />;

  return (
    <div className="page">
      <div className="page-header">
        <h2>Usuarios</h2>
        <div className="header-actions">
          <Link to="/admin/registro" className="btn btn-primary">Nuevo usuario</Link>
        </div>
      </div>

      <div className="toolbar">
        <input
          placeholder="Buscar por usuario, rol o área…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="input"
        />
      </div>

      {err && <div className="msg error">{err}</div>}

      <div className="table-wrap">
        <table className="table" aria-label="Listado de usuarios">
          <thead>
            <tr>
              <th style={{ width: 100 }}>ID</th>
              <th>Usuario</th>
              <th style={{ width: 220 }}>Rol</th>
              <th style={{ width: 220 }}>Área</th>
              <th style={{ width: 220 }}>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={5} style={{ textAlign: "center" }}>Cargando…</td>
              </tr>
            )}
            {!loading && filtered.length === 0 && (
              <tr><td colSpan={5} style={{ textAlign: "center" }}>Sin resultados</td></tr>
            )}
            {filtered.map((u) => (
              <tr key={u.id}>
                <td data-label="ID">{u.id}</td>
                <td data-label="Usuario">{u.username}</td>
                <td data-label="Rol">{u.roleName}</td>
                <td data-label="Área">{u.areaName}</td>
                <td data-label="Acciones" className="actions">
                  <button
                    className="btn"
                    onClick={() => nav(`/admin/usuarios/${u.id}/editar`)}
                    title="Editar usuario"
                  >
                    Editar
                  </button>
                  <button
                    className="btn btn-danger"
                    onClick={() => onDelete(u.id)}
                    title="Eliminar usuario"
                  >
                    Eliminar
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
