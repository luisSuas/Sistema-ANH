// src/components/ThemeSwitch.jsx
import React, { useMemo, useCallback } from "react";
import { useTheme } from "../theme/ThemeProvider";

export default function ThemeSwitch({ compact = false }) {
  const { theme, setTheme, resolvedTheme } = useTheme();

  // Próximo tema cuando estás en compacto (click normal alterna; Ctrl/⌘ = system)
  const next = useMemo(() => {
    if (theme === "system") return resolvedTheme === "dark" ? "light" : "dark";
    return theme === "dark" ? "light" : "dark";
  }, [theme, resolvedTheme]);

  // Navegación con flechas en el selector 3 estados
  const onKey = useCallback(
    (e) => {
      if (compact) return;
      const order = ["system", "light", "dark"];
      const i = order.indexOf(theme);
      if (i === -1) return;
      if (e.key === "ArrowRight") setTheme(order[(i + 1) % order.length]);
      if (e.key === "ArrowLeft") setTheme(order[(i + order.length - 1) % order.length]);
    },
    [theme, setTheme, compact]
  );

  if (compact) {
    return (
      <button
        type="button"
        title={`Tema actual: ${theme}. Click: ${next}. Ctrl/⌘: Auto (system).`}
        onClick={(e) => (e.ctrlKey || e.metaKey ? setTheme("system") : setTheme(next))}
        style={{
          padding: "6px 10px",
          border: "1px solid var(--border)",
          background: "var(--panel)",
          color: "var(--text)",
          borderRadius: 10,
          cursor: "pointer",
        }}
        aria-label={`Tema: ${theme}`}
      >
        {theme === "system" ? "Auto" : resolvedTheme === "dark" ? "🌙 Oscuro" : "☀️ Claro"}
      </button>
    );
  }

  const Button = ({ value, children }) => (
    <button
      type="button"
      onClick={() => setTheme(value)}
      aria-pressed={theme === value}
      title={value === "system" ? "Seguir el sistema" : `Tema ${value === "light" ? "claro" : "oscuro"}`}
      style={{
        padding: "6px 10px",
        borderRadius: 999,
        border: "1px solid var(--border)",
        background: theme === value ? "var(--panel)" : "transparent",
        color: "var(--text)",
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );

  return (
    <div
      role="group"
      aria-label="Selector de tema"
      onKeyDown={onKey}
      tabIndex={0}
      style={{
        display: "inline-flex",
        gap: 6,
        background: "var(--panel-2)",
        padding: 4,
        borderRadius: 999,
        border: "1px solid var(--border)",
      }}
    >
      <Button value="system">Auto</Button>
      <Button value="light">Claro</Button>
      <Button value="dark">Oscuro</Button>
    </div>
  );
}
