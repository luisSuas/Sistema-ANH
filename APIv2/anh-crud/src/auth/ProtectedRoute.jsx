// src/auth/ProtectedRoute.js
import React from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "./AuthContext";

export default function ProtectedRoute({ children }) {
  const { user, ready } = useAuth();
  if (!ready) return null;                 // espera a que AuthContext cargue
  if (!user) return <Navigate to="/login" replace />;
  return children;
}
