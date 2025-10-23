// src/social/SocialHomeGate.js
import React from 'react';
import LegalHomeOperativo from './LegalHomeOperativo';
import LegalHomeCoordinación from './LegalHomeCoordinación';

function getUserFromToken(){
  try{
    const t = localStorage.getItem('access_token');
    if(!t) return null;
    const p = JSON.parse(atob(t.split('.')[1]));
    return { id:p.sub, nombre:p.name, role:Number(p.role), area:Number(p.area) };
  }catch{ return null; }
}

export default function LegalHomeGate(){
  const u = getUserFromToken();
  const role = Number(u?.role);
  // 2 = COORD_AREA, 3 = OPERATIVO (por lo que has usado)
  if (role === 2) return <LegalHomeCoordinación/>;
  return <LegalHomeOperativo/>;
}
