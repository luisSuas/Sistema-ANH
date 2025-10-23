// src/pages/ForgotPassword.js
import React, { useState } from "react";
import { requestPasswordReset } from "../servicios/Servicios";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    setLoading(true);
    try {
      await requestPasswordReset(email.trim());
      setSent(true); // siempre mostramos éxito (no exponemos si existe o no)
    } catch {
      // Igual mostramos éxito para no filtrar existencia
      setSent(true);
    } finally {
      setLoading(false);
    }
  }

  if (sent) {
    return (
      <div className="login-form-container">
        <h2>Revisa tu correo</h2>
        <p>
          Si el correo está registrado, recibirás un enlace para cambiar la contraseña
          (vigente por tiempo limitado).
        </p>
      </div>
    );
  }

  return (
    <div className="login-form-container">
      <h2>Recuperar contraseña</h2>
      <form className="login-form" onSubmit={onSubmit}>
        <label>Correo electrónico</label>
        <input
          type="email"
          value={email}
          onChange={e=>setEmail(e.target.value)}
          placeholder="nombre@dominio.com"
          required
          autoFocus
        />
        <button type="submit" disabled={loading || !email.trim()}>
          {loading ? "Enviando..." : "Enviar enlace"}
        </button>
      </form>
    </div>
  );
}
