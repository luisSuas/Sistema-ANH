// src/espacioslibres/EspaciosLibresHomeGate.js
import React from 'react';
import EspaciosLibresHomeOperativo from './EspaciosLibresHomeOperativo';
import EspaciosLibresHomeCoordinación from './EspaciosLibresHomeCoordinación';

function getUserFromToken(){
  try{
    const t = localStorage.getItem('access_token');
    if(!t) return null;
    const p = JSON.parse(atob(t.split('.')[1]));
    return { id:p.sub, nombre:p.name, role:Number(p.role), area:Number(p.area) };
  }catch{ return null; }
}

export default function EspaciosLibresHomeGate(){
  const u = getUserFromToken();
  const role = Number(u?.role);
  // 2 = COORD_AREA, 3 = OPERATIVO (según tu mapeo)
  if (role === 2) return <EspaciosLibresHomeCoordinación/>;
  return <EspaciosLibresHomeOperativo/>;
}
