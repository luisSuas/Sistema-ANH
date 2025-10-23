// src/App.js
import React from "react";
import { Routes, Route, Navigate } from "react-router-dom";

import AdminUserCreate from "./Admin/AdminUserCreate";

import { AuthProvider, useAuth } from "./auth/AuthContext";
import ProtectedRoute from "./auth/ProtectedRoute";

import Login from "./Pages/Login";
import ForgotPassword from "./Pages/ForgotPassword";
import ResetPassword from "./Pages/ResetPassword";

/* ========= SOCIAL ========= */
import SocialHomeGate from "./social/SocialHomeGate";
import CasoDetalle from "./social/CasoDetalle";
import VictimasLista from "./social/VictimasLista";
import CasoNuevo from "./social/CasoNuevo";

/* ========= COORDINACIÓN GENERAL ========= */
import GeneralHomeCoordinacion from "./general/GeneralHomeCoordinacion";

/* ========= ALBERGUE ========= */
import AlbergueHomeGate from "./albergue/AlbergueHomeGate";
import CasoDetalleAlbergue from "./albergue/CasoDetalle";
import VictimasListaAlbergue from "./albergue/VictimasLista";
import CasoNuevoAlbergue from "./albergue/CasoNuevo";

/* ========= LEGAL ========= */
import LegalHomeGate from "./legal/LegalHomeGate";
import CasoDetalleLegal from "./legal/CasoDetalle";
import VictimasListaLegal from "./legal/VictimasLista";
import CasoNuevoLegal from "./legal/CasoNuevo";

/* ========= MÉDICA ========= */
import MedicaHomeGate from "./medica/MedicaHomeGate";
import CasoDetalleMedica from "./medica/CasoDetalle";
import VictimasListaMedica from "./medica/VictimasLista";
import CasoNuevoMedica from "./medica/CasoNuevo";

/* ========= PSICOLÓGICA ========= */
import PsicologicaHomeGate from "./psicologica/PsicologicaHomeGate";
import CasoDetallePsicologica from "./psicologica/CasoDetalle";
import VictimasListaPsicologica from "./psicologica/VictimasLista";
import CasoNuevoPsicologica from "./psicologica/CasoNuevo";

/* ========= ADMIN PANEL ========= */
import AdminLayout from "./Admin/AdminLayout";
import AdminHome from "./Admin/AdminHome";
import AdminUserList from "./Admin/AdminUserList";
import AdminUserEdit from "./Admin/AdminUserEdit";

/* ========= utils ========= */
function decodeJwtPayload(t) {
  try { return JSON.parse(atob(t.split(".")[1])); } catch { return null; }
}

function normalizeAreaSlug(s) {
  if (!s) return null;
  const norm = String(s)
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/\b(area|operativa?|coordinacion)\b/g, "")
    .trim();

  const map = { social:"social", albergue:"albergue", legal:"legal", medica:"medica", psicologica:"psicologica" };
  return map[norm] || null;
}

const AREA_PATH_BY_ID = { 2:"/social", 3:"/legal", 4:"/medica", 5:"/albergue", 6:"/psicologica" };
const ADMIN_ROLE = 4;

function getHomeForUser() {
  const t = localStorage.getItem("access_token");
  const p = t ? decodeJwtPayload(t) : null;
  const role = Number(p?.role);

  if (role === ADMIN_ROLE) return "/admin";
  if (role === 1) return "/general";

  const areaSlug = normalizeAreaSlug(p?.area_slug || p?.area_nombre || p?.areaName || p?.area_label);
  if (areaSlug) return `/${areaSlug}`;

  const areaId = p?.area ?? p?.area_id ?? p?.areaId;
  const byId = AREA_PATH_BY_ID[Number(areaId)];
  if (byId) return byId;

  return "/social";
}

function GuestRoute({ children }) {
  const { user, ready } = useAuth();
  if (!ready) return null;
  if (!user) return children;
  return <Navigate to={getHomeForUser()} replace />;
}

function HomeRedirect() {
  const { user, ready } = useAuth();
  if (!ready) return null;
  return <Navigate to={user ? getHomeForUser() : "/login"} replace />;
}

/* === NUEVO: gate de rol para /admin === */
function AdminOnly({ children }) {
  const { user, ready } = useAuth();
  if (!ready) return null;
  if (Number(user?.role) !== ADMIN_ROLE) {
    return <Navigate to={getHomeForUser()} replace />;
  }
  return children;
}

function AppRoutes() {
  return (
    <Routes>
      <Route
        path="/login"
        element={
          <GuestRoute>
            <Login />
          </GuestRoute>
        }
      />

      {/* ADMIN (solo rol 4) */}
      <Route
        path="/admin"
        element={
          <ProtectedRoute>
            <AdminOnly>
              <AdminLayout />
            </AdminOnly>
          </ProtectedRoute>
        }
      >
        <Route index element={<AdminHome />} />
        <Route path="usuarios" element={<AdminUserList />} />
        <Route path="registro" element={<AdminUserCreate />} />
        <Route path="usuarios/:id/editar" element={<AdminUserEdit />} />
      </Route>

      {/* Compat antigua */}
      <Route path="/admin/usuarios/nuevo" element={<Navigate to="/admin/registro" replace />} />

      {/* Recuperación */}
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />

      {/* SOCIAL */}
      <Route path="/social" element={<ProtectedRoute><SocialHomeGate /></ProtectedRoute>} />
      <Route path="/social/casos/nuevo" element={<ProtectedRoute><CasoNuevo /></ProtectedRoute>} />
      <Route path="/social/casos/:id" element={<ProtectedRoute><CasoDetalle /></ProtectedRoute>} />
      <Route path="/social/victimas" element={<ProtectedRoute><VictimasLista /></ProtectedRoute>} />

      {/* GENERAL */}
      <Route path="/general" element={<ProtectedRoute><GeneralHomeCoordinacion /></ProtectedRoute>} />

      {/* ALBERGUE */}
      <Route path="/albergue" element={<ProtectedRoute><AlbergueHomeGate /></ProtectedRoute>} />
      <Route path="/albergue/casos/nuevo" element={<ProtectedRoute><CasoNuevoAlbergue /></ProtectedRoute>} />
      <Route path="/albergue/casos/:id" element={<ProtectedRoute><CasoDetalleAlbergue /></ProtectedRoute>} />
      <Route path="/albergue/victimas" element={<ProtectedRoute><VictimasListaAlbergue /></ProtectedRoute>} />

      {/* LEGAL */}
      <Route path="/legal" element={<ProtectedRoute><LegalHomeGate /></ProtectedRoute>} />
      <Route path="/legal/casos/nuevo" element={<ProtectedRoute><CasoNuevoLegal /></ProtectedRoute>} />
      <Route path="/legal/casos/:id" element={<ProtectedRoute><CasoDetalleLegal /></ProtectedRoute>} />
      <Route path="/legal/victimas" element={<ProtectedRoute><VictimasListaLegal /></ProtectedRoute>} />

      {/* MÉDICA */}
      <Route path="/medica" element={<ProtectedRoute><MedicaHomeGate /></ProtectedRoute>} />
      <Route path="/medica/casos/nuevo" element={<ProtectedRoute><CasoNuevoMedica /></ProtectedRoute>} />
      <Route path="/medica/casos/:id" element={<ProtectedRoute><CasoDetalleMedica /></ProtectedRoute>} />
      <Route path="/medica/victimas" element={<ProtectedRoute><VictimasListaMedica /></ProtectedRoute>} />

      {/* PSICOLÓGICA */}
      <Route path="/psicologica" element={<ProtectedRoute><PsicologicaHomeGate /></ProtectedRoute>} />
      <Route path="/psicologica/casos/nuevo" element={<ProtectedRoute><CasoNuevoPsicologica /></ProtectedRoute>} />
      <Route path="/psicologica/casos/:id" element={<ProtectedRoute><CasoDetallePsicologica /></ProtectedRoute>} />
      <Route path="/psicologica/victimas" element={<ProtectedRoute><VictimasListaPsicologica /></ProtectedRoute>} />

      <Route path="/" element={<HomeRedirect />} />
      <Route path="*" element={<HomeRedirect />} />
    </Routes>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  );
}
