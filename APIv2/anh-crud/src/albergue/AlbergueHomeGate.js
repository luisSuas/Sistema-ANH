// src/social/AlbergueHomeGate.jsx
import React from 'react';
import AlbergueHomeOperativo from './AlbergueHomeOperativo';
import AlbergueHomeCoordinación from './AlbergueHomeCoordinación';

function getUserFromToken(){
  try{
    const t = localStorage.getItem('access_token');
    if(!t) return null;
    const p = JSON.parse(atob(t.split('.')[1]));
    return { id:p.sub, nombre:p.name, role:Number(p.role), area:Number(p.area) };
  }catch{ return null; }
}

export default function AlbergueHomeGate(){
  const u = getUserFromToken();
  const role = Number(u?.role);
  // 2 = COORD_AREA, 3 = OPERATIVO (por lo que has usado)
  if (role === 2) return <AlbergueHomeCoordinación/>;
  return <AlbergueHomeOperativo/>;
}
