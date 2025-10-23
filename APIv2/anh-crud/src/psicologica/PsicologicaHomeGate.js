// src/social/SocialHomeGate.js
import React from 'react';
import PsicologicaHomeOperativo from './PsicologicaHomeOperativo';
import PsicologicaHomeCoordinación from './PsicologicaHomeCoordinación';

function getUserFromToken(){
  try{
    const t = localStorage.getItem('access_token');
    if(!t) return null;
    const p = JSON.parse(atob(t.split('.')[1]));
    return { id:p.sub, nombre:p.name, role:Number(p.role), area:Number(p.area) };
  }catch{ return null; }
}

export default function PsicologicaHomeGate(){
  const u = getUserFromToken();
  const role = Number(u?.role);
  // 2 = COORD_AREA, 3 = OPERATIVO (por lo que has usado)
  if (role === 2) return <PsicologicaHomeCoordinación/>;
  return <PsicologicaHomeOperativo/>;
}
