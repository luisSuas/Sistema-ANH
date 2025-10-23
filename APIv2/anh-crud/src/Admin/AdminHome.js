// src/Admin/AdminHome.js
import React, { useEffect, useState } from "react";
import { getUsuarios } from "../servicios/Servicios";
import "./admin.css";

export default function AdminHome() {
  const [total, setTotal] = useState(0);

  useEffect(() => {
    let on = true;
    (async () => {
      try {
        const { data } = await getUsuarios();
        if (!on) return;
        setTotal(Array.isArray(data) ? data.length : 0);
      } catch {
        if (!on) return;
        setTotal(0);
      }
    })();
    return () => { on = false; };
  }, []);

  return (
    <main className="page" aria-labelledby="admin-home-title">
      <header className="page-header">
        <div>
          <h2 id="admin-home-title">Panel de Administración</h2>
          <p className="page-subtitle" style={{ color: "var(--muted)" }}>
            Resumen rápido del módulo de usuarios.
          </p>
        </div>
        {/* Si luego agregas acciones (filtros, etc.), colócalas aquí */}
        <div className="header-actions" />
      </header>

      <section className="cards" aria-label="Indicadores">
        <article className="card">
          <div className="card-label">Usuarios registrados</div>
          <div className="card-value">{total}</div>
        </article>
      </section>
    </main>
  );
}
