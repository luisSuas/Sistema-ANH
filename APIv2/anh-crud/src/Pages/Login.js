// src/pages/Login.js
import React, { useRef, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { login as doLogin } from "../servicios/Servicios";
import "./Login.css";

function getStoredToken() {
  const keys = ["access_token", "token", "authToken", "jwt", "bearer"];
  for (const k of keys) {
    const v =
      window.localStorage.getItem(k) || window.sessionStorage.getItem(k);
    if (v) return v;
  }
  return null;
}

function base64UrlToJson(b64url) {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const decoded = atob(b64 + pad);
  try {
    return JSON.parse(decoded);
  } catch {
    return null;
  }
}

function decodeJwt(token) {
  if (!token || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  return base64UrlToJson(parts[1]); // payload
}

// roles: 1 = Coordinación General, 2 = Coordinación de Área, 3 = Operativo, 4 = Administrador
// áreas: 1=Social, 2=Legal, 3=Médica, 4=Psicológica, 5=Albergue
function routeByRoleArea(role, area) {
  if (role === 4) return "/admin"; // o "/admin/usuarios/nuevo"
  if (role === 1) return "/general"; // CG
  const map = {
    1: "/social",
    2: "/legal",
    3: "/medica",
    4: "/psicologica",
    5: "/albergue",
  };
  return map[Number(area)] || "/social";
}

// ⬇️ Utilidad para extraer token tanto si viene como string o como {token}
function extractToken(maybeToken) {
  if (typeof maybeToken === "string") return maybeToken;
  if (maybeToken && typeof maybeToken.token === "string") return maybeToken.token;
  return null;
}

// Para reintentar el login con OTP si tu Servicios.login aún no lo envía.
const API_LOGIN_URL =
  process.env.REACT_APP_API_LOGIN || "http://localhost:8800/apiv2/auth/login";

const Login = ({ onSuccess }) => {
  const navigate = useNavigate();
  const { login: authLogin } = useAuth();
  const didLoginRef = useRef(false); // ✅ evita doble finish

  const [cred, setCred] = useState({ username: "", password: "" });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [showPass, setShowPass] = useState(false);

  // 🔐 MFA
  const [showMfa, setShowMfa] = useState(false);
  const [otp, setOtp] = useState("");
  const [mfaError, setMfaError] = useState("");
  const [pendingCreds, setPendingCreds] = useState(null); // { username, password }

  const handleChange = (e) => {
    const { name, value } = e.target;
    setCred((c) => ({ ...c, [name]: value }));
  };

  // ⬇️ Redirecciona con el token guardado
  function finishLoginAndRedirect(token) {
    if (didLoginRef.current) return; // ✅ idempotente
    didLoginRef.current = true;
    localStorage.setItem("access_token", token);
    authLogin(token);
    const p = decodeJwt(token);
    const target = routeByRoleArea(Number(p?.role), Number(p?.area));
    navigate(target, { replace: true });
  }

  // ⬇️ Reintento directo al API con OTP (fallback por si Servicios.login no lo soporta)
  async function loginWithOtpFallback(username, password, otp) {
    const res = await fetch(API_LOGIN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password, otp }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg =
        data?.error || (res.status === 401 ? "Código inválido" : "Error");
      throw new Error(msg);
    }
    const token = extractToken(data);
    if (!token) throw new Error("No se recibió token");
    return token;
  }

  const handleSubmit = async (e) => {
    e.preventDefault();
    // ✅ un solo guard: no enviar si está enviando o si el modal MFA está abierto
    if (isSubmitting || showMfa) return;

    const username = cred.username.trim();
    const password = cred.password;
    if (!username || !password) return;

    setIsSubmitting(true);
    setErrorMsg("");

    try {
      // Primer intento normal
      const resp = await doLogin(username, password);

      // ✅ NUEVO: si tu backend responde 200 con reto MFA, lo detectamos aquí
      if (resp && resp.code === "MFA_REQUIRED") {
        setPendingCreds({ username, password });
        setShowMfa(true);
        setMfaError("");
        return;
      }

      let token = extractToken(resp);
      if (!token) token = getStoredToken();

      if (token) {
        finishLoginAndRedirect(token);
        return;
      }

      // Fallback improbable
      navigate("/social", { replace: true });
    } catch (err) {
      // Si el backend respondió 401 con MFA requerido, abrimos el modal
      const code = err?.response?.data?.code;
      const msg =
        err?.response?.data?.error ||
        err?.message ||
        "Usuario o contraseña incorrectos. Intenta de nuevo.";

      if (code === "MFA_REQUIRED" || /MFA/i.test(msg)) {
        setPendingCreds({ username, password });
        setShowMfa(true);
        setMfaError("");
      } else {
        setErrorMsg(msg);
        setCred({ username: "", password: "" });
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleConfirmOtp = async () => {
    const code = otp.trim();
    if (code.length < 6) {
      setMfaError("Ingresa el código de 6 dígitos");
      return;
    }
    if (!pendingCreds) {
      setMfaError("Sesión expirada. Vuelve a iniciar sesión.");
      return;
    }

    setIsSubmitting(true);
    setMfaError("");
    try {
      // 1) Intento usar Servicios.login con otp (si lo soporta)
      let token = null;
      try {
        const resp = await doLogin(pendingCreds.username, pendingCreds.password, code);

        // ✅ también contemplamos el caso MFA_REQUIRED por si alguien hace doble clic
        if (resp && resp.code === "MFA_REQUIRED") {
          throw new Error("Código inválido");
        }

        token = extractToken(resp) || getStoredToken();
      } catch {
        // 2) Fallback: llamada directa al endpoint
        token = await loginWithOtpFallback(
          pendingCreds.username,
          pendingCreds.password,
          code
        );
      }

      if (!token) throw new Error("No se recibió token");
      setShowMfa(false);
      setOtp("");
      finishLoginAndRedirect(token);
    } catch (e) {
      setMfaError(e?.message || "Código inválido");
    } finally {
      setIsSubmitting(false);
    }
  };

  const disabled = isSubmitting || !cred.username.trim() || !cred.password;

  return (
    <div className="login-form-container">
      <h2>Iniciar Sesión</h2>

      <form
        onSubmit={handleSubmit}
        className="login-form"
        autoComplete="on"
        onKeyDown={(e) => {
          // ✅ si el modal MFA está abierto, bloquear Enter del formulario
          if (showMfa && e.key === "Enter") e.preventDefault();
        }}
      >
        <label>Usuario</label>
        <input
          type="text"
          name="username"
          value={cred.username}
          onChange={handleChange}
          placeholder="usuario"
          autoFocus
          required
        />

        <label>Contraseña</label>
        <div className="password-field">
          <input
            type={showPass ? "text" : "password"}
            name="password"
            value={cred.password}
            onChange={handleChange}
            placeholder="••••••"
            required
          />
          <button
            type="button"
            className="toggle-pass"
            onClick={() => setShowPass((v) => !v)}
            aria-label={showPass ? "Ocultar contraseña" : "Mostrar contraseña"}
          >
            {showPass ? "Ocultar" : "Ver"}
          </button>
        </div>

        {errorMsg && <div className="login-error">{errorMsg}</div>}

        <button type="submit" disabled={showMfa || disabled}>
          {isSubmitting ? "Entrando..." : "Entrar"}
        </button>

        <div style={{ marginTop: 12, textAlign: "right" }}>
          <Link to="/forgot-password">¿Olvidaste tu contraseña?</Link>
        </div>
      </form>

      {/* 🔐 Modal de MFA */}
      {showMfa && (
        <div className="mfa-backdrop">
          <div className="mfa-modal" role="dialog" aria-modal="true">
            <h3>Verificación MFA</h3>
            <p>Abre tu app Authenticator y escribe el código de 6 dígitos.</p>
            <input
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={6}
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
              placeholder="000000"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault(); // ✅ no envía el form padre
                  if (!isSubmitting) handleConfirmOtp();
                }
              }}
            />
            {mfaError && (
              <div className="login-error" style={{ marginTop: 8 }}>
                {mfaError}
              </div>
            )}
            <div className="mfa-actions">
              <button
                type="button"
                className="mfa-cancel"
                onClick={() => {
                  setShowMfa(false);
                  setOtp("");
                  setMfaError("");
                }}
              >
                Cancelar
              </button>
              <button type="button" onClick={handleConfirmOtp} disabled={isSubmitting}>
                {isSubmitting ? "Verificando…" : "Confirmar"}
              </button>
            </div>
          </div>

          
        </div>
      )}
    </div>
  );
};

export default Login;

