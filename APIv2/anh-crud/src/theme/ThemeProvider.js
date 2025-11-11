// src/theme/ThemeProvider.jsx
import React, {createContext, useContext, useEffect, useMemo, useState} from "react";
import "./tokens.css";

const ThemeCtx = createContext();

const getStored = () => localStorage.getItem("theme-preference") || "system";

export function ThemeProvider({children}) {
  const [theme, setTheme] = useState(getStored); // "system" | "light" | "dark"
  const media = useMemo(() => window.matchMedia("(prefers-color-scheme: dark)"), []);
  const systemIsDark = media.matches;

  const resolved = theme === "system" ? (systemIsDark ? "dark" : "light") : theme;

  // Aplica data-theme en <html>
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute("data-theme", resolved === "dark" ? "dark" : "light");
  }, [resolved]);

  // Escucha cambios del SO solo si estás en "system"
  useEffect(() => {
    if (theme !== "system") return;
    const onChange = () => {
      const root = document.documentElement;
      root.setAttribute("data-theme", media.matches ? "dark" : "light");
    };
    media.addEventListener?.("change", onChange);
    return () => media.removeEventListener?.("change", onChange);
  }, [theme, media]);

  const value = {
    theme,                  // "system" | "light" | "dark" (preferencia)
    resolvedTheme: resolved, // "light" | "dark" (efectivo)
    setTheme: (t) => {
      localStorage.setItem("theme-preference", t);
      setTheme(t);
    }
  };

  return <ThemeCtx.Provider value={value}>{children}</ThemeCtx.Provider>;
}

export function useTheme() {
  return useContext(ThemeCtx);
}

