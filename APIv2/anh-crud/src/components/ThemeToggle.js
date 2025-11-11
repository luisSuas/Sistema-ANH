// src/components/ThemeToggle.jsx
import React, { useEffect, useMemo, useRef } from "react";
import { useTheme } from "../theme/ThemeProvider";
import "./ThemeToggle.css";

/**
 * ThemeToggle (auto-avoid mejorado)
 * - iOS-like (sol/luna). Click alterna claro/oscuro; chip "Auto" sigue el sistema.
 * - float:
 *    - true / "top": fija arriba-derecha (default)
 *    - "bottom": fija abajo-derecha
 * - avoidSelector: elementos que no debe tapar (default: [data-avoid-fab], .avoid-fab)
 */
export default function ThemeToggle({
  float = false,
  showAuto = true,
  avoidSelector = "[data-avoid-fab], .avoid-fab",
}) {
  const { theme, resolvedTheme, setTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const wrapRef = useRef(null);

  // Constantes visuales
  const H = 45;           // altura lógico/óptica del switch (para fallback)
  const GAP = 8;         // espacio entre FAB y ancla
  const BASE_RIGHT = -15;  // margen base a la derecha
  const BASE_TOP = 10;    // margen base arriba

  const toggle = () => setTheme(isDark ? "light" : "dark");

  

  // ───────────────────────────────────────────────────────────
  // (3) Habilita carril seguro en topbars cuando flota ARRIBA
  // ───────────────────────────────────────────────────────────
  useEffect(() => {
    const topMode = !!float && float !== "bottom";
    if (topMode) {
      document.documentElement.classList.add("with-fab-top");
      return () => document.documentElement.classList.remove("with-fab-top");
    }
    return undefined;
  }, [float]);
  // ───────────────────────────────────────────────────────────

  // ---- Rutina de posicionamiento con auto-evitar ----
 // Sustituye TODO el useMemo(dock) actual por esto:
const dock = useMemo(() => {
  return () => {
    const el = wrapRef.current;
    if (!el || !float || float === "bottom") return;

    // Posición base (arriba-derecha)
    el.style.position = "fixed";
    el.style.right = `${BASE_RIGHT}px`;
    el.style.top = `${BASE_TOP}px`;
    el.style.bottom = "auto";

    // Caja del FAB en su posición actual
    const fab = el.getBoundingClientRect();
    const fabH = fab.height || H;
    const fabW = fab.width;

    // Candidatos: los que marcaste + UI comunes (botón/chip/select/badge)
    const candidates = Array.from(
      document.querySelectorAll(
        `${avoidSelector}, button, .btn, [role="button"], .chip, .badge, select`
      )
    )
      .map(n => ({ n, r: n.getBoundingClientRect() }))
      .filter(({ r }) => r.width > 0 && r.height > 0);

    if (!candidates.length) return;

    // ¿Quién se SOLAPA con el FAB?
    const overlap = ({ r }) =>
      !(r.right < fab.left || r.left > fab.right || r.bottom < fab.top || r.top > fab.bottom);

    const overlapping = candidates.filter(overlap);
    if (!overlapping.length) return;

    // El solapado más “pegado” al borde derecho
    overlapping.sort(
      (a, b) =>
        (window.innerWidth - a.r.right) - (window.innerWidth - b.r.right)
    );
    const a = overlapping[0].r;

    // Intento 1: mover a la IZQUIERDA del ancla y centrar verticalmente
    const desiredRight = BASE_RIGHT + (window.innerWidth - a.left) + GAP;
    const leftAfterMove = window.innerWidth - (desiredRight + fabW);
    const fitsLeft = leftAfterMove >= 8;

    if (fitsLeft) {
      el.style.right = `${Math.round(desiredRight)}px`;
      const topTarget = Math.max(10, a.top + (a.height - fabH) / 2);
      el.style.top = `${Math.round(topTarget)}px`;
      return;
    }

    // Intento 2: no cabe a la izquierda → colocarlo DEBAJO del ancla
    const belowTop = Math.min(a.bottom + GAP, window.innerHeight - fabH - 8);
    el.style.right = `${BASE_RIGHT}px`;
    el.style.top = `${Math.round(belowTop)}px`;
  };
}, [avoidSelector, float]);


  useEffect(() => {
    if (!float || float === "bottom") return;

    const run = () => requestAnimationFrame(dock);
    run();

    const ro = new ResizeObserver(run);
    ro.observe(document.documentElement);

    // Observa cambios en el candidato a evitar (si existe)
    const target = document.querySelector(avoidSelector) || document.body;
    const mo = new MutationObserver(run);
    mo.observe(target, { attributes: true, childList: true, subtree: true });

    window.addEventListener("resize", run);
    window.addEventListener("scroll", run, { passive: true });

    return () => {
      ro.disconnect();
      mo.disconnect();
      window.removeEventListener("resize", run);
      window.removeEventListener("scroll", run);
    };
  }, [dock, avoidSelector, float]);

  // ---- UI core ----
  const core = (
    <div
      ref={wrapRef}
      className="theme-wrap"
      style={{ display: "inline-flex", alignItems: "center", gap: 10 }}
    >
      <button
        type="button"
        className={`theme-toggle ${isDark ? "is-dark" : ""}`}
        onClick={toggle}
        aria-pressed={isDark}
        aria-label={`Cambiar a modo ${isDark ? "claro" : "oscuro"}`}
        title={`Click: ${isDark ? "Claro" : "Oscuro"}`}
      >
        <span className="knob" />
      </button>

      {showAuto && (
        <button
          type="button"
          className={`theme-auto-chip ${theme === "system" ? "active" : ""}`}
          onClick={() => setTheme("system")}
          title="Seguir el tema del sistema"
          aria-pressed={theme === "system"}
          style={{
            height: H,
            lineHeight: `${H}px`,
            display: "inline-flex",
            alignItems: "center",
          }}
        >
          Auto
        </button>
      )}
    </div>
  );

  // Modo flotante (arriba o abajo)
  if (float) {
    const topMode = float !== "bottom";
    return (
      <div
        className="theme-fab"
        style={{
          position: "fixed",
          right: `calc(${BASE_RIGHT}px + env(safe-area-inset-right, 0px))`,
          zIndex: 2147483647,
          top:   topMode ? `calc(${BASE_TOP}px + env(safe-area-inset-top, 0px))` : "auto",
          bottom: topMode ? "auto" : 20,
        }}
      >
        {core}
      </div>
    );
  }

  return core;
}
