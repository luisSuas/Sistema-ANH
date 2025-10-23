// src/Admin/AdminLayout.js
import React, { useMemo } from "react";
import { NavLink, Outlet, Navigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { whoAmI } from "../servicios/Servicios";
import "./admin.css";

export default function AdminLayout() {
  const { logout } = useAuth();
  const me = useMemo(() => whoAmI(), []);

  if (!me) return <Navigate to="/login" replace />;
  if (Number(me.role) !== 4) return <Navigate to="/" replace />;

  return (
    <div className="admin-shell">
      <aside className="admin-aside">
        <div className="brand">ANH · Admin</div>

        <nav className="nav" role="navigation" aria-label="Menú de administración">
          <NavLink
            end
            to="/admin"
            className={({ isActive }) => `navlink ${isActive ? "active" : ""}`}
          >
            Inicio
          </NavLink>
          <NavLink
            to="/admin/usuarios"
            className={({ isActive }) => `navlink ${isActive ? "active" : ""}`}
          >
            Usuarios
          </NavLink>
          <NavLink
            to="/admin/registro"
            className={({ isActive }) => `navlink ${isActive ? "active" : ""}`}
          >
            Registrar usuario
          </NavLink>
        </nav>

        <div className="aside-footer">
          <div className="me">
            <div className="me-name">{me?.nombre || "Administrador"}</div>
            <div className="me-role">Rol 4 · Administrador</div>
          </div>
          {/* ⬇️ Sin w-full: dejas que tus media queries decidan el ancho en móvil */}
          <button className="btn btn-danger" onClick={logout}>Salir</button>
        </div>
      </aside>

      <main className="admin-main">
        <Outlet />
      </main>
    </div>
  );
}
