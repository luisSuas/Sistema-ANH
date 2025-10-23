// src/pages/ResetPassword.js
import React, { useEffect, useMemo, useState } from "react";
import { validateResetToken, resetPassword } from "../servicios/Servicios";
import "./ResetPassword.css";

export default function ResetPassword() {
  const params = new URLSearchParams(window.location.search);
  const token = params.get("token") || "";
  const [loading, setLoading] = useState(true);
  const [valid, setValid] = useState(false);

  const [pwd, setPwd] = useState("");
  const [pwd2, setPwd2] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  // Mostrar/ocultar
  const [show1, setShow1] = useState(false);
  const [show2, setShow2] = useState(false);

  // Validación inicial del token (y si falta token -> inválido)
  useEffect(() => {
    (async () => {
      try {
        if (!token || token.length < 10) {
          setValid(false);
        } else {
          const resp = await validateResetToken(token); // ← devuelve { valid: boolean }
          setValid(!!resp?.valid);
        }
      } catch {
        setValid(false);
      } finally {
        setLoading(false);
      }
    })();
  }, [token]);

  // Política de contraseña (cliente)
  const policy = useMemo(() => ({
    minLen: pwd.length >= 8,                              // mínimo 8
    upper: /[A-Z]/.test(pwd),                             // 1 mayúscula
    lower: /[a-z]/.test(pwd),                             // 1 minúscula
    digit: /\d/.test(pwd),                                // 1 número
    special: /[!@#$%^&*()_\-+={[}\]|\\:;"'<>,.?/~`]/.test(pwd), // 1 especial
  }), [pwd]);
  const policyOK = Object.values(policy).every(Boolean);
  const matchOK = pwd.length > 0 && pwd === pwd2;

  async function onSubmit(e) {
    e.preventDefault();
    if (submitting) return;

    if (!policyOK) {
      alert("La contraseña debe cumplir todos los requisitos de seguridad.");
      return;
    }
    if (!matchOK) {
      alert("Las contraseñas no coinciden.");
      return;
    }

    setSubmitting(true);
    try {
      await resetPassword(token, pwd);
      setDone(true);
    } catch {
      alert("El enlace no es válido o expiró.");
      // Revalida para actualizar la vista en caliente
      try {
        const resp = await validateResetToken(token);
        setValid(!!resp?.valid);
      } catch {
        setValid(false);
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="login-form-container">
        <p>Validando enlace...</p>
      </div>
    );
  }

  if (!valid) {
    return (
      <div className="login-form-container">
        <h2>Enlace inválido o vencido</h2>
        <p className="muted">
          El enlace de recuperación ya no es válido. Solicita uno nuevo desde
          la página de recuperación.
        </p>
        <div style={{ marginTop: 12 }}>
          <a className="btn-primary" href="/forgot-password">Solicitar nuevo enlace</a>
          <div style={{ height: 8 }} />
          <a className="link" href="/login">Volver al inicio de sesión</a>
        </div>
      </div>
    );
  }

  if (done) {
    return (
      <div className="login-form-container">
        <h2>Contraseña actualizada</h2>
        <p>Tu contraseña fue cambiada correctamente.</p>
        <div style={{ marginTop: 12 }}>
          <a className="btn-primary" href="/login">Ir a iniciar sesión</a>
        </div>
      </div>
    );
  }

  return (
    <div className="login-form-container">
      <h2>Definir nueva contraseña</h2>

      <form className="login-form" onSubmit={onSubmit}>
        {/* Campo 1 */}
        <label>Nueva contraseña</label>
        <div className="password-field">
          <input
            type={show1 ? "text" : "password"}
            minLength={8}
            value={pwd}
            onChange={e => setPwd(e.target.value)}
            placeholder="••••••••"
            required
          />
          <button
            type="button"
            className="toggle-pass"
            onClick={() => setShow1(s => !s)}
            aria-label={show1 ? "Ocultar contraseña" : "Mostrar contraseña"}
          >
            {show1 ? "Ocultar" : "Ver"}
          </button>
        </div>

        {/* Checklist de política */}
        <ul className="pwd-policy">
          <li className={policy.minLen ? "ok" : "bad"}>Mínimo 8 caracteres</li>
          <li className={policy.upper ? "ok" : "bad"}>Al menos 1 letra mayúscula (A–Z)</li>
          <li className={policy.lower ? "ok" : "bad"}>Al menos 1 letra minúscula (a–z)</li>
          <li className={policy.digit ? "ok" : "bad"}>Al menos 1 número (0–9)</li>
          <li className={policy.special ? "ok" : "bad"}>Al menos 1 carácter especial (!@#$…)</li>
        </ul>

        {/* Campo 2 */}
        <label>Confirmar contraseña</label>
        <div className="password-field">
          <input
            type={show2 ? "text" : "password"}
            minLength={8}
            value={pwd2}
            onChange={e => setPwd2(e.target.value)}
            placeholder="••••••••"
            required
          />
          <button
            type="button"
            className="toggle-pass"
            onClick={() => setShow2(s => !s)}
            aria-label={show2 ? "Ocultar confirmación" : "Mostrar confirmación"}
          >
            {show2 ? "Ocultar" : "Ver"}
          </button>
        </div>

        {/* Error de coincidencia en vivo (suave) */}
        {!matchOK && pwd2.length > 0 && (
          <div className="login-error">Las contraseñas no coinciden.</div>
        )}

        <button type="submit" disabled={submitting || !policyOK || !matchOK}>
          {submitting ? "Guardando…" : "Cambiar contraseña"}
        </button>
      </form>
    </div>
  );
}
