// src/auth/AuthContext.js
import React, { createContext, useContext, useEffect, useRef, useState } from "react";
import { getToken, setToken, onTokenChanged } from "../servicios/Servicios";

const AuthCtx = createContext(null);

function decodeToken(t) {
  try {
    const p = JSON.parse(atob(String(t).split(".")[1]));
    return {
      id: p.sub,
      nombre: p.name,
      role: Number(p.role),
      area: Number(p.area),
      exp: p.exp, // unix seconds
    };
  } catch {
    return null;
  }
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);
  const expiryTimerRef = useRef(null);

  const clearTimer = () => {
    if (expiryTimerRef.current) {
      clearTimeout(expiryTimerRef.current);
      expiryTimerRef.current = null;
    }
  };

  const scheduleExpiry = (exp) => {
    clearTimer();
    if (!exp) return;
    const ms = exp * 1000 - Date.now() - 1000; // 1s colchón
    if (ms > 0) {
      expiryTimerRef.current = setTimeout(() => doLogout(false), ms);
    }
  };

  const applyToken = (t) => {
    if (!t) {
      setUser(null);
      clearTimer();
      return;
    }
    const u = decodeToken(t);
    // si no se puede decodificar o está vencido
    if (!u || (u.exp && Date.now() / 1000 > u.exp)) {
      setToken(null);
      setUser(null);
      clearTimer();
      return;
    }
    setUser(u);
    scheduleExpiry(u.exp);
  };

  const initFromStorage = () => {
    const t = getToken(); // fuente única de verdad del token
    applyToken(t);
    setReady(true);
  };

  // Carga inicial
  useEffect(() => {
    initFromStorage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 🔄 Sync de cambios de token (misma pestaña y entre pestañas)
  useEffect(() => {
    // Nos suscribimos al canal nativo de Servicios (sin eventos DOM)
    const unsubscribe = onTokenChanged((t) => {
      applyToken(t);
      setReady(true);
    });
    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Login centralizado
  const doLogin = (token) => {
    if (!token) return doLogout();
    setToken(token);   // persiste y notifica; no duplicamos localStorage aquí
    applyToken(token); // reflejar en estado inmediatamente
    setReady(true);
  };

  // Logout centralizado (redirige a /login por defecto)
  const doLogout = (redirect = true) => {
    clearTimer();
    setToken(null); // persiste y notifica
    setUser(null);
    setReady(true);
    if (redirect) window.location.replace("/login");
  };

  return (
    <AuthCtx.Provider
      value={{
        user,
        ready,
        isAuthenticated: !!user,
        setUser,
        login: doLogin,
        logout: doLogout,
      }}
    >
      {children}
    </AuthCtx.Provider>
  );
}

export function useAuth() {
  return useContext(AuthCtx);
}
