// Importar dependencias
const express = require('express');
const app = express();
// --- Render / red ---
const PORT = process.env.PORT || 8880; // puerto que inyecta Render (fallback local)
app.set('trust proxy', 1);             // Render está detrás de proxy
require('dotenv').config();
const helmet = require('helmet');
const morgan = require('morgan');
const cors = require('cors');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const ExcelJS = require('exceljs');
const { randomBytes, createHash, randomUUID } = require('node:crypto');
const nodemailer = require('nodemailer');
const rateLimit = require('express-rate-limit'); // rate limit login/reset
const speakeasy = require('speakeasy');          // MFA TOTP
const QRCode = require('qrcode');                // QR para Authenticator
const useSSL = (process.env.PGSSLMODE || '').toLowerCase() === 'require';
const dbOpts = process.env.DATABASE_URL


// TTL de los enlaces de reseteo (15 min por defecto, configurable por env)
const RESET_TOKEN_TTL_MIN = Number(process.env.RESET_TOKEN_TTL_MIN || 15);
const minutesFromNow = (m) => new Date(Date.now() + m * 60 * 1000);


// ======================= Helpers UI para Excel =======================
const monthNameES = (isoDate) => {
  try {
    const d = new Date(isoDate);
    return d.toLocaleDateString('es-GT', { month: 'long' }).replace(/^\w/, c => c.toUpperCase());
  } catch { return 'Mes'; }
};

const BORD = { style:'thin', color:{ argb:'FF000000' } };
const headFill = { type:'pattern', pattern:'solid', fgColor:{ argb:'FFE6E6E6' } }; // gris claro
const totalFill = { type:'pattern', pattern:'solid', fgColor:{ argb:'FFF2F2F2' } };

function setTableBorders(ws, r1, c1, r2, c2) {
  for (let r = r1; r <= r2; r++) {
    for (let c = c1; c <= c2; c++) {
      const cell = ws.getCell(r, c);
      cell.border = {
        top:    (r === r1) ? BORD : undefined,
        bottom: (r === r2) ? BORD : undefined,
        left:   (c === c1) ? BORD : undefined,
        right:  (c === c2) ? BORD : undefined
      };
    }
  }
}

// Normaliza y ordena una lista de {label,total} según un arreglo de orden deseado.
// Agrega etiquetas que no estén en el orden al final.
function normalizeByOrder(list, ORDER) {
  const map = new Map();
  (list || []).forEach(it => {
    const lbl = (it?.label ?? '').trim();
    const tot = Number(it?.total ?? 0);
    if (lbl) map.set(lbl, (map.get(lbl) || 0) + (Number.isFinite(tot) ? tot : 0));
  });
  const rows = [];
  ORDER.forEach(lbl => rows.push([lbl, map.get(lbl) || 0]));
  // extras
  [...map.keys()].forEach(lbl => {
    if (!ORDER.includes(lbl)) rows.push([lbl, map.get(lbl) || 0]);
  });
  return rows;
}

/* 🔸 NUEVO: normalizar etiquetas específicas del “Área de residencia”
   Reglas pedidas: cualquier valor que empiece con “Colonia …” cuenta como “Colonia”.
   (Ej.: “Colonia el Pedregal”, “Colonia la Floresta” => “Colonia”)
*/
function normalizeAreaResidenciaList(list) {
  const acc = new Map();
  (list || []).forEach(it => {
    let lbl = (it?.label ?? '').trim();
    const val = Number(it?.total ?? 0);
    if (!lbl) return;
    const l = lbl.toLowerCase();
    if (l === 'colonia' || l.startsWith('colonia ')) {
      lbl = 'Colonia';
    }
    const prev = acc.get(lbl) || 0;
    acc.set(lbl, prev + (Number.isFinite(val) ? val : 0));
  });
  return [...acc.entries()].map(([label, total]) => ({ label, total }));
}

// Inserta una tabla 2 columnas con “caption”, encabezado con el mes y fila TOTAL.
// rows = Array<[label, value]>. Devuelve última fila escrita.
function putTable2(ws, caption, monthHeader, rows) {
  ws.addRow([]);
  const rCaption = ws.addRow([caption]);
  rCaption.font = { bold:true };
  let startRow = ws.lastRow.number + 1;

  const head = ws.addRow(['', monthHeader]);
  head.font = { bold:true };
  head.fill = headFill;

  // cuerpo
  let sum = 0;
  rows.forEach(([k,v]) => {
    sum += Number(v || 0);
    const rr = ws.addRow([k, v || 0]);
    rr.getCell(1).alignment = { vertical:'middle' };
    rr.getCell(2).alignment = { vertical:'middle', horizontal:'right' };
  });

  // fila TOTAL
  const rTot = ws.addRow(['Total', sum]);
  rTot.font = { bold:true };
  rTot.fill = totalFill;
  rTot.getCell(2).alignment = { horizontal:'right' };

  // bordes
  const endRow = ws.lastRow.number;
  setTableBorders(ws, startRow-1, 1, endRow, 2); // incluye encabezado
  return endRow;
}

// Versión para Procedencia (tiene 3 subtables)
// Versión compatible: acepta proc ya separado o lista plana y arma 3 tablas
function putProcedencia(ws, monthHeader, proc) {
  const { municipios, departamentos, paises } = _procedenciaTo3(proc);

  if (municipios.length) {
    putTable2(ws, '10) Procedencia de las mujeres atendidas', monthHeader,
      municipios.map(x => [x.label, x.total || 0]));
  }
  if (departamentos.length) {
    putTable2(ws, '10) Guatemala', monthHeader,
      departamentos.map(x => [x.label, x.total || 0]));
  }
  if (paises.length) {
    putTable2(ws, '10) País (extranjero)', monthHeader,
      paises.map(x => [x.label, x.total || 0]));
  }
}


// =================== Ordenes / Catálogos de salida ===================
const ORD_SEXO  = ['Femenino','Masculino'];

const ORD_EDAD  = [
  '0 a 5','5 a 10','11 a 15','16 a 20','21 a 25','26 a 30',
  '31 a 35','36 a 40','41 a 45','46 a 50','51 a 55','56 a 60','61 o más'
];

const ORD_HIJOS = ['Mujeres','Hombres','Gestación'];

const ORD_ESTADO_CIVIL = ['Casada','Divorciada','Separada','Soltera','Unida','Viuda'];

const ORD_ESCOLARIDAD = [
  'Sabe leer y escribir','Sin escolaridad','Primaria Incompleta','Primaria Completa',
  'Secundaria Incompleta','Secundaria Completa','Diversificado Incompleto',
  'Diversificado Completo','Universidad Incompleta','Universidad Completa','Otros'
];

const ORD_OCUPACION = [
  // Lista extensa basada en tu foto; agrega/ajusta si aparece alguna nueva
  'Trabajo de casa no remunerado','Comerciante','Trabajo de casa particular','Supervisora','Mesera','Vendedora',
  'Cocinera','Niñera','Tortillera','Bordadora','Tejedora','Inspectora Microbus','Comadrona','Conserje',
  'Agricultora','Auxiliar de tienda','Dependiente de Mostrador','Costurería / modista','Misionera','Estilista',
  'MTS','Taxista','Agente PNC','Pilota','Trabajadora de maquila','Manicurista','Trabajadora de Call Center',
  'Albañil',
  // profesionales (sub-total en tu impreso; aquí sólo orden)
  'Estudiante','Maestra','Perita Contadora','Periodista','Médica','Administradora de Empresas',
  'Secretaria Oficinista','Enfermera','Licenciada','Licencianda en trabajo social','Ingeniera',
  'Asesora de ventas','Psicóloga','Profesional en Maestría','Abogada','Procuradora jurídica',
  'Jubilada','Cajera','Camarera de Hotel'
];

const ORD_ETNIA = ['Maya','Mestiza','Garífuna','Xinca','Otro'];

const DEPARTAMENTOS_GT = [
  'Guatemala','El Progreso','Sacatepéquez','Chimaltenango','Escuintla','Santa Rosa','Sololá',
  'Totonicapán','Quetzaltenango','Suchitepéquez','Retalhuleu','San Marcos','Huehuetenango',
  'Quiché','Baja Verapaz','Alta Verapaz','Petén','Izabal','Zacapa','Chiquimula','Jalapa','Jutiapa'
];

// Convierte cualquier forma de "procedencia" a 3 listas:
// { municipios:[{label,total}], departamentos:[...], paises:[...] }
function _procedenciaTo3(proc) {
  const lowerNA = s => String(s||'')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();

  const depSet = new Set(DEPARTAMENTOS_GT.map(d => lowerNA(d)));
  const depCanon = (s) => {
    const l = lowerNA(s);
    for (const d of DEPARTAMENTOS_GT) if (lowerNA(d) === l) return d;
    return (s||'').toString().trim();
  };
  const isGuatemalanNat = s => /\bguatemal/.test(lowerNA(s));

  const add = (map, label, total) => {
    if (!label) return;
    const v = Number(total||0);
    map.set(label, (map.get(label)||0) + (Number.isFinite(v) ? v : 0));
  };

  const M = new Map(), D = new Map(), P = new Map();

  const arr = x => Array.isArray(x) ? x : [];

  // Caso 1: ya viene { por_municipio, por_departamento, extranjero_por_pais }
  if (proc && (proc.por_municipio || proc.por_departamento || proc.extranjero_por_pais)) {
    arr(proc.por_municipio).forEach(it => add(M, it?.label, it?.total));
    arr(proc.por_departamento).forEach(it => add(D, depCanon(it?.label), it?.total));
    arr(proc.extranjero_por_pais).forEach(it => {
  const raw = (it?.label || '').trim();
  if (!raw || isGuatemalanNat(raw)) return;
  const lbl = normalizaPaisDesdeTexto(raw);     // ← normaliza gentilicios
  add(P, lbl, it?.total);
});

    return {
      municipios:   [...M.entries()].map(([label,total]) => ({ label, total })),
      departamentos:[...D.entries()].map(([label,total]) => ({ label, total })),
      paises:       [...P.entries()].map(([label,total]) => ({ label, total })),
    };
  }

  // Caso 2: lista plana [{label,total}] -> heurística
  (Array.isArray(proc) ? proc : []).forEach(it => {
    const raw = (it?.label ?? it ?? '').toString().trim();
    const tot = Number(it?.total || 0);
    if (!raw) return;

    // "Municipio (Departamento)"
    const m = raw.match(/^(.*?)\s*\((.*?)\)\s*$/);
    if (m) { add(M, `${m[1].trim()} (${depCanon(m[2])})`, tot); return; }

    // ¿es un departamento?
    if (depSet.has(lowerNA(raw))) { add(D, depCanon(raw), tot); return; }

    // ¿parece país? (no Guatemala/Guatemalteca/o)
    if (!isGuatemalanNat(raw) && !depSet.has(lowerNA(raw))) {
      // si no podemos distinguir municipio vs país, por defecto lo tratamos como municipio
      // PERO si contiene palabras típicas de país, lo mandamos a país
      if (/[A-Z]{2,}|mexic|salvad|belg|usa|estados unidos|hondur|nicara|costar|panam|espa|colom|venez|hait|rep.*dom/i.test(raw)) {
  add(P, normalizaPaisDesdeTexto(raw), tot);    // ← normaliza aquí también
} else {
  add(M, raw, tot);
}
      return;
    }

    // fallback: municipio
    add(M, raw, tot);
  });

  return {
    municipios:   [...M.entries()].map(([label,total]) => ({ label, total })),
    departamentos:[...D.entries()].map(([label,total]) => ({ label, total })),
    paises:       [...P.entries()].map(([label,total]) => ({ label, total })),
  };
}


const ORD_NACIONALIDAD = [
  'Guatemalteca','Salvadoreña','Mexicana','Cubana','Belga','Hondureña','Alemana','Nicaragüense','Costarricense',
  'Panameña','Norteamericana','Venezolana','Colombiana','Ecuatoriana','Dominicana','Haitiana','Española',
  'Nicaragua','Honduras','Costa Rica','Panamá','Estados Unidos','Venezuela','Colombia','Ecuador','República Dominicana','Haití'
];

const ORD_REFIEREN = [
  'Juzgado de la Niñez','Juzgado de paz','Juzgado de Familia','Juzgado de femicidios','Otros Juzgados','Oficina del MP',
  'Oficina de Atención a la víctima','Ministerio de trabajo','PNC','PGN','Centro de Salud','DEMI','DMM','CAIMUS','PDH',
  'Defensa Publica Penal','Bufete Popular','CONAPREVI','Hospital','APROFAM','ASCAN','AMUTED',
  // más de tu foto:
  'Bufete de psicología','Renap','GGM','Consul de México','INACIF','Centro educativo','Otras ONG','Ninguna','Amistades','Familiares','Sobreviviente',
  'Grupos de Mujeres','Consejo nacional de adopciones','Medios de comunicación (Televisión, radio, afiches)','Instituto de la Víctima','Embajadas'
];

const ORD_QUIEN_AGREDE = [
  'Esposo','Ex esposo','Compañero','Ex compañero','Novio','Ex novio','Ex conviviente','Conviviente','Suegro',
  'Vecino','Jefe','Amigo','Conocido','Desconocido','Maestro',
  'Padre','Padrastro','Primo','Hermano','Hermana','Hermanastro','Mujer','Hijo','Hija','Sobrino','Cuñado',
  'Tio','Yerno','Nieto','Abuelo','Otro'
];

const ORD_TIPOS_VIOLENCIA = [
  'Física','Psicológica','Verbal','Económica','Sexual','Patrimonial','Violación sexual','Amenaza de muerte','Laboral','Otros'
];

const ORD_MOTIVO_VISITA = [
  'Orientación','Pensión alimenticia','Violencia contra la mujer','Paternidad o Filiación',
  'Extramatrimonial','Violencia intrafamiliar','Atención psicológica','Delito de Violación',
  'Consulta Médica','Reconocimiento de hija/o','Tentativa de femicidio','Femicidio','Divorcio'
];

const ORD_REF_EXTERNA = [
  'Juzgado de familia','Juzgado de paz','Juzgado de femicidio','Ministerio de Trabajo','Ministerio Público',
  'DEMI','Bufete popular','Centro de Salud','PNC','Hospital Nacional'
];

const ORD_REF_INTERNA = ['Área Social','Área Psicológica','Área Médica','Área Legal','Albergue'];

const ORD_AREA_RESIDENCIA = ['Colonia','Barrio Popular','Asentamiento','Zonas','Municipio','Aldea','Caserío','Cantón'];


// 🔸 Helpers de seguridad (colocar una sola vez)
const APP_URL = process.env.APP_URL || 'http://localhost:3000';

// Genera un token seguro. Preferimos UUID v4 (compatible con columnas uuid).
// Si randomUUID no existe, usa 32 bytes en HEX (64 chars).
function randomToken(bytes = 32) {
  if (typeof randomUUID === 'function') {
    return randomUUID();              // p.ej. "3f1e0a4b-2c6f-4e2a-8f6c-01c9b7d1e5a2"
  }
  return randomBytes(bytes).toString('hex'); // p.ej. "a3f9... (64 hex)"
}

function sha256(input) {
  return createHash('sha256').update(String(input), 'utf8').digest('hex');
}

function getClientIp(req) {
  const xf = req.headers['x-forwarded-for'];
  return (Array.isArray(xf) ? xf[0] : (xf || '')).split(',')[0].trim()
         || req.socket?.remoteAddress
         || null;
}


// Configurar conexión a PostgreSQL
const dbConfig = process.env.DATABASE_URL
  ? { connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } }
  : {
      host: process.env.DB_HOST,
      port: Number(process.env.DB_PORT || 5432),
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      ssl: useSSL ? { rejectUnauthorized: false } : false
    };

const pool = new Pool(dbConfig);

    

pool
  .connect()
  .then(async (client) => {
    console.log('✅ Conectado a PostgreSQL');
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS password_reset_tokens (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
          token_hash TEXT NOT NULL,
          expires_at TIMESTAMP WITHOUT TIME ZONE NOT NULL,
          used BOOLEAN NOT NULL DEFAULT FALSE,
          created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW()
        );

        CREATE INDEX IF NOT EXISTS idx_prt_user   ON password_reset_tokens(user_id);
        CREATE INDEX IF NOT EXISTS idx_prt_expires ON password_reset_tokens(expires_at);
        CREATE INDEX IF NOT EXISTS idx_prt_token  ON password_reset_tokens(token_hash);

        -- 🔸 Migraciones suaves: agrega columnas que tu código usa si faltan
        DO $$
        BEGIN
          -- columna token (por compatibilidad)
          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name='password_reset_tokens' AND column_name='token'
          ) THEN
            ALTER TABLE password_reset_tokens ADD COLUMN token TEXT;
          END IF;

          -- requested_ip
          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name='password_reset_tokens' AND column_name='requested_ip'
          ) THEN
            ALTER TABLE password_reset_tokens ADD COLUMN requested_ip TEXT;
          END IF;

          -- user_agent
          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name='password_reset_tokens' AND column_name='user_agent'
          ) THEN
            ALTER TABLE password_reset_tokens ADD COLUMN user_agent TEXT;
          END IF;
        END $$;
      `);
    } catch (e) {
      console.error('⚠️ No se pudo asegurar tabla password_reset_tokens:', e.message);
    } finally {
      client.release();
    }
  })
  .catch(err => console.error('❌ Error conectando a PostgreSQL:', err));

// Middleware
app.use(express.json());
app.use(morgan('common'));

// CORS: localhost y *.onrender.com (configurable por env CORS_ORIGINS)
const CORS_ORIGINS = (process.env.CORS_ORIGINS || 'http://localhost:3000,http://localhost:5173,.onrender.com')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

app.use(cors({
  origin(origin, cb) {
    if (!origin) return cb(null, true); // curl / server-to-server
    const ok = CORS_ORIGINS.some(allow => origin === allow || origin.endsWith(allow));
    return cb(ok ? null : new Error('CORS blocked'), ok);
  },
  credentials: true,
  methods: ['GET','POST','PUT','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization']
}));

app.get('/health', (_req, res) => res.status(200).send('ok'));

app.use(helmet({
  crossOriginResourcePolicy: { policy: 'same-origin' }
}));
if (String(process.env.ENABLE_HSTS || 'false') === 'true') {
  app.use(helmet.hsts({ maxAge: 15552000, includeSubDomains: true, preload: false }));
}

// CSP básica (ajusta si necesitas otros orígenes)
const cspDefault = (process.env.CSP_DEFAULT_SRC || "'self'");
app.use((req, res, next) => {
  res.setHeader('Content-Security-Policy', [
    `default-src ${cspDefault}`,
    `frame-ancestors ${cspDefault}`,
    `base-uri ${cspDefault}`,
    `form-action ${cspDefault}`
  ].join('; '));
  next();
});

// Clave secreta para JWT
const JWT_SECRET = process.env.JWT_SECRET || 'tu_secreto_seguro';

// 🔸 SMTP (Gmail u otro). Si no hay SMTP, se hace fallback a consola.
let mailer = null;
try {
  if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
    mailer = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: String(process.env.SMTP_SECURE || 'false') === 'true',
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
    });
  }
} catch (e) {
  console.error('⚠️ No se pudo inicializar SMTP:', e.message);
}

// ÚNICA función para enviar correos
async function sendResetEmail(toEmail, resetUrl) {
  const {
    SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS, SMTP_FROM
  } = process.env;

  // Si falta config -> mostramos el link y salimos (modo dev)
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
    console.log('[RESET][DEV] Sin SMTP. A:', toEmail, 'URL:', resetUrl);
    return;
  }

  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT || 587),
    secure: String(SMTP_SECURE || 'false') === 'true',
    auth: { user: SMTP_USER, pass: SMTP_PASS }
  });

  try {
    await transporter.verify();
    console.log('✅ [SMTP] Conexión verificada con', SMTP_HOST, 'puerto', SMTP_PORT);
  } catch (e) {
    console.error('❌ [SMTP] verify() falló:', e.message);
    // seguimos e intentamos enviar igual; si falla, se captura abajo
  }

  const from = SMTP_FROM || `"CAIMUS" <${SMTP_USER}>`;

  try {
    const info = await transporter.sendMail({
      from,
      to: toEmail,
      subject: 'Recuperación de contraseña',
      text: `Enlace válido por tiempo limitado:\n\n${resetUrl}\n`,
      html: `<p>Enlace válido por tiempo limitado:</p>
             <p><a href="${resetUrl}">${resetUrl}</a></p>`
    });
    console.log(`📨 [SMTP] Enviado a ${toEmail}. id=${info.messageId}`);
  } catch (err) {
    console.warn('[RESET][MAIL] No se pudo enviar el correo:', err.message);
  }
}



// === ⬇️ Opción 4: limpieza de tokens (PÉGALA AQUÍ) ===
if (!global.__PRT_CLEANUP_SCHEDULED__) {
  global.__PRT_CLEANUP_SCHEDULED__ = true;

  // Limpia vencidos al iniciar
  (async () => {
    try {
      await pool.query(`DELETE FROM password_reset_tokens WHERE expires_at < NOW()`);
    } catch (e) {
      console.warn('[RESET] limpieza inicial falló:', e.message);
    }
  })();

  // Cada 6h limpia usados y expirados de hace 7 días
  setInterval(async () => {
    try {
      await pool.query(`
        DELETE FROM password_reset_tokens
         WHERE used = TRUE
            OR expires_at < NOW() - interval '7 days'
      `);
    } catch (e) {
      console.warn('[RESET] limpieza periódica falló:', e.message);
    }
  }, 6 * 60 * 60 * 1000);
}

// Rate limiters
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  standardHeaders: true,
  legacyHeaders: false,
});
const resetLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
});

// Roles
const ROLES = {
  COORD_GENERAL: 1,
  COORD_AREA: 2,
  OPERATIVO: 3,
};

// Estados válidos de casos
const ESTADOS = {
  BORRADOR: 'borrador',
  PENDIENTE: 'pendiente',     // 🔴
  EN_PROGRESO: 'en_progreso', // 🟡
  VALIDADO: 'validado',
  ENVIADO: 'enviado',
  COMPLETADO: 'completado',   // 🟢
};

// ─────────────────────────────────────────────────────────────────────────────
// Utilidades
// ─────────────────────────────────────────────────────────────────────────────
async function addHistorial(casoId, usuarioId, accion, estadoDesde, estadoHasta, detalle = null) {
  try {
    await pool.query(
      `INSERT INTO casos_historial(caso_id, usuario_id, accion, estado_desde, estado_hasta, detalle)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [casoId, usuarioId, accion, estadoDesde, estadoHasta, detalle]
    );
  } catch (e) {
    console.error('⚠️ No se pudo registrar historial:', e.message);
  }
}

function requireRoles(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'No autorizado' });
    }
    next();
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 🔐 1) Autenticación
// ─────────────────────────────────────────────────────────────────────────────
app.post('/apiv2/auth/login', loginLimiter, async (req, res) => {
  const { username, password, otp } = req.body;
  try {
    const { rows } = await pool.query(
      `SELECT id, password_hash, nombre_completo, role_id, area_id, email,
              failed_login_count, lock_until, mfa_enabled, mfa_secret,
              password_changed_at
         FROM usuarios
        WHERE username = $1
        LIMIT 1`,
      [ username ]
    );
    if (rows.length === 0) return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });

    const user = rows[0];

    // Bloqueo temporal
    if (user.lock_until && new Date(user.lock_until) > new Date()) {
      return res.status(429).json({ error: 'Cuenta bloqueada temporalmente. Intenta más tarde.' });
    }

    const ok = await bcrypt.compare(String(password || ''), user.password_hash);
    if (!ok) {
      const maxFails = Number(process.env.LOGIN_MAX_FAILS || 5);
      const fails = (user.failed_login_count || 0) + 1;
      let lockUntil = null;
      if (fails >= maxFails) {
        const mins = Number(process.env.LOGIN_LOCK_MIN || 15);
        lockUntil = new Date(Date.now() + mins * 60 * 1000);
      }
      await pool.query(
        `UPDATE usuarios
            SET failed_login_count = $1,
                lock_until = $2
          WHERE id = $3`,
        [fails, lockUntil, user.id]
      );
      return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
    }

    // Reset counters
    await pool.query(
      `UPDATE usuarios
          SET failed_login_count = 0,
              lock_until = NULL
        WHERE id = $1`,
      [user.id]
    );

    // MFA para admin si está activo
    if (Number(user.role_id) === 4 && user.mfa_enabled) {
  if (!otp) {
    return res.status(200).json({ code: 'MFA_REQUIRED' }); // 200 o 202
  }
      const valid = speakeasy.totp.verify({
        secret: user.mfa_secret,
        encoding: 'base32',
        token: String(otp),
        window: 1,
      });
      if (!valid) return res.status(401).json({ error: 'Código MFA inválido' });
    }

    const token = jwt.sign(
      {
        sub: user.id,
        name: user.nombre_completo,
        role: user.role_id,
        area: user.area_id,
        pwdv: new Date(user.password_changed_at || Date.now()).getTime(),
      },
      JWT_SECRET,
      { expiresIn: '2h' }
    );
    res.json({ token });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error en el servidor' });
  }
});


// 🔸 NUEVO: Endpoints de recuperación de contraseña
// Siempre responden genérico para no filtrar existencia de email

// 1) Solicitar reset por correo (robusto + logs)
app.post('/apiv2/auth/request-password-reset', resetLimiter, async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  try {
    console.log('[RESET] Solicitud para:', email || '(vacío)');

    // Respuesta genérica siempre (para no filtrar existencia)
    if (!email) return res.status(200).json({ ok: true });

    const u = await pool.query(
      `SELECT id, email FROM usuarios WHERE lower(email) = $1 LIMIT 1`,
      [email]
    );
    const user = u.rows[0];
    console.log('[RESET] Usuario existe?', !!user, 'id:', user?.id || '-');

    // Limpia tokens vencidos (opcional)
    await pool.query(
      `DELETE FROM password_reset_tokens WHERE used = FALSE AND expires_at < NOW()`
    );

    // Si no existe usuario -> respondemos igual
    if (!user) {
      console.log('[RESET] Correo no registrado. Respondemos 200 genérico.');
      return res.status(200).json({ ok: true });
    }

    // Throttle suave (1 solicitud por usuario cada 2 min)
    const throttle = await pool.query(
      `SELECT 1 FROM password_reset_tokens
         WHERE user_id = $1 AND created_at > now() - interval '2 minutes'
         LIMIT 1`,
      [user.id]
    );
    if (throttle.rows[0]) {
      console.log('[RESET] Throttle: ya se solicitó recientemente.');
      return res.status(200).json({ ok: true });
    }

    // Un solo token vigente: elimina los no usados
    await pool.query(
      `DELETE FROM password_reset_tokens WHERE user_id = $1 AND used = FALSE`,
      [user.id]
    );

    // Generar token y metadata
    const token = randomToken(32);                 // claro (hex)
    const tokenHash = sha256(token);               // lo que guardamos
    const expiresAt = minutesFromNow(RESET_TOKEN_TTL_MIN); // 15 min por default
    const ip = getClientIp(req);
    const ua = req.headers['user-agent'] || null;

    // Intento 1: insertar con columna "token" (por si existe en tu esquema)
    // Fallback: si no existe la columna o es UUID y no acepta el hex, insertamos sin "token".
    try {
      await pool.query(
        `INSERT INTO password_reset_tokens(user_id, token, token_hash, expires_at, requested_ip, user_agent)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [user.id, token, tokenHash, expiresAt, ip, ua]
      );
      console.log('[RESET] Token insertado (con columna token).');
    } catch (e) {
      if (e?.code === '42703' || e?.code === '22P02') {
        // 42703: columna no existe | 22P02: tipo inválido (p.ej. token UUID)
        await pool.query(
          `INSERT INTO password_reset_tokens(user_id, token_hash, expires_at, requested_ip, user_agent)
           VALUES ($1,$2,$3,$4,$5)`,
          [user.id, tokenHash, expiresAt, ip, ua]
        );
        console.log('[RESET] Token insertado (sin columna token, fallback).');
      } else {
        throw e;
      }
    }

    const resetUrl = `${APP_URL.replace(/\/+$/, '')}/reset-password?token=${token}`;
    console.log('[RESET] URL generada:', resetUrl);

    try {
      await sendResetEmail(user.email, resetUrl);
    } catch (mailErr) {
      // La función ya loguea, pero no rompemos el flujo
      console.warn('[RESET] Error al enviar correo:', mailErr.message);
    }

    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('request-password-reset:', e.message);
    // Siempre 200 para no dar pistas
    return res.status(200).json({ ok: true });
  }
});


// 2) Validar token (para UX)
app.get('/apiv2/auth/validate-reset-token', async (req, res) => {
  const token = String(req.query?.token || '');
  if (!token || token.length < 10) return res.json({ valid: false });
  try {
    const tokenHash = sha256(token);
    const { rows } = await pool.query(
      `SELECT 1 FROM password_reset_tokens
        WHERE token_hash = $1 AND used = FALSE AND expires_at > NOW()
        LIMIT 1`,
      [tokenHash]
    );
    return res.json({ valid: !!rows[0] });
  } catch (e) {
    console.error('validate-reset-token:', e.message);
    return res.json({ valid: false });
  }
});

// 3) Resetear contraseña
app.post('/apiv2/auth/reset-password', async (req, res) => {
  const token = String(req.body?.token || '');
  const password = String(req.body?.password || '');
  if (!token || token.length < 10) return res.status(400).json({ error: 'Token inválido' });
  if (password.length < 8) return res.status(400).json({ error: 'Contraseña muy corta' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const tokenHash = sha256(token);
    const q = await client.query(
      `SELECT id, user_id FROM password_reset_tokens
        WHERE token_hash = $1 AND used = FALSE AND expires_at > NOW()
        LIMIT 1`,
      [tokenHash]
    );
    if (!q.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Token inválido o vencido' });
    }

    const userId = q.rows[0].user_id;
    const newHash = await bcrypt.hash(password, 10);

   await client.query(
  `UPDATE usuarios
      SET password_hash = $1,
          password_changed_at = NOW()
    WHERE id = $2`,
  [newHash, userId]
);
    await client.query(`UPDATE password_reset_tokens SET used = TRUE WHERE id = $1`, [q.rows[0].id]);

    // TODO (opcional): revocar sesiones/refresh tokens del usuario aquí

    await client.query('COMMIT');
    return res.json({ ok: true });
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch {}
    console.error('reset-password:', e.message);
    return res.status(500).json({ error: 'No se pudo cambiar la contraseña' });
  } finally {
    client.release();
  }
});

async function authMiddleware(req, res, next) {
  const auth = req.headers.authorization?.split(' ');
  if (auth?.[0] !== 'Bearer' || !auth[1]) return res.status(401).json({ error: 'Token no provisto' });
  try {
    const payload = jwt.verify(auth[1], JWT_SECRET);
    // Invalida si la contraseña cambió después de emitir el token
    try {
      const r = await pool.query('SELECT password_changed_at FROM usuarios WHERE id = $1 LIMIT 1', [payload.sub]);
      const changedAt = r.rows[0]?.password_changed_at ? new Date(r.rows[0].password_changed_at).getTime() : 0;
      if (payload.pwdv && payload.pwdv < changedAt) {
        return res.status(401).json({ error: 'Sesión expirada. Vuelve a iniciar sesión.' });
      }
    } catch {}
    req.user = { id: payload.sub, name: payload.name, role: payload.role, area: payload.area };
    next();
  } catch {
    return res.status(401).json({ error: 'Token inválido' });
  }
}

// Whoami (útil para probar login rápido)
app.get('/apiv2/auth/whoami', authMiddleware, (req, res) => {
  res.json(req.user);
});

// MFA: generar secreto y QR (solo admin)
app.post('/apiv2/auth/mfa/setup', authMiddleware, async (req, res) => {
  if (Number(req.user.role) !== 4) return res.status(403).json({ error: 'No autorizado' });
  const secret = speakeasy.generateSecret({ name: `CAIMUS (${req.user.name || 'Admin'})`, length: 20 });
  const otpauth = secret.otpauth_url;
  const qr_svg = await QRCode.toString(otpauth, { type: 'svg' });
  await pool.query(`UPDATE usuarios SET mfa_secret = $1 WHERE id = $2`, [secret.base32, req.user.id]);
  res.json({ base32: secret.base32, otpauth_url: otpauth, qr_svg });
});

// Confirmar y habilitar
app.post('/apiv2/auth/mfa/enable', authMiddleware, async (req, res) => {
  if (Number(req.user.role) !== 4) return res.status(403).json({ error: 'No autorizado' });
  const { otp } = req.body || {};
  const q = await pool.query(`SELECT mfa_secret FROM usuarios WHERE id = $1`, [req.user.id]);
  const secret = q.rows[0]?.mfa_secret;
  if (!secret) return res.status(400).json({ error: 'No hay secreto configurado' });
  const valid = speakeasy.totp.verify({ secret, encoding: 'base32', token: String(otp || ''), window: 1 });
  if (!valid) return res.status(400).json({ error: 'Código inválido' });
  await pool.query(`UPDATE usuarios SET mfa_enabled = TRUE WHERE id = $1`, [req.user.id]);
  res.json({ ok: true });
});

// Deshabilitar
app.post('/apiv2/auth/mfa/disable', authMiddleware, async (req, res) => {
  if (Number(req.user.role) !== 4) return res.status(403).json({ error: 'No autorizado' });
  const { otp } = req.body || {};
  const q = await pool.query(`SELECT mfa_secret FROM usuarios WHERE id = $1`, [req.user.id]);
  const secret = q.rows[0]?.mfa_secret;
  if (!secret) return res.status(400).json({ error: 'No hay MFA activo' });
  const valid = speakeasy.totp.verify({ secret, encoding: 'base32', token: String(otp || ''), window: 1 });
  if (!valid) return res.status(400).json({ error: 'Código inválido' });
  await pool.query(`UPDATE usuarios SET mfa_enabled = FALSE WHERE id = $1`, [req.user.id]);
  res.json({ ok: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// 👩‍💼 2) Administración: crear usuario + enviar enlace de establecimiento de contraseña
//     (versión con todos los campos obligatorios y validaciones)
// ─────────────────────────────────────────────────────────────────────────────

app.post('/apiv2/admin/create-user', authMiddleware, async (req, res) => {
  try {
    // ➤ Solo ADMIN (rol 4) puede crear usuarios
    const allowedRoles = [4];
    if (!allowedRoles.includes(Number(req.user.role))) {
      return res.status(403).json({ error: 'No autorizado' });
    }

    // Normalización de entrada
    const body = req.body || {};
    const username         = String(body.username || '').trim();
    const nombre_completo  = String(body.nombre_completo || '').trim();
    const emailRaw         = String(body.email || '').trim();
    const role_id          = Number(body.role_id);
    const area_id          = Number(body.area_id);
    const password_default = body.password_default ? String(body.password_default) : null;

    // Requeridos
    if (!username || !nombre_completo || !emailRaw || !role_id || !area_id) {
      return res.status(400).json({ error: 'Todos los campos son obligatorios: username, nombre_completo, email, role_id, area_id' });
    }

    // Prohibir asignar rol 4 (Administrador)
    if (role_id === 4) {
      return res.status(400).json({ error: 'No se permite asignar el rol Administrador' });
    }

    // Validaciones básicas
    if (username.length < 3) return res.status(400).json({ error: 'El username debe tener al menos 3 caracteres' });
    const email = emailRaw.toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Email inválido' });
    if (!Number.isInteger(role_id) || role_id <= 0) return res.status(400).json({ error: 'role_id inválido' });
    if (!Number.isInteger(area_id) || area_id <= 0) return res.status(400).json({ error: 'area_id inválido' });

    // Verificar existencia de role y área
    const [roleQ, areaQ] = await Promise.all([
      pool.query('SELECT 1 FROM roles  WHERE id = $1 LIMIT 1', [role_id]),
      pool.query('SELECT 1 FROM areas  WHERE id = $1 LIMIT 1', [area_id]),
    ]);
    if (!roleQ.rows[0]) return res.status(400).json({ error: 'role_id no existe' });
    if (!areaQ.rows[0]) return res.status(400).json({ error: 'area_id no existe' });

    // Unicidad username/email
    const existsQ = await pool.query(
      `SELECT 
         (SELECT 1 FROM usuarios WHERE username = $1 LIMIT 1) AS u,
         (SELECT 1 FROM usuarios WHERE lower(email) = $2 LIMIT 1) AS e`,
      [username, email]
    );
    const exists = existsQ.rows?.[0];
    if (exists?.u) return res.status(400).json({ error: 'El username ya existe' });
    if (exists?.e) return res.status(400).json({ error: 'El email ya existe' });

    // Contraseña temporal
    function generateTempPassword(len = 10) {
      const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
      let out = '';
      for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
      return out;
    }
    const tempPass = password_default || generateTempPassword(10);
    const passwordHash = await bcrypt.hash(String(tempPass), 10);

    // Insertar usuario
    const insertQ = `
      INSERT INTO usuarios (username, email, password_hash, nombre_completo, area_id, role_id)
      VALUES ($1,$2,$3,$4,$5,$6)
      RETURNING id, email
    `;
    const { rows } = await pool.query(insertQ, [
      username, email, passwordHash, nombre_completo, area_id, role_id
    ]);
    const created = rows[0];

    // Borrar tokens previos no usados (robusto a esquemas sin columna 'used')
    try {
      await pool.query(`DELETE FROM password_reset_tokens WHERE user_id = $1 AND used = FALSE`, [created.id]);
    } catch (e) {
      if (e?.code === '42703') {
        // No existe la columna 'used' → borrar todos los tokens del usuario
        await pool.query(`DELETE FROM password_reset_tokens WHERE user_id = $1`, [created.id]);
      } else {
        throw e;
      }
    }

    // Generar token nuevo
    const token = randomToken(32);
    const tokenHash = sha256(token);
   const expiresAt = minutesFromNow(RESET_TOKEN_TTL_MIN); // 15 minutos
    const ip = getClientIp(req);
    const ua = req.headers['user-agent'] || null;

   // ⬇️ Intento 1: insertar con columna token; fallback si el esquema no la tiene o si el tipo no coincide
try {
  await pool.query(
    `INSERT INTO password_reset_tokens(user_id, token, token_hash, expires_at, requested_ip, user_agent)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [created.id, token, tokenHash, expiresAt, ip, ua]
  );
} catch (e) {
  if (e?.code === '42703' || e?.code === '22P02') {
    await pool.query(
      `INSERT INTO password_reset_tokens(user_id, token_hash, expires_at, requested_ip, user_agent)
       VALUES ($1,$2,$3,$4,$5)`,
      [created.id, tokenHash, expiresAt, ip, ua]
    );
  } else {
    throw e;
  }
}


    // Enlace para establecer contraseña
    const resetUrl = `${APP_URL.replace(/\/+$/,'')}/reset-password?token=${token}`;
    try {
      await sendResetEmail(created.email, resetUrl);
    } catch (err) {
      console.warn('[ADMIN][MAIL] No se pudo enviar el correo:', err.message);
      // No abortamos
    }

    return res.json({
      ok: true,
      message: 'Usuario creado. Se envió un enlace para establecer contraseña (si el SMTP está configurado).'
    });
  } catch (e) {
    console.error('admin.create-user:', e);
    if (e?.code === '23505') { // unique_violation
      return res.status(400).json({ error: 'Usuario o correo ya existe' });
    }
    return res.status(500).json({ error: 'Error al crear usuario' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 👤 ADMIN (rol 4): listar / ver / actualizar / eliminar usuarios
//     * Mantiene separado el panel de admin de los endpoints legacy.
// ─────────────────────────────────────────────────────────────────────────────

function requireAdmin(req, res) {
  if (Number(req.user?.role) !== 4) {
    res.status(403).json({ error: 'No autorizado' });
    return false;
  }
  return true;
}

// GET /apiv2/admin/users?q=texto  → lista (id, username) máx. 200
app.get('/apiv2/admin/users', authMiddleware, async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const q = String(req.query?.q || '').trim().toLowerCase();
  try {
    let rows;
    if (q) {
      const { rows: r } = await pool.query(
        `SELECT id, username
           FROM usuarios
          WHERE lower(username) LIKE '%' || $1 || '%'
          ORDER BY id DESC
          LIMIT 200`,
        [q]
      );
      rows = r;
    } else {
      const { rows: r } = await pool.query(
        `SELECT id, username
           FROM usuarios
          ORDER BY id DESC
          LIMIT 200`
      );
      rows = r;
    }
    res.json(rows);
  } catch (e) {
    console.error('admin.users.list:', e);
    res.status(500).json({ error: 'No se pudo obtener la lista' });
  }
});

// GET /apiv2/admin/users/:id  → detalle para edición
app.get('/apiv2/admin/users/:id', authMiddleware, async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'id inválido' });
  try {
    const { rows } = await pool.query(
      `SELECT id, username, email, nombre_completo, role_id, area_id
         FROM usuarios
        WHERE id = $1
        LIMIT 1`,
      [id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'No encontrado' });
    res.json(rows[0]);
  } catch (e) {
    console.error('admin.users.get:', e);
    res.status(500).json({ error: 'Error al obtener' });
  }
});

// PUT /apiv2/admin/users/:id  → actualizar (prohíbe asignar rol 4)
app.put('/apiv2/admin/users/:id', authMiddleware, async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'id inválido' });

  const body = req.body || {};
  const email           = String(body.email || '').trim().toLowerCase();
  const nombre_completo = String(body.nombre_completo || '').trim();
  const role_id         = Number(body.role_id);
  const area_id         = Number(body.area_id);

  if (!email || !nombre_completo || !role_id || !area_id)
    return res.status(400).json({ error: 'Faltan campos requeridos' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return res.status(400).json({ error: 'Email inválido' });
  if (role_id === 4)
    return res.status(400).json({ error: 'No se permite asignar el rol Administrador' });

  try {
    // email único (si cambió)
    const { rows: ex } = await pool.query(
      `SELECT 1 FROM usuarios WHERE lower(email) = $1 AND id <> $2 LIMIT 1`,
      [email, id]
    );
    if (ex[0]) return res.status(400).json({ error: 'El email ya existe' });

    await pool.query(
      `UPDATE usuarios
          SET email = $1,
              nombre_completo = $2,
              role_id = $3,
              area_id = $4
        WHERE id = $5`,
      [email, nombre_completo, role_id, area_id, id]
    );
    res.json({ ok: true });
  } catch (e) {
    console.error('admin.users.update:', e);
    res.status(500).json({ error: 'No se pudo actualizar' });
  }
});

// DELETE /apiv2/admin/users/:id  → eliminar (bloquea auto-borrado y admins)
app.delete('/apiv2/admin/users/:id', authMiddleware, async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'id inválido' });

  try {
    const { rows } = await pool.query(
      `SELECT id, role_id FROM usuarios WHERE id = $1 LIMIT 1`,
      [id]
    );
    const u = rows[0];
    if (!u) return res.status(404).json({ error: 'No encontrado' });
    if (u.id === Number(req.user.id)) return res.status(400).json({ error: 'No puedes eliminarte a ti mismo' });
    if (u.role_id === 4)             return res.status(400).json({ error: 'No se puede eliminar un Administrador' });

    await pool.query(`DELETE FROM usuarios WHERE id = $1`, [id]);
    res.json({ ok: true });
  } catch (e) {
    console.error('admin.users.delete:', e);
    res.status(500).json({ error: 'No se pudo eliminar' });
  }
});


// ─────────────────────────────────────────────────────────────────────────────
// 📚 2) Catálogos (sin auth)
// ─────────────────────────────────────────────────────────────────────────────
const catalogos = {
  areas:             'SELECT * FROM areas ORDER BY id',
  roles:             'SELECT * FROM roles ORDER BY id',
  'estados-civiles': 'SELECT * FROM estados_civiles ORDER BY id',
  etnias:            'SELECT * FROM etnias ORDER BY id',
  escolaridades:     'SELECT * FROM escolaridades ORDER BY id',
  'tipos-violencia': 'SELECT * FROM tipos_violencia ORDER BY id',
  'medios-agresion': 'SELECT * FROM medios_agresion ORDER BY id',
  'relaciones-agresor': 'SELECT * FROM relaciones_agresor ORDER BY id',
  'situaciones-riesgo': 'SELECT * FROM situaciones_riesgo ORDER BY id',
  'fuentes-referencia': 'SELECT * FROM fuentes_referencia ORDER BY id',
  'destinos-ref-interna': 'SELECT * FROM destinos_referencia_interna ORDER BY id',
  'destinos-ref-externa': 'SELECT * FROM destinos_referencia_externa ORDER BY id',
  departamentos:     'SELECT * FROM departamentos ORDER BY id',
  municipios:        'SELECT id, departamento_id, nombre FROM municipios ORDER BY departamento_id, nombre',
};
app.get('/apiv2/catalogos/:cat', async (req, res) => {
  const sql = catalogos[req.params.cat];
  if (!sql) return res.status(404).json({ error: 'Catálogo no encontrado' });
  try {
    const { rows } = await pool.query(sql);
    res.json(rows);
  } catch (err) {
    console.error(err); res.status(500).json({ error: 'Error en el servidor' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 🔁 Compatibilidad con rutas legacy usadas por el front actual
//     Front llama a /apiv2/usuarios, así que exponemos las mismas operaciones
//     SOLO para rol 4 (Administrador) y devolviendo role/area por nombre.
// ─────────────────────────────────────────────────────────────────────────────

// GET /apiv2/usuarios → lista con role_nombre y area_nombre
app.get('/apiv2/usuarios', authMiddleware, async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const { rows } = await pool.query(
      `SELECT 
         u.id, u.username, u.nombre_completo, u.email,
         u.role_id, u.area_id,
         r.nombre AS role_nombre,
         a.nombre AS area_nombre
       FROM usuarios u
       LEFT JOIN roles  r ON r.id = u.role_id
       LEFT JOIN areas  a ON a.id = u.area_id
       ORDER BY u.id ASC`
    );
    res.json(rows);
  } catch (e) {
    console.error('legacy/usuarios.list:', e);
    res.status(500).json({ error: 'No se pudo obtener la lista' });
  }
});

// GET /apiv2/usuarios/:id → detalle con role/area nombre
app.get('/apiv2/usuarios/:id', authMiddleware, async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'id inválido' });
  try {
    const { rows } = await pool.query(
      `SELECT 
         u.id, u.username, u.nombre_completo, u.email,
         u.role_id, u.area_id,
         r.nombre AS role_nombre,
         a.nombre AS area_nombre
       FROM usuarios u
       LEFT JOIN roles  r ON r.id = u.role_id
       LEFT JOIN areas  a ON a.id = u.area_id
       WHERE u.id = $1
       LIMIT 1`,
      [id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'No encontrado' });
    res.json(rows[0]);
  } catch (e) {
    console.error('legacy/usuarios.get:', e);
    res.status(500).json({ error: 'Error al obtener el usuario' });
  }
});

// PUT /apiv2/usuarios/:id → actualizar (sin permitir asignar rol 4)
app.put('/apiv2/usuarios/:id', authMiddleware, async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'id inválido' });

  try {
    const body = req.body || {};
    const nombre_completo = String(body.nombre_completo || '').trim();
    const emailRaw        = String(body.email || '').trim();
    const role_id         = Number(body.role_id);
    const area_id         = Number(body.area_id);

    if (!nombre_completo || !emailRaw || !role_id || !area_id) {
      return res.status(400).json({ error: 'nombre_completo, email, role_id y area_id son obligatorios' });
    }
    const email = emailRaw.toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Email inválido' });
    }
    if (role_id === 4) return res.status(400).json({ error: 'No se permite asignar el rol Administrador' });

    // verificar existencia de rol/área
    const [rQ, aQ] = await Promise.all([
      pool.query('SELECT 1 FROM roles  WHERE id = $1 LIMIT 1', [role_id]),
      pool.query('SELECT 1 FROM areas  WHERE id = $1 LIMIT 1', [area_id]),
    ]);
    if (!rQ.rows[0]) return res.status(400).json({ error: 'role_id no existe' });
    if (!aQ.rows[0]) return res.status(400).json({ error: 'area_id no existe' });

    // email único (excluye el propio id)
    const ex = await pool.query(
      'SELECT 1 FROM usuarios WHERE lower(email) = $1 AND id <> $2 LIMIT 1',
      [email, id]
    );
    if (ex.rows[0]) return res.status(400).json({ error: 'El email ya existe' });

    await pool.query(
      `UPDATE usuarios
          SET nombre_completo = $1,
              email           = $2,
              role_id         = $3,
              area_id         = $4
        WHERE id = $5`,
      [nombre_completo, email, role_id, area_id, id]
    );

    res.json({ ok: true });
  } catch (e) {
    console.error('legacy/usuarios.update:', e);
    if (e?.code === '23505') return res.status(400).json({ error: 'El email ya existe' });
    res.status(500).json({ error: 'No se pudo actualizar el usuario' });
  }
});

// DELETE /apiv2/usuarios/:id → eliminar (bloquea auto-borrado y admins)
app.delete('/apiv2/usuarios/:id', authMiddleware, async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'id inválido' });

  try {
    const { rows } = await pool.query(
      'SELECT id, role_id FROM usuarios WHERE id = $1 LIMIT 1',
      [id]
    );
    const u = rows[0];
    if (!u) return res.status(404).json({ error: 'No encontrado' });

    // evitar borrarse a sí mismo (JWT suele tener sub como id)
    const meId = Number(req.user?.sub ?? req.user?.id);
    if (u.id === meId) return res.status(400).json({ error: 'No puedes eliminar tu propia cuenta' });

    // no eliminar Administradores
    if (Number(u.role_id) === 4) return res.status(400).json({ error: 'No se puede eliminar un Administrador' });

    await pool.query('DELETE FROM usuarios WHERE id = $1', [id]);
    res.json({ ok: true });
  } catch (e) {
    console.error('legacy/usuarios.delete:', e);
    res.status(500).json({ error: 'No se pudo eliminar el usuario' });
  }
});


// ─────────────────────────────────────────────────────────────────────────────
// 👤 3) Usuarios (CRUD) – PROTECTED (solo CG aquí)
//     Nota: Para gestión por área usa /apiv2/personal (abajo)
// ─────────────────────────────────────────────────────────────────────────────
app.get  ('/apiv2/usuarios', authMiddleware, requireRoles(ROLES.COORD_GENERAL), async (req, res) => {
  const { rows } = await pool.query('SELECT id, username, email, nombre_completo, area_id, role_id, created_at FROM usuarios');
  res.json(rows);
});
app.get  ('/apiv2/usuarios/:id', authMiddleware, requireRoles(ROLES.COORD_GENERAL), async (req, res) => {
  const { id } = req.params;
  const { rows } = await pool.query('SELECT id, username, email, nombre_completo, area_id, role_id, created_at FROM usuarios WHERE id = $1', [id]);
  if (!rows[0]) return res.status(404).json({ error: 'Usuario no encontrado' });
  res.json(rows[0]);
});
app.post ('/apiv2/usuarios', authMiddleware, requireRoles(ROLES.COORD_GENERAL), async (req, res) => {
  const { username, email, password, nombre_completo, area_id, role_id } = req.body;
  const password_hash = await bcrypt.hash(password, 10);
  const { rows } = await pool.query(
    `INSERT INTO usuarios(username,email,password_hash,nombre_completo,area_id,role_id)
     VALUES($1,$2,$3,$4,$5,$6) RETURNING id`,
    [username, email || null, password_hash, nombre_completo, area_id, role_id]
  );
  res.status(201).json({ id: rows[0].id });
});
app.put  ('/apiv2/usuarios/:id', authMiddleware, requireRoles(ROLES.COORD_GENERAL), async (req, res) => {
  const { id } = req.params;
  const body = { ...req.body };

  // Soporte para cambiar contraseña enviando "password"
  if (body.password) {
    body.password_hash = await bcrypt.hash(body.password, 10);
    delete body.password;
  }

  const fields = Object.keys(body);
  const values = Object.values(body);
  if (!fields.length) return res.json({ message: 'Sin cambios' });
  const setClause = fields.map((f, i) => `${f} = $${i+1}`).join(', ');
  const { rowCount } = await pool.query(
    `UPDATE usuarios SET ${setClause} WHERE id = $${fields.length+1}`,
    [...values, id]
  );
  if (rowCount === 0) return res.status(404).json({ error: 'Usuario no encontrado' });
  res.json({ message: 'Usuario actualizado' });
});
app.delete('/apiv2/usuarios/:id', authMiddleware, requireRoles(ROLES.COORD_GENERAL), async (req, res) => {
  const { id } = req.params;
  const { rowCount } = await pool.query('DELETE FROM usuarios WHERE id = $1', [id]);
  if (rowCount === 0) return res.status(404).json({ error: 'Usuario no encontrado' });
  res.json({ message: 'Usuario eliminado' });
});

// ─────────────────────────────────────────────────────────────────────────────
// 👥 3.1 Personal Operativo / Coordinación Administrativa (Área) – PROTECTED
// ─────────────────────────────────────────────────────────────────────────────
app.get('/apiv2/personal', authMiddleware, async (req, res) => {
  const { role, area, id: userId } = req.user;
  try {
    if (role === ROLES.COORD_GENERAL) {
      const { rows } = await pool.query(
        `SELECT id, username, email, nombre_completo, area_id, role_id, created_at
         FROM usuarios
         WHERE role_id IN ($1,$2)
         ORDER BY area_id, role_id, nombre_completo`,
        [ROLES.COORD_AREA, ROLES.OPERATIVO]
      );
      return res.json(rows);
    }
    if (role === ROLES.COORD_AREA) {
      const { rows } = await pool.query(
        `SELECT id, username, email, nombre_completo, area_id, role_id, created_at
         FROM usuarios
         WHERE area_id = $1 AND role_id IN ($2,$3)
         ORDER BY role_id, nombre_completo`,
        [area, ROLES.COORD_AREA, ROLES.OPERATIVO]
      );
      return res.json(rows);
    }
    const { rows } = await pool.query(
      `SELECT id, username, email, nombre_completo, area_id, role_id, created_at
       FROM usuarios WHERE id = $1`,
      [userId]
    );
    res.json(rows);
  } catch (err) {
    console.error(err); res.status(500).json({ error: 'Error en el servidor' });
  }
});

app.get('/apiv2/personal/:id', authMiddleware, async (req, res) => {
  const { role, area, id: userId } = req.user;
  const { id } = req.params;
  try {
    const { rows } = await pool.query(
      `SELECT id, username, email, nombre_completo, area_id, role_id, created_at
       FROM usuarios WHERE id = $1`,
      [id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Usuario no encontrado' });
    const u = rows[0];
    const sameArea = u.area_id === area;
    const self = Number(id) === Number(userId);
    if (role === ROLES.COORD_GENERAL || (role === ROLES.COORD_AREA && sameArea) || (role === ROLES.OPERATIVO && self)) {
      return res.json(u);
    }
    res.status(403).json({ error: 'No autorizado' });
  } catch (err) {
    console.error(err); res.status(500).json({ error: 'Error en el servidor' });
  }
});

app.post('/apiv2/personal', authMiddleware, async (req, res) => {
  const { role, area } = req.user;
  if (role !== ROLES.COORD_AREA && role !== ROLES.COORD_GENERAL) {
    return res.status(403).json({ error: 'No autorizado' });
  }
  const { username, email, password, nombre_completo, role_id } = req.body;
  if (!username || !password || !nombre_completo) {
    return res.status(400).json({ error: 'username, password y nombre_completo son obligatorios' });
  }
  const newRole = [ROLES.COORD_AREA, ROLES.OPERATIVO].includes(Number(role_id)) ? Number(role_id) : ROLES.OPERATIVO;
  const targetArea = role === ROLES.COORD_GENERAL ? (req.body.area_id ?? area) : area;

  try {
    const password_hash = await bcrypt.hash(password, 10);
    const { rows } = await pool.query(
      `INSERT INTO usuarios(username,email,password_hash,nombre_completo,area_id,role_id)
       VALUES($1,$2,$3,$4,$5,$6) RETURNING id`,
      [username, email || null, password_hash, nombre_completo, targetArea, newRole]
    );
    res.status(201).json({ id: rows[0].id });
  } catch (err) {
    console.error(err); res.status(500).json({ error: 'Error al crear personal' });
  }
});

app.put('/apiv2/personal/:id', authMiddleware, async (req, res) => {
  const { role, area } = req.user;
  if (role !== ROLES.COORD_AREA && role !== ROLES.COORD_GENERAL) {
    return res.status(403).json({ error: 'No autorizado' });
  }
  const { id } = req.params;
  const { nombre_completo, email, password, role_id, area_id } = req.body;

  try {
    const chk = await pool.query('SELECT area_id FROM usuarios WHERE id = $1', [id]);
    if (!chk.rows[0]) return res.status(404).json({ error: 'Usuario no encontrado' });
    const sameArea = chk.rows[0].area_id === area;

    if (role === ROLES.COORD_AREA && !sameArea) return res.status(403).json({ error: 'No autorizado' });

    const fields = [];
    const values = [];
    let idx = 1;

    if (nombre_completo !== undefined) { fields.push(`nombre_completo = $${idx++}`); values.push(nombre_completo); }
    if (email !== undefined)           { fields.push(`email = $${idx++}`);           values.push(email || null); }
    if (password) {
      const hash = await bcrypt.hash(password, 10);
      fields.push(`password_hash = $${idx++}`); values.push(hash);
    }
    if (role_id !== undefined && [ROLES.COORD_AREA, ROLES.OPERATIVO].includes(Number(role_id))) {
      fields.push(`role_id = $${idx++}`); values.push(Number(role_id));
    }
    if (role === ROLES.COORD_GENERAL && area_id !== undefined) {
      fields.push(`area_id = $${idx++}`); values.push(Number(area_id));
    }

    if (!fields.length) return res.json({ message: 'Sin cambios' });

    values.push(id);
    const sql = `UPDATE usuarios SET ${fields.join(', ')} WHERE id = $${idx}`;
    const { rowCount } = await pool.query(sql, values);
    if (rowCount === 0) return res.status(404).json({ error: 'Usuario no encontrado' });
    res.json({ message: 'Personal actualizado' });
  } catch (err) {
    console.error(err); res.status(500).json({ error: 'Error al actualizar personal' });
  }
});

app.delete('/apiv2/personal/:id', authMiddleware, async (req, res) => {
  const { role, area } = req.user;
  if (role !== ROLES.COORD_AREA && role !== ROLES.COORD_GENERAL) {
    return res.status(403).json({ error: 'No autorizado' });
  }
  const { id } = req.params;
  try {
    const chk = await pool.query('SELECT area_id FROM usuarios WHERE id = $1', [id]);
    if (!chk.rows[0]) return res.status(404).json({ error: 'Usuario no encontrado' });
    const sameArea = chk.rows[0].area_id === area;
    if (role === ROLES.COORD_AREA && !sameArea) return res.status(403).json({ error: 'No autorizado' });

    const { rowCount } = await pool.query('DELETE FROM usuarios WHERE id = $1', [id]);
    if (rowCount === 0) return res.status(404).json({ error: 'Usuario no encontrado' });
    res.json({ message: 'Usuario eliminado' });
  } catch (err) {
    console.error(err); res.status(500).json({ error: 'Error al eliminar personal' });
  }
});

// ── Helpers de columnas y nombres ─────────────────────────────
const tableColsCache = new Map();
async function getTableCols(table) {
  if (tableColsCache.has(table)) return tableColsCache.get(table);
  const { rows } = await pool.query(
    `SELECT column_name
       FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1`,
    [table]
  );
  const set = new Set(rows.map(r => String(r.column_name).toLowerCase()));
  tableColsCache.set(table, set);
  return set;
}

function splitNombreApellidos(nombres = '', apellidos = '') {
  const ns = String(nombres).trim().split(/\s+/).filter(Boolean);
  const as = String(apellidos).trim().split(/\s+/).filter(Boolean);
  return {
    pn: ns[0] || null,
    sn: ns.slice(1).join(' ') || null,
    pa: as[0] || null,
    sa: as.slice(1).join(' ') || null,
    full: [nombres, apellidos].filter(Boolean).join(' ') || null,
  };
}

function emptyToNull(v) {
  const s = String(v ?? '').trim();
  return s ? s : null;
}

const toInt = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const putIf = (cols, obj, key, val) => {
  if (val === undefined) return;
  if (cols.has(String(key).toLowerCase())) obj[key] = emptyToNull(val);
};

// ── Normalización simple para cache de resoluciones ───────────
const normKey = (s) =>
  String(s || '')
    .toLowerCase()
    .normalize('NFD')                // separa acentos
    .replace(/[\u0300-\u036f]/g, '') // quita acentos
    .replace(/[^\w\s]/g, ' ')        // quita puntuación
    .replace(/\s+/g, ' ')
    .trim();

// Cache en memoria para evitar hits repetidos al resolver
const muniResolveCache = new Map(); // key normalizada -> id (o null)

/**
 * Intenta resolver un municipio cuando llega como texto:
 *  - "Quetzaltenango"
 *  - "San Juan, Quetzaltenango"
 *  - "Quetzaltenango / San Juan Ostuncalco"
 *  - "Quetzaltenango San Juan Ostuncalco"
 *  - también acepta el ID como string ("112")
 */
async function resolveMunicipioIdByText(txt) {
  if (!txt) return null;
  const raw = String(txt).trim();
  if (/^\d+$/.test(raw)) return Number(raw); // ya es ID

  const key = normKey(raw);
  if (!key) return null;

  // respuesta cacheada
  if (muniResolveCache.has(key)) return muniResolveCache.get(key);

  // Si el usuario pasó "muni, depto" o "depto/muni" probamos por partes
  const parts = key.split(/[,\-\/]+/).map(p => p.trim()).filter(Boolean);
  let id = null;

  if (parts.length >= 2) {
    const [a, b] = parts;

    // a ~ municipio, b ~ departamento
    const q1 = await pool.query(`
      SELECT m.id
      FROM municipios m
      JOIN departamentos d ON d.id = m.departamento_id
      WHERE translate(lower(m.nombre),'áéíóúü','aeiouu') LIKE '%' || $1 || '%'
        AND translate(lower(d.nombre),'áéíóúü','aeiouu') LIKE '%' || $2 || '%'
      ORDER BY length(m.nombre) ASC
      LIMIT 1
    `, [a, b]);
    id = q1.rows?.[0]?.id ?? null;

    // a ~ departamento, b ~ municipio (orden inverso)
    if (!id) {
      const q2 = await pool.query(`
        SELECT m.id
        FROM municipios m
        JOIN departamentos d ON d.id = m.departamento_id
        WHERE translate(lower(d.nombre),'áéíóúü','aeiouu') LIKE '%' || $1 || '%'
          AND translate(lower(m.nombre),'áéíóúü','aeiouu') LIKE '%' || $2 || '%'
        ORDER BY length(m.nombre) ASC
        LIMIT 1
      `, [a, b]);
      id = q2.rows?.[0]?.id ?? null;
    }
  }

  // Fallback: búsqueda por igualdad/contiene (tildes-insensible)
  if (!id) {
    const q = await pool.query(`
      WITH needle AS (
        SELECT translate(lower($1),'áéíóúü','aeiouu') AS n
      )
      SELECT m.id
      FROM municipios m
      JOIN departamentos d ON d.id = m.departamento_id, needle
      WHERE
        -- Igual exacto al nombre del municipio
        translate(lower(m.nombre),'áéíóúü','aeiouu') = needle.n
        -- "Muni, Depto" o "Muni Depto"
        OR translate(lower(m.nombre || ', ' || d.nombre),'áéíóúü','aeiouu') = needle.n
        OR translate(lower(m.nombre || ' '  || d.nombre),'áéíóúü','aeiouu') = needle.n
        -- "Depto Muni"
        OR translate(lower(d.nombre || ' '  || m.nombre),'áéíóúü','aeiouu') = needle.n
        -- Contenga (último recurso)
        OR translate(lower(m.nombre),'áéíóúü','aeiouu') LIKE '%' || needle.n || '%'
      ORDER BY
        -- prioriza coincidencia exacta del municipio
        (translate(lower(m.nombre),'áéíóúü','aeiouu') = needle.n) DESC,
        -- luego "muni + depto" exacto
        (translate(lower(m.nombre || ', ' || d.nombre),'áéíóúü','aeiouu') = needle.n) DESC,
        length(m.nombre) ASC
      LIMIT 1
    `, [raw]); // pasamos el texto tal cual; el CTE lo normaliza
    id = q.rows?.[0]?.id ?? null;
  }

  muniResolveCache.set(key, id ?? null);
  return id ?? null;
}

/**
 * Asegura que lo que llegue (ID o texto) termine siendo un ID numérico.
 * Devuelve null si no se pudo resolver.
 */
async function ensureMunicipioId(idOrText) {
  const n = toInt(idOrText);
  if (n != null) return n;
  return await resolveMunicipioIdByText(idOrText);
}

module.exports = {
  getTableCols,
  splitNombreApellidos,
  emptyToNull,
  toInt,
  putIf,
  resolveMunicipioIdByText,
  ensureMunicipioId,
};

// === Helpers lugar de origen (definir una sola vez, en scope global) ===
function _lower_noacc(s='') {
  return String(s)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function looksLikeGuatemalaPlace(txt='') {
  const s = _lower_noacc(String(txt).trim());
  if (!s) return false;
  if (s.includes('guatemala')) return true;
  for (const d of DEPARTAMENTOS_GT) {
    const dn = _lower_noacc(d);
    if (s === dn || s.includes(dn)) return true;
  }
  return false;
}

function normalizaPaisDesdeTexto(txt='') {
  const s = _lower_noacc(String(txt).trim());
  const map = new Map([
    // países
    ['espana','España'], ['spain','España'],
    ['mexico','México'],
    ['el salvador','El Salvador'], ['salvador','El Salvador'],
    ['estados unidos','Estados Unidos'], ['eeuu','Estados Unidos'], ['usa','Estados Unidos'],
    ['honduras','Honduras'], ['nicaragua','Nicaragua'],
    ['costa rica','Costa Rica'], ['panama','Panamá'],
    ['venezuela','Venezuela'], ['colombia','Colombia'], ['ecuador','Ecuador'],
    ['republica dominicana','República Dominicana'], ['dominicana','República Dominicana'],
    ['haiti','Haití'], ['alemania','Alemania'], ['belgica','Bélgica'], ['cuba','Cuba'],
    // gentilicios
    ['espanola','España'], ['espanol','España'],
    ['mexicana','México'], ['mexicano','México'],
    ['estadounidense','Estados Unidos'],
    ['salvadorena','El Salvador'], ['salvadoreno','El Salvador'],
    ['hondurena','Honduras'], ['hondureno','Honduras'],
    ['nicaraguense','Nicaragua'],
    ['costarricense','Costa Rica'],
    ['panamena','Panamá'], ['panameno','Panamá'],
    ['colombiana','Colombia'], ['colombiano','Colombia'],
    ['venezolana','Venezuela'], ['venezolano','Venezuela'],
    ['ecuatoriana','Ecuador'], ['ecuatoriano','Ecuador'],
    ['haitiana','Haití'], ['haitiano','Haití'],
    ['alemana','Alemania'], ['aleman','Alemania'],
    ['belga','Bélgica'], ['cubana','Cuba'], ['cubano','Cuba'],
  ]);
  return map.get(s) || String(txt).trim();
}

// ─────────────────────────────────────────────────────────────
// 👥 Víctimas (CRUD) – PROTECTED
// ─────────────────────────────────────────────────────────────

app.get('/apiv2/operativa/victimas', authMiddleware, async (req, res) => {
  const client = await pool.connect();
  try {
   const { role } = req.user || {};
const isCG = Number(role) === ROLES.COORD_GENERAL; // 1 = Coordinación General

    // --- resolver área desde query o JWT (area_id numérico o area string) ---
    const mapArea = (val) => {
      if (val == null) return null;
      const s = String(val).trim().toLowerCase();
      if (/^\d+$/.test(s)) return parseInt(s, 10);
      const m = {
        'social': 1, 's': 1, 'soc': 1,
        'legal': 2, 'l': 2,
        'medica': 3, 'médica': 3, 'm': 3, 'med': 3,
        'psicologica': 4, 'psicológica': 4, 'psi': 4, 'p': 4,
        'albergue': 5, 'a': 5
      };
      return m[s] ?? null;
    };

    const qArea   = mapArea(req.query.area ?? req.query.area_id);
    const jwtArea = mapArea((req.user && (req.user.area_id ?? req.user.area)) ?? null);

    // No-CG: usa el área del JWT obligatoriamente.
    // CG: si viene ?area=... úsala; si no, usa la del JWT (si existe); si no, ve todo.
    const effectiveAreaId = !isCG ? (jwtArea ?? null) : (qArea ?? jwtArea ?? null);

    const q      = (req.query.q || '').trim();
    const limit  = Math.min(parseInt(req.query.limit  || '50', 10), 200);
    const offset = parseInt(req.query.offset || '0', 10);

    // Detectar si existe victimas.area_registro_id (para ampliar el filtro)
    const cols = await getTableCols('victimas');
    const hasAreaReg = cols.has('area_registro_id');

    const whereParts = [];
    const params = [];
    let idx = 1;

    if (effectiveAreaId != null) {
      if (hasAreaReg) {
        whereParts.push(`(v.area_registro_id = $${idx} OR c.area_id = $${idx})`);
      } else {
        whereParts.push(`(c.area_id = $${idx})`);
      }
      params.push(effectiveAreaId);
      idx++;
    } else {
      whereParts.push('TRUE');
    }

    if (q) {
      whereParts.push(`
        (
          COALESCE(NULLIF(TRIM(v.nombre),''), NULLIF(TRIM(CONCAT_WS(' ', v.primer_nombre, v.segundo_nombre, v.primer_apellido, v.segundo_apellido)), '')) ILIKE $${idx}
          OR COALESCE(v.telefono,'') ILIKE $${idx}
          OR COALESCE(v.celular,'')  ILIKE $${idx}
        )
      `);
      params.push(`%${q}%`);
      idx++;
    }

    params.push(limit, offset);

    const sql = `
      SELECT DISTINCT
        v.id,
        -- compatibilidad: nombre y nombre_completo
        COALESCE(NULLIF(TRIM(v.nombre),''), NULLIF(TRIM(CONCAT_WS(' ', v.primer_nombre, v.segundo_nombre, v.primer_apellido, v.segundo_apellido)),''))
          AS nombre,
        COALESCE(v.nombre, CONCAT_WS(' ', v.primer_nombre, v.segundo_nombre, v.primer_apellido, v.segundo_apellido))
          AS nombre_completo,
        COALESCE(NULLIF(v.celular,''), NULLIF(v.telefono,''), '') AS telefono,
        '-' AS correo
      FROM victimas v
      LEFT JOIN casos c ON c.victima_id = v.id
      WHERE ${whereParts.join(' AND ')}
      ORDER BY v.id DESC
      LIMIT $${idx}::int OFFSET $${idx + 1}::int;
    `;

    const { rows } = await client.query(sql, params);
    res.json({ ok: true, data: rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: 'ERR_LISTAR_VICTIMAS_AREA' });
  } finally {
    client.release();
  }
});



app.get('/apiv2/victimas', authMiddleware, async (_req, res) => {
  const { rows } = await pool.query('SELECT * FROM victimas ORDER BY id DESC');
  res.json(rows);
});

app.get('/apiv2/victimas/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const sql = `
  SELECT
  v.*,
  mr.nombre  AS municipio_residencia_nombre,
  drr.nombre AS departamento_residencia_nombre,
  mo.nombre  AS municipio_origen_nombre,
  dpo.nombre AS departamento_origen_nombre,
  COALESCE(NULLIF(TRIM(v.extra->>'origen_texto'), ''), NULL) AS origen_texto,
  COALESCE(
    NULLIF(TRIM(CONCAT_WS(', ', mo.nombre, dpo.nombre)), ''),
    NULLIF(TRIM(v.extra->>'origen_texto'), '')
  ) AS lugar_origen
FROM victimas v
LEFT JOIN municipios    mr  ON mr.id  = v.municipio_residencia_id
LEFT JOIN departamentos drr ON drr.id = mr.departamento_id
LEFT JOIN municipios    mo  ON mo.id  = v.municipio_origen_id
LEFT JOIN departamentos dpo ON dpo.id = mo.departamento_id
WHERE v.id = $1
LIMIT 1

    `;
    const { rows } = await pool.query(sql, [id]);
    if (!rows[0]) return res.status(404).json({ error: 'Víctima no encontrada' });
    res.set('Cache-Control', 'no-store'); // evita 304 en dev
    res.json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error al obtener víctima' });
  }
});

// POST con trazabilidad de quién/área la registró (si existen columnas)
app.post('/apiv2/victimas', authMiddleware, async (req, res) => {
  try {
    const cols = await getTableCols('victimas');
    const b = req.body || {};
    const { id: userId, area_id: userAreaId } = req.user || {};

    const { pn, sn, pa, sa, full } = splitNombreApellidos(b.nombres, b.apellidos);
    const payload = {};

    // Básicos
    putIf(cols, payload, 'primer_nombre',    b.primer_nombre    ?? pn);
    putIf(cols, payload, 'segundo_nombre',   b.segundo_nombre   ?? sn);
    putIf(cols, payload, 'primer_apellido',  b.primer_apellido  ?? pa);
    putIf(cols, payload, 'segundo_apellido', b.segundo_apellido ?? sa);
    putIf(cols, payload, 'nombre',           b.nombre           ?? full);
    putIf(cols, payload, 'nombre_completo',  b.nombre_completo  ?? full);
    putIf(cols, payload, 'sexo',             b.sexo ?? b.genero);
    putIf(cols, payload, 'fecha_nacimiento', b.fecha_nacimiento ?? b.fecha_nac);
    putIf(cols, payload, 'dpi',              b.dpi ?? b.cui);
    putIf(cols, payload, 'cui',              b.cui ?? b.dpi);
    putIf(cols, payload, 'telefono',         b.telefono ?? b.telefono_contacto);
    putIf(cols, payload, 'telefono_contacto',b.telefono_contacto ?? b.telefono);
    putIf(cols, payload, 'estado_civil_id',  b.estado_civil_id ?? b.estado_civil);
    putIf(cols, payload, 'escolaridad_id',   b.escolaridad_id  ?? b.escolaridad);
    putIf(cols, payload, 'etnia_id',         b.etnia_id        ?? b.etnia);
    putIf(cols, payload, 'ocupacion',        b.ocupacion ?? b.actividad ?? b.oficio ?? b.profesion);

    // Dirección / residencia
    putIf(cols, payload, 'direccion_actual', b.direccion_actual ?? b.direccion);
    const muniRes = toInt(
      b.municipio_residencia_id ??
      b.residencia_municipio_id ??
      b.municipio_residencia ??
      b.muni_residencia_id
    );
    if (muniRes != null) putIf(cols, payload, 'municipio_residencia_id', muniRes);

    // Nacionalidad (si existe columna)
    putIf(cols, payload, 'nacionalidad',    b.nacionalidad);
    putIf(cols, payload, 'nacionalidad_id', b.nacionalidad_id);

    // Origen: ID directo o resolución por texto
    const origenInput =
      b.municipio_origen_id ?? b.origen_municipio_id ??
      b.municipio_origen    ?? b.lugar_origen       ?? b.origen;

    let muniOrig = toInt(origenInput);
if (muniOrig == null && typeof origenInput === 'string') {
  muniOrig = await resolveMunicipioIdByText(origenInput);
}

/* ✅ Opción 2 aplicada:
   - Si hay municipio -> guarda municipio_origen_id.
   - Si NO hay municipio y es texto -> normaliza a país (si no es GT) o conserva texto (si es GT).
   - Merge de payload.extra (no lo pisamos). */
if (muniOrig != null) {
  putIf(cols, payload, 'municipio_origen_id', muniOrig);
}

const extra = { ...(payload.extra || {}) };

if (muniOrig == null && typeof origenInput === 'string' && origenInput.trim()) {
  const raw = origenInput.trim();
  // Si NO parece lugar de Guatemala => normaliza a país; si sí, conserva el texto
  extra.origen_texto = looksLikeGuatemalaPlace(raw)
    ? raw
    : normalizaPaisDesdeTexto(raw);
}

if (typeof b.residencia === 'string' && b.residencia.trim()) {
  extra.residencia_texto = b.residencia.trim();
}

if (Object.keys(extra).length && cols.has('extra')) {
  payload.extra = extra;
}


    // NUEVO: trazabilidad (solo si existen columnas—no rompe si aún no migras)
    if (cols.has('created_por') && userId) {
      payload.created_por = userId;
    }
    if (cols.has('area_registro_id') && (userAreaId || b.area_registro_id)) {
      payload.area_registro_id = toInt(b.area_registro_id) ?? userAreaId ?? null;
    }

    if (!Object.keys(payload).length) {
      return res.status(400).json({ error: 'Sin columnas válidas para insertar en victimas.' });
    }

    const fields = Object.keys(payload);
    const values = Object.values(payload);
    const placeholders = fields.map((_, i) => `$${i + 1}`).join(', ');

    const { rows } = await pool.query(
      `INSERT INTO victimas(${fields.join(', ')}) VALUES(${placeholders}) RETURNING id`,
      values
    );

    res.status(201).json({ id: rows[0].id });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error al crear víctima' });
  }
});


app.put('/apiv2/victimas/:id', authMiddleware, async (req, res) => {
  const { id } = req.params;
  try {
    const cols = await getTableCols('victimas');
    const b = req.body || {};

    // Cargar extra actual (para merge)
    let currentExtra = {};
if (cols.has('extra')) {
  const r = await pool.query('SELECT extra FROM victimas WHERE id = $1', [id]);
  currentExtra = r.rows?.[0]?.extra ?? {};
}

    const payload = {};

    putIf(cols, payload, 'primer_nombre',    b.primer_nombre);
    putIf(cols, payload, 'segundo_nombre',   b.segundo_nombre);
    putIf(cols, payload, 'primer_apellido',  b.primer_apellido);
    putIf(cols, payload, 'segundo_apellido', b.segundo_apellido);
    putIf(cols, payload, 'nombre',           b.nombre);
    putIf(cols, payload, 'nombre_completo',  b.nombre_completo);
    putIf(cols, payload, 'sexo',             b.sexo ?? b.genero);
    putIf(cols, payload, 'fecha_nacimiento', b.fecha_nacimiento ?? b.fecha_nac);
    putIf(cols, payload, 'dpi',              b.dpi ?? b.cui);
    putIf(cols, payload, 'cui',              b.cui ?? b.dpi);
    putIf(cols, payload, 'telefono',         b.telefono ?? b.telefono_contacto);
    putIf(cols, payload, 'telefono_contacto',b.telefono_contacto ?? b.telefono);
    putIf(cols, payload, 'estado_civil_id',  b.estado_civil_id ?? b.estado_civil);
    putIf(cols, payload, 'escolaridad_id',   b.escolaridad_id  ?? b.escolaridad);
    putIf(cols, payload, 'etnia_id',         b.etnia_id        ?? b.etnia);
    putIf(cols, payload, 'ocupacion',        b.ocupacion ?? b.actividad ?? b.oficio ?? b.profesion);

    // Dirección / residencia
    putIf(cols, payload, 'direccion_actual', b.direccion_actual ?? b.direccion);
    const mr = toInt(
      b.municipio_residencia_id ??
      b.residencia_municipio_id ??
      b.municipio_residencia ??
      b.muni_residencia_id
    );
    if (mr != null) putIf(cols, payload, 'municipio_residencia_id', mr);

    // Nacionalidad
    putIf(cols, payload, 'nacionalidad',    b.nacionalidad);
    putIf(cols, payload, 'nacionalidad_id', b.nacionalidad_id);

    // Origen (ID directo o resolver por texto)
    const origenInput =
      b.municipio_origen_id ?? b.origen_municipio_id ??
      b.municipio_origen    ?? b.lugar_origen       ?? b.origen;

    let mo = toInt(origenInput);
    if (mo == null && typeof origenInput === 'string') {
      mo = await resolveMunicipioIdByText(origenInput);
    }
    if (mo != null) {
      putIf(cols, payload, 'municipio_origen_id', mo);
    }

    // Merge de EXTRA
  const nextExtra = { ...currentExtra };
if (mo == null && typeof origenInput === 'string' && origenInput.trim()) {
  const raw = origenInput.trim();
  nextExtra.origen_texto = looksLikeGuatemalaPlace(raw) ? raw : normalizaPaisDesdeTexto(raw);
}
if (typeof b.residencia === 'string' && b.residencia.trim()) {
  nextExtra.residencia_texto = b.residencia.trim();
}
if (Object.keys(nextExtra).length && cols.has('extra')) {
  payload.extra = nextExtra;
}

    const fields = Object.keys(payload);
    if (!fields.length) return res.json({ message: 'Sin cambios' });

    const values = Object.values(payload);
    const setClause = fields.map((f, i) => `${f} = $${i + 1}`).join(', ');

    const { rowCount } = await pool.query(
      `UPDATE victimas SET ${setClause} WHERE id = $${fields.length + 1}`,
      [...values, id]
    );
    if (rowCount === 0) return res.status(404).json({ error: 'Víctima no encontrada' });

    res.json({ message: 'Víctima actualizada' });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error al actualizar víctima' });
  }
});

app.delete('/apiv2/victimas/:id', authMiddleware, async (req, res) => {
  const { id } = req.params;
  const { rowCount } = await pool.query('DELETE FROM victimas WHERE id = $1', [id]);
  if (rowCount === 0) return res.status(404).json({ error: 'Víctima no encontrada' });
  res.json({ message: 'Víctima eliminada' });
});

// ─────────────────────────────────────────────────────────────────────────────
// 🔪 5) Agresores (CRUD) – PROTECTED
// ─────────────────────────────────────────────────────────────────────────────
app.get('/apiv2/agresores', authMiddleware, async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM agresores');
  res.json(rows);
});
app.get('/apiv2/agresores/:id', authMiddleware, async (req, res) => {
  const { id } = req.params;
  const { rows } = await pool.query('SELECT * FROM agresores WHERE id = $1', [id]);
  if (!rows[0]) return res.status(404).json({ error: 'Agresor no encontrado' });
  res.json(rows[0]);
});
app.post('/apiv2/agresores', authMiddleware, async (req, res) => {
  const fields = Object.keys(req.body);
  const values = Object.values(req.body);
  const cols  = fields.join(', ');
  const vals  = fields.map((_,i)=>`$${i+1}`).join(', ');
  const { rows } = await pool.query(
    `INSERT INTO agresores(${cols}) VALUES(${vals}) RETURNING id`,
    values
  );
  res.status(201).json({ id: rows[0].id });
});
app.put('/apiv2/agresores/:id', authMiddleware, async (req, res) => {
  const { id } = req.params;
  const fields = Object.keys(req.body);
  const values = Object.values(req.body);
  if (!fields.length) return res.json({ message: 'Sin cambios' });
  const setClause = fields.map((f,i)=>`${f}=$${i+1}`).join(', ');
  const { rowCount } = await pool.query(
    `UPDATE agresores SET ${setClause} WHERE id = $${fields.length+1}`,
    [...values, id]
  );
  if (rowCount === 0) return res.status(404).json({ error: 'Agresor no encontrado' });
  res.json({ message: 'Agresor actualizado' });
});
app.delete('/apiv2/agresores/:id', authMiddleware, async (req, res) => {
  const { id } = req.params;
  const { rowCount } = await pool.query('DELETE FROM agresores WHERE id = $1', [id]);
  if (rowCount === 0) return res.status(404).json({ error: 'Agresor no encontrado' });
  res.json({ message: 'Agresor eliminado' });
});

// ─────────────────────────────────────────────────────────────────────────────
// 👶 6) Hijos (CRUD) – PROTECTED
// ─────────────────────────────────────────────────────────────────────────────
app.get('/apiv2/hijos', authMiddleware, async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM hijos');
  res.json(rows);
});
app.get('/apiv2/hijos/:id', authMiddleware, async (req, res) => {
  const { id } = req.params;
  const { rows } = await pool.query('SELECT * FROM hijos WHERE id = $1', [id]);
  if (!rows[0]) return res.status(404).json({ error: 'Hijo no encontrado' });
  res.json(rows[0]);
});
app.post('/apiv2/hijos', authMiddleware, async (req, res) => {
  const fields = Object.keys(req.body);
  const values = Object.values(req.body);
  const cols  = fields.join(', ');
  const vals  = fields.map((_,i)=>`$${i+1}`).join(', ');
  const { rows } = await pool.query(
    `INSERT INTO hijos(${cols}) VALUES(${vals}) RETURNING id`,
    values
  );
  res.status(201).json({ id: rows[0].id });
});
app.put('/apiv2/hijos/:id', authMiddleware, async (req, res) => {
  const { id } = req.params;
  const fields = Object.keys(req.body);
  const values = Object.values(req.body);
  if (!fields.length) return res.json({ message: 'Sin cambios' });
  const setClause = fields.map((f,i)=>`${f}=$${i+1}`).join(', ');
  const { rowCount } = await pool.query(
    `UPDATE hijos SET ${setClause} WHERE id = $${fields.length+1}`,
    [...values, id]
  );
  if (rowCount === 0) return res.status(404).json({ error: 'Hijo no encontrado' });
  res.json({ message: 'Hijo actualizado' });
});
app.delete('/apiv2/hijos/:id', authMiddleware, async (req, res) => {
  const { id } = req.params;
  const { rowCount } = await pool.query('DELETE FROM hijos WHERE id = $1', [id]);
  if (rowCount === 0) return res.status(404).json({ error: 'Hijo no encontrado' });
  res.json({ message: 'Hijo eliminado' });
});

// ─────────────────────────────────────────────────────────────────────────────
// 🗂 7) Casos (CRUD + flujo estados + asignación + historial + inmutabilidad)
// ─────────────────────────────────────────────────────────────────────────────

// ========== Helpers ENCAPSULADAS para evitar colisiones ==========
const __casosExt = (() => {
  function toInt(x) { const n = Number(x); return Number.isFinite(n) ? n : null; }
  function toIntArray(a) {
    return (Array.isArray(a) ? a : [])
      .map(toInt)
      .filter((n) => Number.isInteger(n) && n > 0);
  }

  async function fetchCasoCompleto(clientOrPool, casoId) {
    const db = clientOrPool?.query ? clientOrPool : pool;
    const { rows: cRows } = await db.query('SELECT * FROM casos WHERE id = $1', [casoId]);
    if (!cRows[0]) return null;
    const caso = cRows[0];

    // Queries tolerantes a ausencia de tablas/columnas
    const safe = async (sql, params) => {
      try { return await db.query(sql, params); }
      catch (e) {
        // Solo log breve; devolvemos shape compatible
        console.warn('[casos.fetchCasoCompleto] consulta opcional falló:', e?.message);
        return { rows: [] };
      }
    };

    // ⬇️ TABLAS CORRECTAS DEL ESQUEMA
    const [tv, ma, ri, re, rz, hj, ag] = await Promise.all([
      safe('SELECT tipo_violencia_id FROM caso_violencias WHERE caso_id = $1 ORDER BY 1', [casoId]),
      safe('SELECT medio_agresion_id FROM caso_medios_agresion WHERE caso_id = $1 ORDER BY 1', [casoId]),
      safe('SELECT destino_id FROM caso_ref_interna WHERE caso_id = $1 ORDER BY 1', [casoId]),
      safe('SELECT destino_id FROM caso_ref_externa WHERE caso_id = $1 ORDER BY 1', [casoId]),
      safe("SELECT situacion_id, COALESCE(detalle, '') AS detalle FROM caso_situacion_riesgo WHERE caso_id = $1 ORDER BY id", [casoId]),
      safe('SELECT id, nombre, sexo, edad_anios, reconocido FROM hijos WHERE caso_id = $1 ORDER BY id', [casoId]),
      safe(`SELECT id, nombre, edad, dpi_pasaporte, ocupacion, telefono, ingreso_mensual, direccion,
                       lugar_residencia, lugar_trabajo, horario_trabajo, relacion_agresor_id, observacion
                FROM agresores WHERE caso_id = $1 ORDER BY id`, [casoId]),
    ]);

    return {
      ...caso,
      tipos_violencia_ids : (tv.rows || []).map(r => r.tipo_violencia_id),
      medios_agresion_ids : (ma.rows || []).map(r => r.medio_agresion_id),
      ref_interna_ids     : (ri.rows || []).map(r => r.destino_id),
      ref_externa_ids     : (re.rows || []).map(r => r.destino_id),
      situaciones_riesgo  : (rz.rows || []).map(r => ({ situacion_id: r.situacion_id, detalle: r.detalle || '' })),
      hijos               : hj.rows || [],
      agresores           : ag.rows || [],
    };
  }

  async function replacePivot(client, table, col, casoId, ids) {
    await client.query(`DELETE FROM ${table} WHERE caso_id = $1`, [casoId]);
    if (!ids.length) return;
    const vals = [casoId, ...ids];
    const ph = ids.map((_, i) => `($1, $${i + 2})`).join(', ');
    await client.query(`INSERT INTO ${table}(caso_id, ${col}) VALUES ${ph}`, vals);
  }

  async function replaceRiesgos(client, casoId, items) {
    await client.query('DELETE FROM caso_situacion_riesgo WHERE caso_id = $1', [casoId]);
    const clean = (Array.isArray(items) ? items : [])
      .map(x => ({ situacion_id: toInt(x?.situacion_id), detalle: (x?.detalle ?? '').trim() }))
      .filter(x => Number.isInteger(x.situacion_id) && x.situacion_id > 0);

    if (!clean.length) return;
    const vals = [];
    const ph = clean.map((r, i) => {
      vals.push(casoId, r.situacion_id, r.detalle || null);
      const base = i * 3;
      return `($${base + 1}, $${base + 2}, $${base + 3})`;
    }).join(', ');
    await client.query(
      `INSERT INTO caso_situacion_riesgo(caso_id, situacion_id, detalle) VALUES ${ph}`, vals
    );
  }

  async function replaceHijos(client, casoId, hijos) {
    await client.query('DELETE FROM hijos WHERE caso_id = $1', [casoId]);
    const list = (Array.isArray(hijos) ? hijos : []);
    if (!list.length) return;
    const vals = [];
    const ph = list.map((h, i) => {
      vals.push(
        casoId,
        (h?.nombre ?? null),
        (h?.sexo ?? null),
        toInt(h?.edad_anios),
        !!h?.reconocido
      );
      const b = i * 5;
      return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5})`;
    }).join(', ');
    await client.query(
      `INSERT INTO hijos(caso_id, nombre, sexo, edad_anios, reconocido) VALUES ${ph}`, vals
    );
  }

 // === Helpers genéricos (pegar estos una sola vez) ===
async function __getColumns(client, table) {
  const { rows } = await client.query(
    `SELECT column_name FROM information_schema.columns WHERE table_name = $1`,
    [table]
  );
  return new Set(rows.map(r => r.column_name));
}
function __pick(obj, allowed) {
  const out = {};
  for (const [k,v] of Object.entries(obj || {})) if (allowed.has(k)) out[k] = v;
  return out;
}

// === Helpers de casos (ya tienes replaceRiesgos, replaceHijos, etc.) ===
async function replaceAgresores(client, casoId, agresores = []) {
  await client.query(`DELETE FROM agresores WHERE caso_id = $1`, [casoId]);
  if (!Array.isArray(agresores) || !agresores.length) return;

  const colsSet = await __getColumns(client, 'agresores');

  for (const a of agresores) {
    const base = {
      caso_id: casoId,
      nombre: a?.nombre ?? null,
      edad: a?.edad !== "" && a?.edad != null ? Number(a.edad) : null,
      dpi_pasaporte: a?.dpi_pasaporte ?? null,
      ocupacion: a?.ocupacion ?? null,
      direccion: a?.direccion ?? null,
      lugar_residencia: a?.lugar_residencia ?? null,
      lugar_trabajo: a?.lugar_trabajo ?? null,
      horario_trabajo: a?.horario_trabajo ?? null,
      telefono: a?.telefono ?? null,
      ingreso_mensual: a?.ingreso_mensual !== "" && a?.ingreso_mensual != null ? Number(a.ingreso_mensual) : null,
      relacion_agresor_id: a?.relacion_agresor_id != null && a?.relacion_agresor_id !== "" ? Number(a.relacion_agresor_id) : null,
      observacion: a?.observacion ?? null,
    };
    const row = __pick(base, colsSet); // ← filtra solo columnas existentes
    const cols = Object.keys(row);
    const vals = Object.values(row);
    const p = cols.map((_,i) => `$${i+1}`).join(',');
    await client.query(`INSERT INTO agresores (${cols.join(',')}) VALUES (${p})`, vals);
  }
}

  return { toInt, toIntArray, fetchCasoCompleto, replacePivot, replaceRiesgos, replaceHijos, replaceAgresores };
})();

// LISTADO: CG solo ve en_progreso y completado; Área ve sus casos (todos los estados)
app.get('/apiv2/casos', authMiddleware, async (req, res) => {
  const { role, area } = req.user;
  try {
    if (role === ROLES.COORD_GENERAL) {
      const { rows } = await pool.query(
        `SELECT * FROM casos 
         WHERE estado IN ($1,$2) 
         ORDER BY 
            CASE estado 
              WHEN 'en_progreso' THEN 1
              WHEN 'completado' THEN 2
            END, id DESC`,
        [ESTADOS.EN_PROGRESO, ESTADOS.COMPLETADO]
      );
      return res.json(rows);
    }
    const { rows } = await pool.query(
      'SELECT * FROM casos WHERE area_id = $1 ORDER BY id DESC',
      [area]
    );
    res.json(rows);
  } catch (err) {
    console.error(err); res.status(500).json({ error: 'Error en el servidor' });
  }
});

// DETALLE: CG solo accede en_progreso/completado; Área solo su área
app.get('/apiv2/casos/:id', authMiddleware, async (req, res) => {
  const { role, area } = req.user;
  const { id } = req.params;
  try {
    const { rows } = await pool.query('SELECT * FROM casos WHERE id = $1', [id]);
    if (!rows[0]) return res.status(404).json({ error: 'Caso no encontrado' });
    const caso = rows[0];

    if (role === ROLES.COORD_GENERAL) {
      if (![ESTADOS.EN_PROGRESO, ESTADOS.COMPLETADO].includes(caso.estado)) {
        return res.status(403).json({ error: 'CG solo accede a en_progreso/completado' });
      }
    } else if (caso.area_id !== area) {
      return res.status(403).json({ error: 'No autorizado' });
    }

    // ⬇️ NUEVO: devolver caso expandido con pivots/hijos/agresores
    const full = await __casosExt.fetchCasoCompleto(pool, id);
    res.json(full);
  } catch (err) {
    console.error(err); res.status(500).json({ error: 'Error en el servidor' });
  }
});

// Historial por caso
app.get('/apiv2/casos/:id/historial', authMiddleware, async (req, res) => {
  const { role, area } = req.user;
  const { id } = req.params;
  try {
    const c = await pool.query('SELECT area_id, estado FROM casos WHERE id = $1', [id]);
    if (!c.rows[0]) return res.status(404).json({ error: 'Caso no encontrado' });

    if (role !== ROLES.COORD_GENERAL && c.rows[0].area_id !== area) {
      return res.status(403).json({ error: 'No autorizado' });
    }
    if (role === ROLES.COORD_GENERAL && ![ESTADOS.EN_PROGRESO, ESTADOS.COMPLETADO].includes(c.rows[0].estado)) {
      return res.status(403).json({ error: 'CG solo accede a en_progreso/completado' });
    }

    const { rows } = await pool.query(
      `SELECT h.*, u.nombre_completo AS usuario_nombre 
       FROM casos_historial h 
       LEFT JOIN usuarios u ON u.id = h.usuario_id 
       WHERE h.caso_id = $1 
       ORDER BY h.created_at ASC`, [id]
    );
    res.json(rows);
  } catch (e) {
    console.error(e); res.status(500).json({ error: 'Error obteniendo historial' });
  }
});

// ─────────────────────────────────────────────────────────────
// NUEVO: ¿Hay borrador para esta víctima en mi área?
// GET /apiv2/casos/draft?victima_id=123
// ─────────────────────────────────────────────────────────────
app.get('/apiv2/casos/draft', authMiddleware, async (req, res) => {
  const { role, area } = req.user;
  if (![ROLES.OPERATIVO, ROLES.COORD_AREA].includes(role)) {
    return res.status(403).json({ error: 'No autorizado' });
  }

  const victima_id = Number(req.query?.victima_id);
  if (!Number.isInteger(victima_id) || victima_id <= 0) {
    return res.status(400).json({ error: 'victima_id es obligatorio' });
  }

  try {
    const { rows } = await pool.query(
      `SELECT * FROM casos 
          WHERE victima_id = $1 AND area_id = $2 AND estado = $3 
         ORDER BY id DESC 
         LIMIT 1`,
      [victima_id, area, ESTADOS.BORRADOR]
    );

    if (!rows[0]) return res.status(404).json({ error: 'No hay borrador' });
    res.json(rows[0]);
  } catch (e) {
    console.error(e); res.status(500).json({ error: 'Error consultando borrador' });
  }
});

// ─────────────────────────────────────────────────────────────
// Crear caso: estado inicial = borrador (idempotente por victima_id+area)
// REQUIERE victima_id. Si ya existe borrador, lo reusa en lugar de crear otro.
// ─────────────────────────────────────────────────────────────
app.post('/apiv2/casos', authMiddleware, async (req, res) => {
  const { role, area, id: userId } = req.user;
  if (![ROLES.COORD_AREA, ROLES.OPERATIVO, ROLES.COORD_GENERAL].includes(role)) {
    return res.status(403).json({ error: 'No autorizado' });
  }

  const victima_id = Number(req.body?.victima_id);
  if (!Number.isInteger(victima_id) || victima_id <= 0) {
    return res.status(400).json({ error: 'victima_id es obligatorio' });
  }

  try {
    // 1) Validar víctima
    const chkV = await pool.query('SELECT 1 FROM victimas WHERE id = $1', [victima_id]);
    if (!chkV.rows[0]) return res.status(400).json({ error: 'victima_id no existe' });

    // 2) ¿Ya hay borrador para esta víctima en mi área?
    const existing = await pool.query(
      `SELECT id FROM casos 
          WHERE victima_id = $1 AND area_id = $2 AND estado = $3 
         ORDER BY id DESC 
         LIMIT 1`,
      [victima_id, area, ESTADOS.BORRADOR]
    );

    // Campos que SÍ permitimos actualizar/insertar (excluye controlados)
    const body = req.body || {};
    const reserved = new Set([
      'id','area_id','creado_por','estado','victima_id',
      'fecha_creacion','fecha_inicio','fecha_revision','fecha_envio','fecha_cierre',
      'revisado_por','asignado_id'
    ]);

    if (existing.rows[0]) {
      // Reusar: actualizar campos opcionales si llegaron
      const caseId = existing.rows[0].id;
      const upFields = [];
      const upValues = [];
      let uIdx = 1;

      // ⚠️ bloque intacto (omites set dinámico salvo "otros_*")
      for (const [k, v] of Object.entries(body)) {
        if (reserved.has(k)) continue;
        // Aquí no tocamos tu lógica original de set dinámico
      }

      // Campos libres "otros_*": a columnas directas si existen; si no, a JSONB extra
      try {
        const colsCasos = await getTableCols('casos');
        const otrosKeys = ['otros_tipos_violencia','otros_medios_agresion','ref_interna_otro','ref_externa_otro'];
        const extraObj = {};
        for (const key of otrosKeys) {
          const val = String(body[key] ?? '').trim();
          if (!val) continue;
          if (colsCasos.has(key)) {
            upFields.push(`${key} = $${uIdx++}`); upValues.push(val);
          } else if (colsCasos.has('extra')) {
            extraObj[key] = val;
          }
        }
        if (Object.keys(extraObj).length && colsCasos.has('extra')) {
          upFields.push(`extra = COALESCE(extra,'{}'::jsonb) || $${uIdx++}::jsonb`);
          upValues.push(extraObj);
        }
      } catch {}

      if (upFields.length) {
        await pool.query(
          `UPDATE casos SET ${upFields.join(', ')} WHERE id = $${uIdx}`,
          [...upValues, caseId]
        );
        await addHistorial(caseId, userId, 'editar', ESTADOS.BORRADOR, ESTADOS.BORRADOR, `Actualización sobre borrador existente`);
      }
      return res.status(200).json({ id: caseId, reused: true, message: 'Borrador existente reutilizado' });
    }

    // Insertar nuevo borrador
    const insertCols = ['area_id', 'creado_por', 'estado', 'victima_id'];
    const insertVals = [area, userId, ESTADOS.BORRADOR, victima_id];
    const placeholders = ['$1', '$2', '$3', '$4'];

    const dynCols = [];
    const dynVals = [];
    let baseIdx = 5;

    const colsCasosNew = await getTableCols('casos');
    for (const [k, v] of Object.entries(body)) {
      if (reserved.has(k)) continue;
      if (!colsCasosNew.has(String(k).toLowerCase())) continue; // solo columnas reales
      dynCols.push(k);
      dynVals.push(v);
    }

    // Campos libres "otros_*": a columnas directas si existen; si no, a JSONB extra
    try {
      const colsCasos = colsCasosNew;
      const otrosKeys = ['otros_tipos_violencia','otros_medios_agresion','ref_interna_otro','ref_externa_otro'];
      const extraObj = {};
      for (const key of otrosKeys) {
        const val = String(body[key] ?? '').trim();
        if (!val) continue;
        if (colsCasos.has(key)) {
          dynCols.push(key);
          dynVals.push(val);
        } else if (colsCasos.has('extra')) {
          extraObj[key] = val;
        }
      }
      if (Object.keys(extraObj).length && colsCasos.has('extra')) {
        dynCols.push('extra');
        dynVals.push(extraObj);
      }
    } catch {}

    const allCols = [...insertCols, ...dynCols];
    const allVals = [...insertVals, ...dynVals];
    const allPh   = [...placeholders, ...dynCols.map((_, i) => `$${i + baseIdx}`)];

    const ins = await pool.query(
      `INSERT INTO casos(${allCols.join(',')})
       VALUES(${allPh.join(',')})
       RETURNING id`,
      allVals
    );

    await addHistorial(ins.rows[0].id, userId, 'crear', null, ESTADOS.BORRADOR, 'Caso creado en borrador');
    return res.status(201).json({ id: ins.rows[0].id, reused: false, message: 'Borrador creado' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al crear caso' });
  }
});

// Update genérico (bloquea si completado) + reescritura idempotente de relaciones
app.put('/apiv2/casos/:id', authMiddleware, async (req, res) => {
  const { role, area, id: userId } = req.user;
  const { id } = req.params;

  const client = await pool.connect();
  try {
    const c = await client.query('SELECT area_id, estado FROM casos WHERE id = $1', [id]);
    if (!c.rows[0]) { return res.status(404).json({ error: 'Caso no encontrado' }); }
    if (role !== ROLES.COORD_GENERAL && c.rows[0].area_id !== area) return res.status(403).json({ error: 'No autorizado' });
    if (c.rows[0].estado === ESTADOS.COMPLETADO) return res.status(400).json({ error: 'El caso completado no se puede modificar' });

    const body = req.body || {};
    const colsCasosForPut = await getTableCols('casos');
    // Merge a JSONB extra para "otros_*" si no hay columnas directas
    try {
      const colsCasos = await getTableCols('casos');
      if (colsCasos.has('extra')) {
        const otrosKeys = ['otros_tipos_violencia','otros_medios_agresion','ref_interna_otro','ref_externa_otro'];
        const extraAdd = {};
        for (const key of otrosKeys) {
          if (colsCasos.has(key)) continue; // existe columna directa; se actualizará normal
          const val = (body[key] ?? '').toString().trim();
          if (val) { extraAdd[key] = val; delete body[key]; }
        }
        if (Object.keys(extraAdd).length) {
          const cur = await client.query('SELECT extra FROM casos WHERE id = $1', [id]);
          const prev = cur.rows?.[0]?.extra || {};
          body.extra = { ...prev, ...extraAdd };
        }
      }
    } catch {}
    const relKeys = new Set([
      'tipos_violencia_ids','medios_agresion_ids',
      'ref_interna_ids','ref_externa_ids',
      'situaciones_riesgo','hijos','agresores'
    ]);
    const coreFields = Object.keys(body).filter(k => !relKeys.has(k) && colsCasosForPut.has(String(k).toLowerCase()));
    const coreValues = coreFields.map(k => body[k]);

    await client.query('BEGIN');

    if (coreFields.length) {
      const setClause = coreFields.map((f,i)=>`${f}=$${i+1}`).join(', ');
      await client.query(
        `UPDATE casos SET ${setClause} WHERE id = $${coreFields.length+1}`,
        [...coreValues, id]
      );
      await addHistorial(id, userId, 'editar', c.rows[0].estado, c.rows[0].estado, `Edición de campos: ${coreFields.join(', ')}`);
    }

    // ⬇️ TABLAS CORRECTAS PARA PIVOTES
    if (body.tipos_violencia_ids !== undefined) {
      await __casosExt.replacePivot(client, 'caso_violencias', 'tipo_violencia_id', id, __casosExt.toIntArray(body.tipos_violencia_ids));
    }
    if (body.medios_agresion_ids !== undefined) {
      await __casosExt.replacePivot(client, 'caso_medios_agresion', 'medio_agresion_id', id, __casosExt.toIntArray(body.medios_agresion_ids));
    }
    if (body.ref_interna_ids !== undefined) {
      await __casosExt.replacePivot(client, 'caso_ref_interna', 'destino_id', id, __casosExt.toIntArray(body.ref_interna_ids));
    }
    if (body.ref_externa_ids !== undefined) {
      await __casosExt.replacePivot(client, 'caso_ref_externa', 'destino_id', id, __casosExt.toIntArray(body.ref_externa_ids));
    }
    if (body.situaciones_riesgo !== undefined) {
      await __casosExt.replaceRiesgos(client, id, body.situaciones_riesgo);
    }
    if (body.hijos !== undefined) {
      await __casosExt.replaceHijos(client, id, body.hijos);
    }
    if (body.agresores !== undefined) {
      await __casosExt.replaceAgresores(client, id, body.agresores);
    }

    await client.query('COMMIT');

    // devolver el caso completo ya actualizado
    const full = await __casosExt.fetchCasoCompleto(pool, id);
    res.json(full);
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch {}
    console.error(err); res.status(500).json({ error: 'Error en el servidor' });
  } finally {
    client.release();
  }
});

// Eliminar (bloquea si completado)
app.delete('/apiv2/casos/:id', authMiddleware, async (req, res) => {
  const { role, area } = req.user;
  const { id } = req.params;
  try {
    const c = await pool.query('SELECT area_id, estado FROM casos WHERE id = $1', [id]);
    if (!c.rows[0]) return res.status(404).json({ error: 'Caso no encontrado' });
    if (role !== ROLES.COORD_GENERAL && c.rows[0].area_id !== area) return res.status(403).json({ error: 'No autorizado' });
    if (c.rows[0].estado === ESTADOS.COMPLETADO) return res.status(400).json({ error: 'El caso completado no se puede eliminar' });

    const { rowCount } = await pool.query('DELETE FROM casos WHERE id = $1', [id]);
    if (rowCount === 0) return res.status(404).json({ error: 'Caso no encontrado' });
    res.json({ message: 'Caso eliminado' });
  } catch (err) {
    console.error(err); res.status(500).json({ error: 'Error en el servidor' });
  }
});

// Asignación (QUITADO fecha_asignacion: no existe en la tabla)
app.post('/apiv2/casos/:id/asignar', authMiddleware, async (req, res) => {
  const { role, area, id: userId } = req.user;
  const { id } = req.params;
  const { operador_id } = req.body;
  if (!operador_id) return res.status(400).json({ error: 'operador_id es requerido' });

  try {
    const c = await pool.query('SELECT area_id, estado FROM casos WHERE id = $1', [id]);
    if (!c.rows[0]) return res.status(404).json({ error: 'Caso no encontrado' });
    if (role !== ROLES.COORD_GENERAL && c.rows[0].area_id !== area) return res.status(403).json({ error: 'Caso de otra área' });
    if (c.rows[0].estado === ESTADOS.COMPLETADO) return res.status(400).json({ error: 'Caso completado no permite asignación' });

    const u = await pool.query('SELECT role_id, area_id FROM usuarios WHERE id = $1', [operador_id]);
    if (!u.rows[0]) return res.status(404).json({ error: 'Operador no encontrado' });
    if (u.rows[0].role_id !== ROLES.OPERATIVO) return res.status(400).json({ error: 'El usuario no es Operativo' });
    if (role !== ROLES.COORD_GENERAL && u.rows[0].area_id !== area) return res.status(400).json({ error: 'Operador de otra área' });

    await pool.query(`UPDATE casos SET asignado_id = $1 WHERE id = $2`, [operador_id, id]);
    await addHistorial(id, userId, 'asignar', c.rows[0].estado, c.rows[0].estado, `Asignado a usuario ${operador_id}`);
    res.json({ message: 'Caso asignado' });
  } catch (err) {
    console.error(err); res.status(500).json({ error: 'Error al asignar caso' });
  }
});

// Enviar a revisión (borrador -> pendiente) – rojo
app.post('/apiv2/casos/:id/enviar-revision', authMiddleware, async (req, res) => {
  const { role, area, id: userId } = req.user;
  if (![ROLES.COORD_AREA, ROLES.OPERATIVO].includes(role)) return res.status(403).json({ error: 'No autorizado' });
  const { id } = req.params;
  try {
    const c = await pool.query('SELECT area_id, estado FROM casos WHERE id = $1', [id]);
    if (!c.rows[0]) return res.status(404).json({ error: 'Caso no encontrado' });
    if (c.rows[0].area_id !== area) return res.status(403).json({ error: 'Caso de otra área' });
    if (c.rows[0].estado !== ESTADOS.BORRADOR) return res.status(400).json({ error: 'Solo borrador puede ir a pendiente' });

    await pool.query(`UPDATE casos SET estado=$1 WHERE id = $2`, [ESTADOS.PENDIENTE, id]);
    await addHistorial(id, userId, 'cambiar_estado', ESTADOS.BORRADOR, ESTADOS.PENDIENTE, 'Se envía a revisión');
    res.json({ message: 'Caso enviado a revisión (pendiente)' });
  } catch (err) {
    console.error(err); res.status(500).json({ error: 'Error en el servidor' });
  }
});

// Validar (pendiente -> validado)
app.post('/apiv2/casos/:id/validar', authMiddleware, async (req, res) => {
  const { role, area, id: userId } = req.user;
  if (role !== ROLES.COORD_AREA) return res.status(403).json({ error: 'No autorizado' });
  const { id } = req.params;
  try {
    const c = await pool.query('SELECT area_id, estado FROM casos WHERE id = $1', [id]);
    if (!c.rows[0]) return res.status(404).json({ error: 'Caso no encontrado' });
    if (c.rows[0].area_id !== area) return res.status(403).json({ error: 'Caso de otra área' });
    if (c.rows[0].estado !== ESTADOS.PENDIENTE) return res.status(400).json({ error: 'Solo pendiente puede ser validado' });

    await pool.query(
      `UPDATE casos SET estado=$1, revisado_por=$2, fecha_revision=NOW() WHERE id=$3`,
      [ESTADOS.VALIDADO, userId, id]
    );
    await addHistorial(id, userId, 'cambiar_estado', ESTADOS.PENDIENTE, ESTADOS.VALIDADO, 'Caso validado en el área');
    res.json({ message: 'Caso validado' });
  } catch (err) {
    console.error(err); res.status(500).json({ error: 'Error en el servidor' });
  }
});

// Devolver con observación (pendiente -> borrador) - SOLO Coordinación de área
app.post('/apiv2/casos/:id/devolver', authMiddleware, async (req, res) => {
  const { role, area, id: userId } = req.user;
  if (role !== ROLES.COORD_AREA) return res.status(403).json({ error: 'No autorizado' });
  const { id } = req.params;
  const motivo = String(req.body?.motivo || '').trim();
  try {
    const c = await pool.query('SELECT area_id, estado FROM casos WHERE id = $1', [id]);
    if (!c.rows[0]) return res.status(404).json({ error: 'Caso no encontrado' });
    if (c.rows[0].area_id !== area) return res.status(403).json({ error: 'Caso de otra área' });
    if (c.rows[0].estado !== ESTADOS.PENDIENTE) return res.status(400).json({ error: 'Solo pendiente puede devolverse' });

    await pool.query(`UPDATE casos SET estado=$1 WHERE id=$2`, [ESTADOS.BORRADOR, id]);
    const detalle = motivo ? `Devuelto a Operativo. Motivo: ${motivo}` : 'Devuelto a Operativo';
    await addHistorial(id, userId, 'cambiar_estado', ESTADOS.PENDIENTE, ESTADOS.BORRADOR, detalle);
    res.json({ message: 'Caso devuelto a borrador' });
  } catch (err) {
    console.error(err); res.status(500).json({ error: 'Error en el servidor' });
  }
});

// (Opcional/legacy) Enviar a CG (validado -> enviado)
app.post('/apiv2/casos/:id/enviar', authMiddleware, async (req, res) => {
  const { role, area, id: userId } = req.user;
  if (![ROLES.COORD_AREA, ROLES.COORD_GENERAL].includes(role)) return res.status(403).json({ error: 'No autorizado' });
  const { id } = req.params;
  try {
    const c = await pool.query('SELECT area_id, estado FROM casos WHERE id = $1', [id]);
    if (!c.rows[0]) return res.status(404).json({ error: 'Caso no encontrado' });
    if (role === ROLES.COORD_AREA && c.rows[0].area_id !== area) return res.status(403).json({ error: 'Caso de otra área' });
    if (c.rows[0].estado !== ESTADOS.VALIDADO) return res.status(400).json({ error: 'Solo validado puede enviarse' });

    await pool.query(`UPDATE casos SET estado=$1, fecha_envio=NOW() WHERE id=$2`, [ESTADOS.ENVIADO, id]);
    await addHistorial(id, userId, 'cambiar_estado', ESTADOS.VALIDADO, ESTADOS.ENVIADO, 'Enviado (legacy)');
    res.json({ message: 'Caso marcado como enviado (legacy)' });
  } catch (err) {
    console.error(err); res.status(500).json({ error: 'Error en el servidor' });
  }
});

// Poner EN PROGRESO (🟡) — SOLO Coordinación de Área
app.post('/apiv2/casos/:id/en-progreso', authMiddleware, async (req, res) => {
  const { role, area, id: userId } = req.user;
  if (role !== ROLES.COORD_AREA) return res.status(403).json({ error: 'Solo Coordinación de Área puede poner en progreso' });
  const { id } = req.params;
  try {
    const c = await pool.query('SELECT area_id, estado FROM casos WHERE id = $1', [id]);
    if (!c.rows[0]) return res.status(404).json({ error: 'Caso no encontrado' });
    if (c.rows[0].area_id !== area) return res.status(403).json({ error: 'Caso de otra área' });
    if (c.rows[0].estado === ESTADOS.COMPLETADO) return res.status(400).json({ error: 'Caso completado no puede cambiar' });
    if (c.rows[0].estado === ESTADOS.EN_PROGRESO) return res.json({ message: 'Caso ya está en progreso' });

    if (![ESTADOS.PENDIENTE, ESTADOS.VALIDADO, ESTADOS.ENVIADO].includes(c.rows[0].estado)) {
      return res.status(400).json({ error: 'Solo pendiente/validado/enviado pueden ir a en_progreso' });
    }

    await pool.query(`UPDATE casos SET estado=$1, fecha_inicio = COALESCE(fecha_inicio, NOW()) WHERE id=$2`, [ESTADOS.EN_PROGRESO, id]);
    await addHistorial(id, userId, 'cambiar_estado', c.rows[0].estado, ESTADOS.EN_PROGRESO, 'Caso en progreso por coordinación de área');
    res.json({ message: 'Caso marcado en progreso' });
  } catch (e) {
    console.error(e); res.status(500).json({ error: 'Error al marcar en progreso' });
  }
});

// COMPLETAR (🟢, inmutable) — SOLO Coordinación de Área
app.post('/apiv2/casos/:id/completar', authMiddleware, async (req, res) => {
  const { role, area, id: userId } = req.user;
  if (role !== ROLES.COORD_AREA) return res.status(403).json({ error: 'Solo Coordinación de Área puede completar' });
  const { id } = req.params;
  try {
    const c = await pool.query('SELECT area_id, estado FROM casos WHERE id = $1', [id]);
    if (!c.rows[0]) return res.status(404).json({ error: 'Caso no encontrado' });
    if (c.rows[0].area_id !== area) return res.status(403).json({ error: 'Caso de otra área' });
    if (c.rows[0].estado === ESTADOS.COMPLETADO) return res.json({ message: 'Caso ya estaba completado' });
    if (![ESTADOS.EN_PROGRESO].includes(c.rows[0].estado)) {
      return res.status(400).json({ error: 'Solo casos en progreso pueden completarse' });
    }

    await pool.query(
      `UPDATE casos
         SET estado=$1,
             fecha_cierre = NOW()
       WHERE id=$2`,
      [ESTADOS.COMPLETADO, id]
    );
    await addHistorial(id, userId, 'cambiar_estado', c.rows[0].estado, ESTADOS.COMPLETADO, 'Caso completado por coordinación de área');
    res.json({ message: 'Caso completado (inmutable)' });
  } catch (e) {
    console.error(e); res.status(500).json({ error: 'Error al completar caso' });
  }
});

// Compat rutas antiguas (aprobar = validar; enviar-legacy = enviado)
app.post('/apiv2/casos/:id/aprobar', authMiddleware, async (req, res) => {
  const { role, area, id: userId } = req.user;
  if (role !== ROLES.COORD_AREA) return res.status(403).json({ error: 'No autorizado' });
  const { id } = req.params;
  try {
    const c = await pool.query('SELECT area_id, estado FROM casos WHERE id = $1', [id]);
    if (!c.rows[0]) return res.status(404).json({ error: 'Caso no encontrado' });
    if (c.rows[0].area_id !== area) return res.status(403).json({ error: 'Caso de otra área' });
    if (c.rows[0].estado !== ESTADOS.PENDIENTE) return res.status(400).json({ error: 'Solo pendiente puede ser validado' });

    await pool.query(
      `UPDATE casos SET estado=$1, revisado_por=$2, fecha_revision=NOW() WHERE id=$3`,
      [ESTADOS.VALIDADO, userId, id]
    );
    await addHistorial(id, userId, 'cambiar_estado', ESTADOS.PENDIENTE, ESTADOS.VALIDADO, 'Caso aprobado (validado)');
    res.json({ message: 'Caso aprobado (validado)' });
  } catch (err) {
    console.error(err); res.status(500).json({ error: 'Error en el servidor' });
  }
});

app.post('/apiv2/casos/:id/enviar-legacy', authMiddleware, async (req, res) => {
  const { role, area, id: userId } = req.user;
  if (![ROLES.COORD_AREA, ROLES.COORD_GENERAL].includes(role)) return res.status(403).json({ error: 'No autorizado' });
  const { id } = req.params;
  try {
    const c = await pool.query('SELECT area_id, estado FROM casos WHERE id = $1', [id]);
    if (!c.rows[0]) return res.status(404).json({ error: 'Caso no encontrado' });
    if (role === ROLES.COORD_AREA && c.rows[0].area_id !== area) return res.status(403).json({ error: 'Caso de otra área' });
    if (c.rows[0].estado !== ESTADOS.VALIDADO) return res.status(400).json({ error: 'Solo validado puede enviarse' });

    await pool.query(`UPDATE casos SET estado=$1, fecha_envio=NOW() WHERE id=$2`, [ESTADOS.ENVIADO, id]);
    await addHistorial(id, userId, 'cambiar_estado', ESTADOS.VALIDADO, ESTADOS.ENVIADO, 'Enviado a CG (legacy)');
    res.json({ message: 'Caso enviado a CG (legacy)' });
  } catch (err) {
    console.error(err); res.status(500).json({ error: 'Error en el servidor' });
  }
});


// ─────────────────────────────────────────────────────────────
// NUEVO: Guardar detalle + completar (opción B)
// PUT /apiv2/casos/:id/detalle-y-completar
// Body soporta: fecha_atencion, embarazo_semanas, hijos[], agresores[],
// tipos_violencia_ids[], ref_interna_ids[], ref_externa_ids[]
// ─────────────────────────────────────────────────────────────
app.put('/apiv2/casos/:id/detalle-y-completar', authMiddleware, async (req, res) => {
  const { role, area, id: userId } = req.user;
  if (role !== ROLES.COORD_AREA) return res.status(403).json({ error: 'Solo Coordinación de Área puede completar' });

  const casoId = Number(req.params.id);
  if (!Number.isFinite(casoId)) return res.status(400).json({ error: 'id inválido' });

  const body = req.body || {};
  const fechaAtencion    = body.fecha_atencion || null;
  const embarazoSemanas  = Number.isFinite(+body.embarazo_semanas) ? +body.embarazo_semanas : null;
  const hijos            = Array.isArray(body.hijos) ? body.hijos : [];
  const agresores        = Array.isArray(body.agresores) ? body.agresores : [];
  const tvIds            = __casosExt.toIntArray(body.tipos_violencia_ids);
  const refIntIds        = __casosExt.toIntArray(body.ref_interna_ids);
  const refExtIds        = __casosExt.toIntArray(body.ref_externa_ids);

  const client = await pool.connect();
  try {
    const c = await client.query('SELECT area_id, estado FROM casos WHERE id = $1', [casoId]);
    if (!c.rows[0]) return res.status(404).json({ error: 'Caso no encontrado' });
    if (c.rows[0].area_id !== area) return res.status(403).json({ error: 'Caso de otra área' });
    if (![ESTADOS.EN_PROGRESO, ESTADOS.PENDIENTE, ESTADOS.VALIDADO, ESTADOS.ENVIADO].includes(c.rows[0].estado)) {
      return res.status(400).json({ error: 'El caso debe estar al menos en progreso/pendiente/validado/enviado' });
    }

    await client.query('BEGIN');

    // Actualiza cabecera
    const upFields = [];
    const upVals   = [];
    let i = 1;
    if (fechaAtencion)         { upFields.push(`fecha_atencion = $${i++}`);    upVals.push(fechaAtencion); }
    if (embarazoSemanas != null){ upFields.push(`embarazo_semanas = $${i++}`); upVals.push(embarazoSemanas); }
    upFields.push(`estado = $${i++}`); upVals.push(ESTADOS.COMPLETADO);
    upFields.push(`fecha_cierre = NOW()`);

    await client.query(`UPDATE casos SET ${upFields.join(', ')} WHERE id = $${i}`, [...upVals, casoId]);

    // Detalle (idempotente)
    await __casosExt.replaceHijos(client, casoId, hijos);
    await __casosExt.replaceAgresores(client, casoId, agresores);
    await __casosExt.replacePivot(client, 'caso_violencias', 'tipo_violencia_id', casoId, tvIds);
    await __casosExt.replacePivot(client, 'caso_medios_agresion', 'medio_agresion_id', casoId, __casosExt.toIntArray(body.medios_agresion_ids || []));
    await __casosExt.replacePivot(client, 'caso_ref_interna', 'destino_id', casoId, refIntIds);
    await __casosExt.replacePivot(client, 'caso_ref_externa', 'destino_id', casoId, refExtIds);

    await client.query('COMMIT');
    await addHistorial(casoId, userId, 'cambiar_estado', c.rows[0].estado, ESTADOS.COMPLETADO, 'Detalle guardado y caso completado');

    // Devuelve el caso expandido
    const full = await __casosExt.fetchCasoCompleto(pool, casoId);
    res.json(full);
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch {}
    console.error(e);
    res.status(500).json({ error: 'No se pudo guardar el detalle y completar' });
  } finally {
    client.release();
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 📊 8) Informes (general + resumen mensual/anual)
// ─────────────────────────────────────────────────────────────────────────────

// Helpers locales SOLO para informes
const A_LOWER_NOACC = (s='') =>
  String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

const sumArr = (arr=[]) => (Array.isArray(arr)?arr:[]).reduce((a,b)=>a + Number(b?.total||0),0);
const isEmptyOrZeros = (arr=[]) => !Array.isArray(arr) || arr.length===0 || arr.every(x => Number(x?.total||0)===0);
const betterOf = (baseArr=[], fixArr=[]) => sumArr(fixArr) > sumArr(baseArr) ? fixArr : baseArr;

// Normaliza etiquetas de Área de residencia
function normalizeAreaResidenciaLabel(label=''){
  const raw = String(label || '').trim();
  const s = A_LOWER_NOACC(raw);
  if (s.includes('colonia') || s.startsWith('col ') || s.startsWith('col.')) return 'Colonia';
  if (s.includes('barrio popular')) return 'Barrio Popular';
  if (s.includes('asentamiento')) return 'Asentamiento';
  if (/\bzona(s)?\b/.test(s)) return 'Zonas';
  if (s.includes('municipio')) return 'Municipio';
  if (s.includes('aldea')) return 'Aldea';
  if (s.includes('caserio')) return 'Caserío';
  if (s.includes('canton')) return 'Cantón';
  return raw || 'Otros';
}
function normalizeAreaResidenciaList(list){
  const map = new Map();
  (Array.isArray(list)?list:[]).forEach(it=>{
    const lbl = normalizeAreaResidenciaLabel(it?.label);
    const v = Number(it?.total||0);
    map.set(lbl, (map.get(lbl)||0) + (Number.isFinite(v)?v:0));
  });
  return [...map.entries()].map(([label,total])=>({label,total}));
}

// Utilitario de consulta segura (devuelve null si falla)
async function safeQuery(sql, params){
  try{
    const { rows } = await pool.query(sql, params);
    return rows;
  }catch(err){
    console.error('[informes] consulta fallback falló:', err?.message || err);
    return null;
  }
}

// Tokens / mapping
const splitViolencias = (str) => String(str||'').split(',').map(s=>s.trim()).filter(Boolean);
function mapViolenciaToken(tok){
  const s = A_LOWER_NOACC(tok);
  if (s.includes('fisic')) return 'Física';
  if (s.includes('psicol')) return 'Psicológica';
  if (s.includes('verbal')) return 'Verbal';
  if (s.includes('econ')) return 'Económica';
  if (s.includes('patrimon')) return 'Patrimonial';
  if (s.includes('violaci')) return 'Violación sexual';
  if (s.includes('sexual')) return 'Sexual';
  if (s.includes('amenaza')) return 'Amenaza de muerte';
  if (s.includes('labor')) return 'Laboral';
  return 'Otros';
}
function mapHijoItem(item){
  if (typeof item === 'string'){
    const s = A_LOWER_NOACC(item);
    if (s.includes('femenin')) return 'Mujeres';
    if (s.includes('masculin')) return 'Hombres';
    if (s.includes('gest')) return 'Gestación';
    return 'Gestación';
  }
  const sx = A_LOWER_NOACC(item?.sexo || '');
  if (['f','femenino','mujer','femenina'].includes(sx)) return 'Mujeres';
  if (['m','masculino','hombre','masculina'].includes(sx)) return 'Hombres';
  return 'Gestación';
}
function mapAgresorToken(txt){
  const s = A_LOWER_NOACC(txt);
  if (s.includes('ex espos')) return 'Ex esposo';
  if (s.includes('espos')) return 'Esposo';
  if (s.includes('ex compan') || s.includes('ex compa')) return 'Ex compañero';
  if (s.includes('compan') || s.includes('compa') || s.includes('pareja')) return 'Compañero';
  if (s.includes('ex novi')) return 'Ex novio';
  if (s.includes('novi')) return 'Novio';
  if (s.includes('ex conviv')) return 'Ex conviviente';
  if (s.includes('conviv')) return 'Conviviente';
  if (s.includes('suegr')) return 'Suegro';
  if (s.includes('vecin')) return 'Vecino';
  if (s.includes('jef'))   return 'Jefe';
  if (s.includes('amig'))  return 'Amigo';
  if (s.includes('conocid')) return 'Conocido';
  if (s.includes('desconocid')) return 'Desconocido';
  if (s.includes('maestr') || s.includes('profe')) return 'Maestro';
  if (s.includes('padrast')) return 'Padrastro';
  if (s.includes('padre')) return 'Padre';
  if (s.includes('hermanastra')) return 'Hermanastra';
  if (s.includes('hermanastro')) return 'Hermanastro';
  if (s.includes('hermana')) return 'Hermana';
  if (s.includes('hermano')) return 'Hermano';
  if (s.includes('primo')) return 'Primo';
  if (s.includes('mujer')) return 'Mujer';
  if (s.includes('hija')) return 'Hija';
  if (s.includes('hijo')) return 'Hijo';
  if (s.includes('sobrin')) return 'Sobrino';
  if (s.includes('cunan') || s.includes('cuñad')) return 'Cuñado';
  if (s.includes('tio') || s.includes('tío')) return 'Tío';
  if (s.includes('yerno')) return 'Yerno';
  if (s.includes('nieto')) return 'Nieto';
  if (s.includes('abuelo')) return 'Abuelo';
  return 'Otros';
}
function mapRefExterna(s){
  const t = A_LOWER_NOACC(s);
  if (t.includes('juzgado') && t.includes('famil')) return 'Juzgado de familia';
  if (t.includes('juzgado') && t.includes('paz'))   return 'Juzgado de paz';
  if (t.includes('femicid')) return 'Juzgado de femicidio';
  if (t.includes('trabaj'))  return 'Ministerio de Trabajo';
  if (t.includes('ministerio p') || t.includes(' mp ') || t.includes('victima')) return 'Ministerio Público';
  if (t.includes('demi'))   return 'DEMI';
  if (t.includes('bufete')) return 'Bufete popular';
  if (t.includes('centro de salud') || t.includes('salud')) return 'Centro de Salud';
  if (t.includes('pnc'))    return 'PNC';
  if (t.includes('hospital')) return 'Hospital Nacional';
  return 'Otros';
}
function mapRefInterna(s){
  const t = A_LOWER_NOACC(s);
  if (t.includes('social'))   return 'Área Social';
  if (t.includes('psicol'))   return 'Área Psicológica';
  if (t.includes('medic'))    return 'Área Médica';
  if (t.includes('legal'))    return 'Área Legal';
  if (t.includes('alberg'))   return 'Albergue';
  return 'Otros';
}

/* ⬇️ Recalcula bloques leyendo desde tablas reales; si no hay datos,
      cae a la vista informe_coordinacion_general. */
async function computeMensualFixes(start, end, areaId){
  const vals = [start, end];
  let condAreaC = '';
  let condAreaV = '';
  if (areaId != null){
    vals.push(Number(areaId));
    condAreaC = ` AND c.area_id = $3 `;
    condAreaV = ` AND v.area_id = $3 `;
  }

  // 4) Hijas e hijos + Gestación (tabla hijos)
  let hijos = await safeQuery(`
    SELECT label, COUNT(*)::int AS total FROM (
      SELECT CASE
        WHEN lower(coalesce(h.sexo,'')) IN ('f','femenino','mujer','femenina') THEN 'Mujeres'
        WHEN lower(coalesce(h.sexo,'')) IN ('m','masculino','hombre','masculina') THEN 'Hombres'
        WHEN lower(coalesce(h.sexo,'')) LIKE 'gest%' THEN 'Gestación'
        ELSE 'Gestación'
      END AS label
      FROM hijos h
      JOIN casos c ON c.id = h.caso_id
      WHERE c.estado = 'completado'
        AND c.fecha_atencion::date >= $1
        AND c.fecha_atencion::date <= $2
        ${condAreaC}
    ) s
    GROUP BY label
  `, vals);

  if (!hijos || isEmptyOrZeros(hijos)){
    const rowsH = await safeQuery(`
      SELECT v.hijos
      FROM informe_coordinacion_general v
      WHERE v.estado = 'completado'
        AND v.fecha_atencion::date >= $1
        AND v.fecha_atencion::date <= $2
        ${condAreaV}
    `, vals) || [];
    const acc = { Mujeres:0, Hombres:0, 'Gestación':0 };
    for (const r of rowsH){
      if (!r?.hijos) continue;
      let arr = [];
      if (Array.isArray(r.hijos)) arr = r.hijos;
      else { try{ arr = JSON.parse(r.hijos); }catch{ arr = [r.hijos]; } }
      for (const it of (arr||[])){
        acc[mapHijoItem(it)]++;
      }
    }
    hijos = Object.entries(acc).map(([label,total])=>({label,total}));
  }

   // 13) Persona que agrede (tabla real "agresores" + catálogo relaciones_agresor)
  let agresores = await safeQuery(`
    SELECT COALESCE(ra.nombre, 'Otros') AS label, COUNT(*)::int AS total
    FROM agresores ag
    JOIN casos c ON c.id = ag.caso_id
    LEFT JOIN relaciones_agresor ra ON ra.id = ag.relacion_agresor_id
    WHERE c.estado = 'completado'
      AND c.fecha_atencion::date >= $1
      AND c.fecha_atencion::date <= $2
      ${condAreaC}
    GROUP BY COALESCE(ra.nombre, 'Otros')
  `, vals);


  // Fallback desde la vista (texto libre)
  if (!agresores || isEmptyOrZeros(agresores)){
    const vRows = await safeQuery(`
      SELECT v.persona_que_agrede AS txt
      FROM informe_coordinacion_general v
      WHERE v.estado='completado'
        AND v.fecha_atencion::date >= $1
        AND v.fecha_atencion::date <= $2
        ${condAreaV}
    `, vals) || [];
    const acc = new Map();
    for (const r of vRows){
      const tokens = String(r?.txt||'').split(/[,;|/\\\n\r]+/g).map(s=>s.trim()).filter(Boolean);
      for (const t of tokens){
        const label = mapAgresorToken(t);
        acc.set(label, (acc.get(label)||0)+1);
      }
    }
    agresores = [...acc.entries()].map(([label,total])=>({label,total}));
  }

  // 14) Tipos de violencia (puente)
  let tiposViolencia = await safeQuery(`
    SELECT label, COUNT(DISTINCT s.caso_id)::int AS total FROM (
      SELECT CASE
        WHEN lower(tv.nombre) LIKE '%fisic%'        THEN 'Física'
        WHEN lower(tv.nombre) LIKE '%psicol%'       THEN 'Psicológica'
        WHEN lower(tv.nombre) LIKE '%verbal%'       THEN 'Verbal'
        WHEN lower(tv.nombre) LIKE '%econ%'         THEN 'Económica'
        WHEN lower(tv.nombre) LIKE '%patrimon%'     THEN 'Patrimonial'
        WHEN lower(tv.nombre) LIKE '%violaci%'      THEN 'Violación sexual'
        WHEN lower(tv.nombre) LIKE '%sexual%'       THEN 'Sexual'
        WHEN lower(tv.nombre) LIKE '%amenaza%'      THEN 'Amenaza de muerte'
        WHEN lower(tv.nombre) LIKE '%labor%'        THEN 'Laboral'
        ELSE 'Otros'
      END AS label,
      cv.caso_id
      FROM caso_violencias cv
      JOIN tipos_violencia tv ON tv.id = cv.tipo_violencia_id
      JOIN casos c ON c.id = cv.caso_id
      WHERE c.estado='completado'
        AND c.fecha_atencion::date >= $1
        AND c.fecha_atencion::date <= $2
        ${condAreaC}
    ) s
    GROUP BY label
  `, vals);

  if (!tiposViolencia || isEmptyOrZeros(tiposViolencia)){
    const rowsTv = await safeQuery(`
      SELECT v.tipos_violencia
      FROM informe_coordinacion_general v
      WHERE v.estado='completado'
        AND v.fecha_atencion::date >= $1
        AND v.fecha_atencion::date <= $2
        ${condAreaV}
    `, vals) || [];
    const acc = new Map();
    for (const r of rowsTv){
      const tokens = splitViolencias(r?.tipos_violencia);
      for (const t of tokens){
        const cat = mapViolenciaToken(t);
        acc.set(cat, (acc.get(cat)||0)+1);
      }
    }
    tiposViolencia = [...acc.entries()].map(([label,total])=>({label,total}));
  }

  // 16) Referencia Externa (puente externa)
  let refExterna = await safeQuery(`
    SELECT label, COUNT(*)::int AS total FROM (
      SELECT CASE
        WHEN lower(dre.nombre) LIKE '%familia%' THEN 'Juzgado de familia'
        WHEN lower(dre.nombre) LIKE '%juzgado%' AND lower(dre.nombre) LIKE '%paz%' THEN 'Juzgado de paz'
        WHEN lower(dre.nombre) LIKE '%femicid%' THEN 'Juzgado de femicidio'
        WHEN lower(dre.nombre) LIKE '%trabaj%' THEN 'Ministerio de Trabajo'
        WHEN lower(dre.nombre) LIKE '%ministerio p%' OR lower(dre.nombre) LIKE '% mp %' OR lower(dre.nombre) LIKE '%victima%' OR lower(dre.nombre) LIKE '%víctima%' THEN 'Ministerio Público'
        WHEN lower(dre.nombre) LIKE '%demi%' THEN 'DEMI'
        WHEN lower(dre.nombre) LIKE '%bufete%' THEN 'Bufete popular'
        WHEN lower(dre.nombre) LIKE '%centro de salud%' OR lower(dre.nombre) LIKE '%salud%' THEN 'Centro de Salud'
        WHEN lower(dre.nombre) LIKE '%pnc%' THEN 'PNC'
        WHEN lower(dre.nombre) LIKE '%hospital%' THEN 'Hospital Nacional'
        ELSE 'Otros'
      END AS label
      FROM caso_ref_externa cre
      JOIN destinos_referencia_externa dre ON dre.id = cre.destino_id
      JOIN casos c ON c.id = cre.caso_id
      WHERE c.estado='completado'
        AND c.fecha_atencion::date >= $1
        AND c.fecha_atencion::date <= $2
        ${condAreaC}
    ) s
    GROUP BY label
  `, vals);

  if (!refExterna || isEmptyOrZeros(refExterna)){
    const vRows = await safeQuery(`
      SELECT v.a_donde_se_refiere AS txt
      FROM informe_coordinacion_general v
      WHERE v.estado='completado'
        AND v.fecha_atencion::date >= $1
        AND v.fecha_atencion::date <= $2
        AND lower(coalesce(v.interna_externa,'')) LIKE '%extern%'
        ${condAreaV}
    `, vals) || [];
    const acc = new Map();
    for (const r of vRows){
      const label = mapRefExterna(r?.txt || '');
      acc.set(label, (acc.get(label)||0)+1);
    }
    refExterna = [...acc.entries()].map(([label,total])=>({label,total}));
  }

  // 17) Referida a (Interno) (puente interna)
  let refInterna = await safeQuery(`
    SELECT label, COUNT(*)::int AS total FROM (
      SELECT CASE
        WHEN lower(dri.nombre) LIKE '%social%'   THEN 'Área Social'
        WHEN lower(dri.nombre) LIKE '%psicol%'   THEN 'Área Psicológica'
        WHEN lower(dri.nombre) LIKE '%médic%' OR lower(dri.nombre) LIKE '%medic%' THEN 'Área Médica'
        WHEN lower(dri.nombre) LIKE '%legal%'    THEN 'Área Legal'
        WHEN lower(dri.nombre) LIKE '%alberg%'   THEN 'Albergue'
        ELSE 'Otros'
      END AS label
      FROM caso_ref_interna cri
      JOIN destinos_referencia_interna dri ON dri.id = cri.destino_id
      JOIN casos c ON c.id = cri.caso_id
      WHERE c.estado='completado'
        AND c.fecha_atencion::date >= $1
        AND c.fecha_atencion::date <= $2
        ${condAreaC}
    ) s
    GROUP BY label
  `, vals);

  if (!refInterna || isEmptyOrZeros(refInterna)){
    const vRows = await safeQuery(`
      SELECT v.a_donde_se_refiere AS txt
      FROM informe_coordinacion_general v
      WHERE v.estado='completado'
        AND v.fecha_atencion::date >= $1
        AND v.fecha_atencion::date <= $2
        AND lower(coalesce(v.interna_externa,'')) LIKE '%intern%'
        ${condAreaV}
    `, vals) || [];
    const acc = new Map();
    for (const r of vRows){
      const label = mapRefInterna(r?.txt || '');
      acc.set(label, (acc.get(label)||0)+1);
    }
    refInterna = [...acc.entries()].map(([label,total])=>({label,total}));
  }

  return { hijos, agresores, tiposViolencia, refExterna, refInterna };
}




// ─────────────────────────────────────────────────────────────────────────────
// Resumen por área (cuentas por estado)  -> GET /apiv2/informes/resumen
// params: start=YYYY-MM-DD, end=YYYY-MM-DD, [area_id]
// ─────────────────────────────────────────────────────────────────────────────
async function hasColumn(table, column) {
  try {
    const { rows } = await pool.query(
      `SELECT 1
         FROM information_schema.columns
        WHERE table_name = $1 AND column_name = $2
        LIMIT 1`,
      [table, column]
    );
    return !!rows[0];
  } catch {
    return false;
  }
}

app.get('/apiv2/informes/resumen', authMiddleware, async (req, res) => {
  try {
    const { role, area } = req.user;            // del JWT
    const { start, end, area_id } = req.query;

    // Si tu esquema tiene created_at, úsalo como respaldo de fecha
    const hasCreated = await hasColumn('casos', 'created_at');
    const dateExpr = hasCreated
      ? `COALESCE(c.fecha_atencion, c.created_at)`
      : `c.fecha_atencion`;

    const where = [];
    const vals  = [];
    let i = 1;

    if (start) { where.push(`${dateExpr}::date >= $${i++}`); vals.push(start); }
    if (end)   { where.push(`${dateExpr}::date <= $${i++}`); vals.push(end); }

    // Alcance por rol
    if (Number(role) === ROLES.COORD_GENERAL) {
      if (area_id) { where.push(`c.area_id = $${i++}`); vals.push(Number(area_id)); }
    } else {
      where.push(`c.area_id = $${i++}`); vals.push(Number(area));
    }

    const whereSQL = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const sql = `
      SELECT
        a.id AS area_id,
        COALESCE(a.nombre, CONCAT('Área ', a.id)) AS area_nombre,
        COUNT(*) FILTER (WHERE c.estado <> 'borrador')::int      AS total,
        COUNT(*) FILTER (WHERE c.estado = 'pendiente')::int      AS pendientes,
        COUNT(*) FILTER (WHERE c.estado = 'en_progreso')::int    AS en_progreso,
        COUNT(*) FILTER (WHERE c.estado = 'validado')::int       AS validados,
        COUNT(*) FILTER (WHERE c.estado = 'enviado')::int        AS enviados,
        COUNT(*) FILTER (WHERE c.estado = 'completado')::int     AS completados
      FROM casos c
      LEFT JOIN areas a ON a.id = c.area_id
      ${whereSQL}
      GROUP BY a.id, a.nombre
      ORDER BY a.id;
    `;

    const { rows } = await pool.query(sql, vals);
    res.json(rows || []);
  } catch (err) {
    console.error('informes/resumen:', err);
    res.status(500).json({ error: 'No se pudo obtener el resumen' });
  }
});



// ─────────────────────────────────────────────────────────────────────────────
// General (JSON o CSV) — SOLO casos completados
app.get('/apiv2/informes/general', authMiddleware, async (req, res) => {
  try {
    const { role, area } = req.user;
    const { start, end, area_id, format } = req.query;

    const where = [];
    const vals  = [];
    let idx = 1;

    // Solo COMPLETADOS
    where.push(`estado = 'completado'`);

    if (start) { where.push(`fecha_atencion::date >= $${idx++}`); vals.push(start); }
    if (end)   { where.push(`fecha_atencion::date <= $${idx++}`); vals.push(end); }

    if (role === ROLES.COORD_GENERAL) {
      if (area_id) { where.push(`area_id = $${idx++}`); vals.push(Number(area_id)); }
    } else {
      where.push(`area_id = $${idx++}`); vals.push(area);
    }

    const sql = `
      SELECT
        no_orden,
        nombre_persona,
        cui,
        fecha_nacimiento,
        sexo,
        edad_anios AS edad,
        estado_civil,
        lugar_origen,
        escolaridad,
        motivo_consulta,
        tipos_violencia,
        fecha_atencion,
        fecha_atencion_dia,
        fecha_atencion_mes,
        fecha_atencion_anio,
        hijos,
        etnia,
        nacionalidad,
        residencia,
        quien_refiere,
        a_donde_se_refiere,
        interna_externa,
        persona_que_agrede,
        acciones,
        direccion,
        telefono,
        area_id,
        estado
      FROM informe_coordinacion_general
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY fecha_atencion DESC, no_orden DESC
    `;

    const { rows } = await pool.query(sql, vals);

    if ((format || '').toLowerCase() === 'csv') {
      const header = [
        'No. de orden','Nombre de la persona','CUI','Fecha de nacimiento',
        'Sexo','Edad (años)','Estado civil','Lugar de origen',
        'Escolaridad','Motivo de la consulta','Tipos de violencia',
        'Fecha atención','Día','Mes','Año',
        'Hijos (json)','Etnia','Nacionalidad','Residencia',
        'Quien refiere','A donde se refiere','Interna/Externa',
        'Persona que agrede','Acciones','Dirección','Teléfono','Área','Estado'
      ];
      const esc = (v) => {
        if (v === null || v === undefined) return '';
        const s = String(v);
        return /[",\n]/.test(s) ? `"${s.replace(/"/g,'""')}"` : s;
      };
      const toRow = (r) => [
        r.no_orden,
        r.nombre_persona,
        r.cui,
        r.fecha_nacimiento ? new Date(r.fecha_nacimiento).toISOString().slice(0,10) : '',
        r.sexo,
        r.edad,
        r.estado_civil,
        r.lugar_origen,
        r.escolaridad,
        r.motivo_consulta,
        r.tipos_violencia,
        r.fecha_atencion ? new Date(r.fecha_atencion).toISOString().slice(0,10) : '',
        r.fecha_atencion_dia,
        r.fecha_atencion_mes,
        r.fecha_atencion_anio,
        JSON.stringify(r.hijos || []),
        r.etnia,
        r.nacionalidad,
        r.residencia,
        r.quien_refiere,
        r.a_donde_se_refiere,
        r.interna_externa,
        r.persona_que_agrede,
        r.acciones,
        r.direccion,
        r.telefono,
        r.area_id,
        r.estado
      ].map(esc).join(',');

      const csv = [header.map(esc).join(','), ...rows.map(toRow)].join('\n');
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="informe_general.csv"');
      return res.send(csv);
    }

    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error generando informe' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 📥 Excel: INFORME GENERAL (formato “amarillo”) — SOLO COMPLETADOS
// GET /apiv2/informes/excel/general?start=YYYY-MM-DD&end=YYYY-MM-DD[&area_id]
// ─────────────────────────────────────────────────────────────────────────────
app.get('/apiv2/informes/excel/general', authMiddleware, async (req, res) => {
  try {
    const { role, area } = req.user;
    const { start, end, area_id } = req.query;

    const where = [];
    const vals  = [];
    let idx = 1;

    if (start) { where.push(`fecha_atencion::date >= $${idx++}`); vals.push(start); }
    if (end)   { where.push(`fecha_atencion::date <= $${idx++}`); vals.push(end); }

    if (role === ROLES.COORD_GENERAL) {
      if (area_id) { where.push(`area_id = $${idx++}`); vals.push(Number(area_id)); }
    } else {
      where.push(`area_id = $${idx++}`); vals.push(area);
    }

    where.push(`estado = 'completado'`);

    const sql = `
      SELECT
        no_orden,
        nombre_persona,
        cui,
        fecha_nacimiento,
        sexo,
        edad_anios   AS edad,
        estado_civil,
        lugar_origen,
        escolaridad,
        motivo_consulta,
        tipos_violencia,
        fecha_atencion,
        fecha_atencion_dia,
        fecha_atencion_mes,
        fecha_atencion_anio,
        hijos,
        etnia,
        nacionalidad,
        residencia,
        quien_refiere,
        a_donde_se_refiere,
        interna_externa,
        persona_que_agrede,
        acciones,
        direccion,
        telefono,
        area_id,
        estado
      FROM informe_coordinacion_general
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY fecha_atencion DESC, no_orden DESC
    `;
    let { rows } = await pool.query(sql, vals);

    // ── helpers de formato ───────────────────────────────────
    const sexHuman = (s='') => {
      const t = String(s).trim().toLowerCase();
      if (['f','fem','femenino','mujer','femenina'].includes(t)) return 'Mujer';
      if (['m','masc','masculino','hombre','masculina'].includes(t)) return 'Hombre';
      return s || '';
    };
    const parseHijos = (val) => {
      if (Array.isArray(val)) return val;
      if (val === null || val === undefined || val === '') return [];
      try { const x = JSON.parse(val); return Array.isArray(x) ? x : []; } catch { return []; }
    };
    const formatHijosCell = (val) => {
      const arr = parseHijos(val);
      if (!arr.length) return '';
      const lines = [];
      for (const h of arr) {
        const nombre = h?.nombre || '';
        const sexo   = sexHuman(h?.sexo || h?.genero || '');
        const edad   = (h?.edad_anios ?? h?.edad ?? '').toString().trim();
        const parts  = [];
        if (nombre) parts.push(nombre);
        if (sexo)   parts.push(sexo);
        if (edad)   parts.push(`Edad ${edad}`);
        const line  = parts.join(' – ');
        if (line) lines.push(line);
      }
      return lines.join('\n');
    };

    const _mapAgresorToken = (typeof mapAgresorToken === 'function')
      ? mapAgresorToken
      : (s) => {
          const t = String(s||'').toLowerCase();
          if (t.includes('ex espos')) return 'Ex esposo';
          if (t.includes('espos'))    return 'Esposo';
          if (t.includes('ex compan') || t.includes('ex compa')) return 'Ex compañero';
          if (t.includes('compan') || t.includes('compa') || t.includes('pareja')) return 'Compañero';
          if (t.includes('ex novi'))  return 'Ex novio';
          if (t.includes('novi'))     return 'Novio';
          if (t.includes('ex conviv'))return 'Ex conviviente';
          if (t.includes('conviv'))   return 'Conviviente';
          if (t.includes('suegr'))    return 'Suegro';
          if (t.includes('vecin'))    return 'Vecino';
          if (t.includes('jef'))      return 'Jefe';
          if (t.includes('amig'))     return 'Amigo';
          if (t.includes('conocid'))  return 'Conocido';
          if (t.includes('desconocid')) return 'Desconocido';
          if (t.includes('maestr')||t.includes('profe')) return 'Maestro';
          if (t.includes('padrast'))  return 'Padrastro';
          if (t.includes('padre'))    return 'Padre';
          if (t.includes('hermanastra')) return 'Hermanastra';
          if (t.includes('hermanastro')) return 'Hermanastro';
          if (t.includes('hermana'))  return 'Hermana';
          if (t.includes('hermano'))  return 'Hermano';
          if (t.includes('primo'))    return 'Primo';
          if (t.includes('mujer'))    return 'Mujer';
          if (t.includes('hija'))     return 'Hija';
          if (t.includes('hijo'))     return 'Hijo';
          if (t.includes('sobrin'))   return 'Sobrino';
          if (t.includes('cuñad')||t.includes('cuna')) return 'Cuñado';
          if (t.includes('tio')||t.includes('tío'))    return 'Tío';
          if (t.includes('yerno'))    return 'Yerno';
          if (t.includes('nieto'))    return 'Nieto';
          if (t.includes('abuelo'))   return 'Abuelo';
          return 'Otros';
        };

    const normalizeAgresoresCell = (txt) => {
      const s = String(txt || '').trim();
      if (!s) return '';
      const tokens = s.split(/[,;|/\\\n\r]+/g).map(t => t.trim()).filter(Boolean);
      const out = [];
      const seen = new Set();
      for (const t of tokens) {
        const label = _mapAgresorToken(t);
        if (!seen.has(label)) { seen.add(label); out.push(label); }
      }
      return out.join(', ');
    };

    // ⬇️ NUEVO: si el estado civil sugiere separación/divorcio, cambia Esposo→Ex esposo, etc.
    function adjustAggByEstado(labels, estadoCivil) {
      const sc = String(estadoCivil || '').toLowerCase();
      const separada = /divorciad|separad/.test(sc); // Divorciada / Separada
      if (!separada || !labels) return labels;
      return String(labels)
        .split(/\s*,\s*/)
        .map(l => {
          const t = l.trim();
          if (/^esposo$/i.test(t))       return 'Ex esposo';
          if (/^compañero$/i.test(t))    return 'Ex compañero';
          if (/^novio$/i.test(t))        return 'Ex novio';
          if (/^conviviente$/i.test(t))  return 'Ex conviviente';
          return t;
        })
        .filter(Boolean)
        .join(', ');
    }

    // ── Ocupación desde 'victimas' (por cui/dpi) ─────────────────────────────
    const cuiSet = new Set(rows.map(r => (r.cui ?? '').toString().trim()).filter(Boolean));
    let ocupacionById = new Map();
    if (cuiSet.size) {
      const vCols = await getTableCols('victimas');
      const idCol = vCols.has('cui') ? 'cui' : (vCols.has('dpi') ? 'dpi' : null);
      if (idCol) {
        const all = [...cuiSet];
        const chunk = 700;
        const pairs = [];
        for (let i = 0; i < all.length; i += chunk) {
          const slice = all.slice(i, i + chunk);
          // eslint-disable-next-line no-await-in-loop
          const r = await pool.query(
            `SELECT ${idCol}::text AS id_key, COALESCE(ocupacion,'') AS ocupacion
               FROM victimas
              WHERE ${idCol}::text = ANY($1::text[])`,
            [slice]
          );
          for (const row of r.rows) pairs.push([String(row.id_key || ''), row.ocupacion || '']);
        }
        ocupacionById = new Map(pairs);
      }
    }

    // ── FALLBACK "Persona que agrede": primero puente, luego tabla detalle ───
    const aggConds = [];
    const aggVals  = [];
    if (start) { aggVals.push(start); aggConds.push(`c.fecha_atencion::date >= $${aggVals.length}`); }
    if (end)   { aggVals.push(end);   aggConds.push(`c.fecha_atencion::date <= $${aggVals.length}`); }
    if (role === ROLES.COORD_GENERAL) {
      if (area_id) { aggVals.push(Number(area_id)); aggConds.push(`c.area_id = $${aggVals.length}`); }
    } else {
      aggVals.push(area); aggConds.push(`c.area_id = $${aggVals.length}`);
    }
    aggConds.push(`c.estado = 'completado'`);
    const aggWhere = aggConds.join(' AND ');

    const pivotSQL = `
      SELECT c.id AS caso_id, COALESCE(ra.nombre,'') AS rel
      FROM caso_agresores ca
      JOIN casos c ON c.id = ca.caso_id
      LEFT JOIN relaciones_agresor ra ON ra.id = ca.relacion_agresor_id
      WHERE ${aggWhere}
    `;
    const pivot = await pool.query(pivotSQL, aggVals);

    const agSQL = `
      SELECT c.id AS caso_id, COALESCE(ra.nombre,'') AS rel
      FROM agresores ag
      JOIN casos c ON c.id = ag.caso_id
      LEFT JOIN relaciones_agresor ra ON ra.id = ag.relacion_agresor_id
      WHERE ${aggWhere}
    `;
    const ag = await pool.query(agSQL, aggVals);

    const relByCaso = new Map(); // idCaso -> Set(labels)
    const pushRel = (cid, nombre) => {
      const key = String(cid);
      const set = relByCaso.get(key) || new Set();
      const label = _mapAgresorToken(nombre);
      set.add(label);
      relByCaso.set(key, set);
    };
    for (const r of pivot.rows) pushRel(r.caso_id, r.rel);
    for (const r of ag.rows)    pushRel(r.caso_id, r.rel);

    const personaByCaso = new Map(
      [...relByCaso.entries()].map(([k, set]) => [k, [...set].join(', ')])
    );

    // ── Excel ─────────────────────────────────────────────────
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Informe general');

    const headers = [
      'No. de orden','Nombre de la persona','CUI','Fecha de nacimiento',
      'Sexo','Edad (años)','Estado civil','Ocupación','Lugar de origen','Escolaridad',
      'Motivo de la consulta','Tipos de violencia','Fecha atención','Día','Mes','Año',
      'Hijas/Hijos','Etnia','Nacionalidad','Residencia',
      'Quién refiere','A dónde se refiere','Interna/Externa',
      'Persona que agrede','Acciones','Dirección','Teléfono','Área','Estado'
    ];
    ws.addRow(headers);
    ws.getRow(1).font = { bold: true };
    ws.getRow(1).alignment = { vertical: 'middle', horizontal: 'center' };
    ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFDE047' } };
    ws.columns = [
      { width: 12 }, { width: 32 }, { width: 16 }, { width: 14 },
      { width: 10 }, { width: 12 }, { width: 18 }, { width: 24 },
      { width: 24 }, { width: 22 }, { width: 26 }, { width: 28 },
      { width: 14 }, { width: 6 }, { width: 6 }, { width: 6 },
      { width: 30 }, { width: 14 }, { width: 16 }, { width: 18 },
      { width: 24 }, { width: 26 }, { width: 16 },
      { width: 26 }, { width: 20 }, { width: 26 }, { width: 16 }, { width: 8 }, { width: 12 },
    ];
    const fmtDate = (d) => d ? new Date(d).toISOString().slice(0,10) : '';

    rows.forEach(r => {
      const sexoNice   = sexHuman(r.sexo);
      const hijosNice  = formatHijosCell(r.hijos);

      // Primero, lo que venga en la vista. Si está vacío, usamos los mapas.
      let agresorNic = normalizeAgresoresCell(r.persona_que_agrede);
      if (!agresorNic) {
        agresorNic = personaByCaso.get(String(r.no_orden)) || '';
      }
      // ⬇️ NUEVO: “Esposo/Compañero/Novio/Conviviente” -> “Ex …” si Divorciada/Separada
      agresorNic = adjustAggByEstado(agresorNic, r.estado_civil);

      const idKey      = (r.cui ?? '').toString().trim();
      const ocupacion  = idKey ? (ocupacionById.get(idKey) || '') : '';

      const rr = ws.addRow([
        r.no_orden ?? '',
        r.nombre_persona ?? '',
        r.cui ?? '',
        fmtDate(r.fecha_nacimiento),
        sexoNice,
        r.edad ?? '',
        r.estado_civil ?? '',
        ocupacion,
        r.lugar_origen ?? '',
        r.escolaridad ?? '',
        r.motivo_consulta ?? '',
        r.tipos_violencia ?? '',
        fmtDate(r.fecha_atencion),
        r.fecha_atencion_dia ?? '',
        r.fecha_atencion_mes ?? '',
        r.fecha_atencion_anio ?? '',
        hijosNice,
        r.etnia ?? '',
        r.nacionalidad ?? '',
        r.residencia ?? '',
        r.quien_refiere ?? '',
        r.a_donde_se_refiere ?? '',
        r.interna_externa ?? '',
        agresorNic,
        r.acciones ?? '',
        r.direccion ?? '',
        r.telefono ?? '',
        r.area_id ?? '',
        r.estado ?? ''
      ]);

      rr.getCell(17).alignment = { wrapText: true, vertical: 'top' }; // Hijas/Hijos
      rr.getCell(24).alignment = { wrapText: true, vertical: 'top' }; // Persona que agrede
    });

    res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition','attachment; filename="informe_general.xlsx"');
    if (res.flushHeaders) res.flushHeaders();
    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error generando Excel (general)' });
  }
});

// Helpers anti-desfase (no colisionan con nada existente)
const monthNameES_SAFE = (dateLike) => {
  const [y, m, d] = String(dateLike || '').slice(0, 10).split('-').map(Number);
  const dt = new Date(y, (m || 1) - 1, d || 1); // <-- sin UTC, evita retroceso de mes
  const name = dt.toLocaleDateString('es-ES', { month: 'long' });
  return name.replace(/^\p{Letter}/u, c => c.toUpperCase());
};
const yearFromYMD_SAFE = (dateLike) => {
  const [y] = String(dateLike || '').slice(0, 10).split('-');
  return Number(y) || new Date().getFullYear();
};


// ─────────────────────────────────────────────────────────────────────────────
// 📥 Excel: REPORTE MENSUAL (formato exacto de tus fotos)
// GET /apiv2/informes/excel/mensual?year=YYYY&month=MM[&area_id]
//   o /apiv2/informes/excel/mensual?start=YYYY-MM-DD&end=YYYY-MM-DD[&area_id]
// ─────────────────────────────────────────────────────────────────────────────
app.get('/apiv2/informes/excel/mensual', authMiddleware, async (req, res) => {
  try {
    const { role, area } = req.user;
    let { start, end, area_id, year, month } = req.query;

    const today = new Date();
    if (!start || !end) {
      const y = Number(year) || today.getFullYear();
      const m = Number(month) || (today.getMonth()+1);
      const first = new Date(Date.UTC(y, m-1, 1));
      const last  = new Date(Date.UTC(y, m, 0));
      start = first.toISOString().slice(0,10);
      end   = last.toISOString().slice(0,10);
    }

    let pArea = null;
    if (role === ROLES.COORD_GENERAL) pArea = area_id ? Number(area_id) : null;
    else pArea = area;

    const { rows } = await pool.query(
      `SELECT caimus_reporte_mensual($1::date, $2::date, $3::integer) AS rep`,
      [start, end, pArea]
    );
    const rep = rows?.[0]?.rep;
    if (!rep) return res.status(404).json({ error:'Sin datos para el período.' });

    // Fallbacks: SIEMPRE calculamos y luego elegimos el mejor (mayor suma) para cada bloque
    const fixes = await computeMensualFixes(start, end, pArea);
    rep['4_hijas_hijos_gestacion'] = betterOf(rep['4_hijas_hijos_gestacion'], fixes.hijos);
    rep['13_persona_que_agrede']   = betterOf(rep['13_persona_que_agrede'],    fixes.agresores);
    rep['14_tipos_violencia']      = betterOf(rep['14_tipos_violencia'],       fixes.tiposViolencia);
    rep['16_referencia_externa']   = betterOf(rep['16_referencia_externa'],    fixes.refExterna);
    rep['17_referida_interno']     = betterOf(rep['17_referida_interno'],      fixes.refInterna);

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Resumen mensual');
    ws.columns = [{ width: 44 }, { width: 14 }];
    ws.eachRow(r => r.alignment = { vertical:'middle' });

    const mesBase = rep?.periodo?.desde || start;
    const mh = monthNameES_SAFE(mesBase);

    // Título
    const title = `Mujeres atendidas — ${mh} ${rep?.periodo?.anio ?? yearFromYMD_SAFE(mesBase)}`;
    ws.addRow([title]).font = { bold:true, size:14 };

    // 1) Mujeres atendidas (Total)
    putTable2(ws, '1) Mujeres Atendidas', mh, [['Total', rep['1_mujeres_atendidas']?.total ?? 0]]);

    // 2..17
    putTable2(ws, '2) Sexo', mh, normalizeByOrder(rep['2_sexo'], ORD_SEXO));
    putTable2(ws, '3) Edad de Mujeres Atendidas', mh, normalizeByOrder(rep['3_edad_rangos'], ORD_EDAD));
    putTable2(ws, '4) Hijas e hijos de las mujeres atendidas', mh, normalizeByOrder(rep['4_hijas_hijos_gestacion'], ORD_HIJOS));
    putTable2(ws, '5) Estado Civil', mh, normalizeByOrder(rep['5_estado_civil'], ORD_ESTADO_CIVIL));
    putTable2(ws, '6) Escolaridad', mh, normalizeByOrder(rep['6_escolaridad'], ORD_ESCOLARIDAD));
    putTable2(ws, '7) Ocupación de mujeres atendidas', mh, normalizeByOrder(rep['7_ocupacion'], ORD_OCUPACION));
    putTable2(ws, '8) Etnia de mujeres atendidas', mh, normalizeByOrder(rep['8_etnia'], ORD_ETNIA));
    putTable2(ws, '9) Nacionalidad', mh, normalizeByOrder(rep['9_nacionalidad'], ORD_NACIONALIDAD));
    putProcedencia(ws, mh, rep['10_procedencia']);
    putTable2(ws, '11) Área de residencia', mh, normalizeByOrder(
      normalizeAreaResidenciaList(rep['11_area_residencia']),
      ORD_AREA_RESIDENCIA
    ));
    putTable2(ws, '12) Lugar de donde refieren', mh, normalizeByOrder(rep['12_lugar_refieren'], ORD_REFIEREN));
    putTable2(ws, '13) Persona que agrede', mh, normalizeByOrder(rep['13_persona_que_agrede'], ORD_QUIEN_AGREDE));
    putTable2(ws, '14) Tipos de violencia', mh, normalizeByOrder(rep['14_tipos_violencia'], ORD_TIPOS_VIOLENCIA));
    putTable2(ws, '15) Motivo de la visita', mh, normalizeByOrder(rep['15_motivo_visita'], ORD_MOTIVO_VISITA));
    putTable2(ws, '16) Referencia Externa', mh, normalizeByOrder(rep['16_referencia_externa'], ORD_REF_EXTERNA));
    putTable2(ws, '17) Referida a (Interno)', mh, normalizeByOrder(rep['17_referida_interno'], ORD_REF_INTERNA));

    res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition','attachment; filename="reporte_mensual.xlsx"');
    if (res.flushHeaders) res.flushHeaders();
    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error:'Error generando Excel (mensual)' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 📥 Excel: REPORTE ANUAL (por mes + Totales)
// GET /apiv2/informes/excel/anual?year=YYYY[&area_id]
// ─────────────────────────────────────────────────────────────────────────────
app.get('/apiv2/informes/excel/anual', authMiddleware, async (req, res) => {
  try {
    const { role, area } = req.user;
    const y = Number(req.query.year) || (new Date()).getFullYear();
    const pArea = (role === ROLES.COORD_GENERAL) ? (req.query.area_id ? Number(req.query.area_id) : null) : area;

    const { rows } = await pool.query(
      `SELECT caimus_reporte_anual($1::integer, $2::integer) AS rep`,
      [y, pArea]
    );
    const rep = rows?.[0]?.rep;
    if (!rep) return res.status(404).json({ error:'Sin datos para el año.' });

    // Parche: totales del año (si vienen flojos) con un único cómputo del año completo
    const yStart = `${y}-01-01`;
    const yEnd   = `${y}-12-31`;
    const fixYear = await computeMensualFixes(yStart, yEnd, pArea);
    rep.totales['4_hijas_hijos_gestacion'] = betterOf(rep.totales?.['4_hijas_hijos_gestacion'], fixYear.hijos);
    rep.totales['13_persona_que_agrede']   = betterOf(rep.totales?.['13_persona_que_agrede'],    fixYear.agresores);
    rep.totales['14_tipos_violencia']      = betterOf(rep.totales?.['14_tipos_violencia'],       fixYear.tiposViolencia);
    rep.totales['16_referencia_externa']   = betterOf(rep.totales?.['16_referencia_externa'],    fixYear.refExterna);
    rep.totales['17_referida_interno']     = betterOf(rep.totales?.['17_referida_interno'],      fixYear.refInterna);

    const wb = new ExcelJS.Workbook();

    const paintMonthSheet = async (sheetName, data) => {
      // Parche mensual: recalc y elegir el mejor
      const dStart = data?.periodo?.desde || `${y}-01-01`;
      const dEnd   = data?.periodo?.hasta || `${y}-01-31`;
      const fx = await computeMensualFixes(dStart, dEnd, pArea);
      data['4_hijas_hijos_gestacion'] = betterOf(data['4_hijas_hijos_gestacion'], fx.hijos);
      data['13_persona_que_agrede']   = betterOf(data['13_persona_que_agrede'],    fx.agresores);
      data['14_tipos_violencia']      = betterOf(data['14_tipos_violencia'],       fx.tiposViolencia);
      data['16_referencia_externa']   = betterOf(data['16_referencia_externa'],    fx.refExterna);
      data['17_referida_interno']     = betterOf(data['17_referida_interno'],      fx.refInterna);

      const ws = wb.addWorksheet(sheetName);
      ws.columns = [{ width:44 },{ width:14 }];
      const mh = monthNameES_SAFE(data?.periodo?.desde || `${y}-01-01`);
      ws.addRow([`Mujeres atendidas — ${mh} ${y}`]).font = { bold:true, size:14 };

      putTable2(ws, '1) Mujeres Atendidas', mh, [['Total', data['1_mujeres_atendidas']?.total ?? 0]]);
      putTable2(ws, '2) Sexo', mh, normalizeByOrder(data['2_sexo'], ORD_SEXO));
      putTable2(ws, '3) Edad de Mujeres Atendidas', mh, normalizeByOrder(data['3_edad_rangos'], ORD_EDAD));
      putTable2(ws, '4) Hijas e hijos de las mujeres atendidas', mh, normalizeByOrder(data['4_hijas_hijos_gestacion'], ORD_HIJOS));
      putTable2(ws, '5) Estado Civil', mh, normalizeByOrder(data['5_estado_civil'], ORD_ESTADO_CIVIL));
      putTable2(ws, '6) Escolaridad', mh, normalizeByOrder(data['6_escolaridad'], ORD_ESCOLARIDAD));
      putTable2(ws, '7) Ocupación de mujeres atendidas', mh, normalizeByOrder(data['7_ocupacion'], ORD_OCUPACION));
      putTable2(ws, '8) Etnia de mujeres atendidas', mh, normalizeByOrder(data['8_etnia'], ORD_ETNIA));
      putTable2(ws, '9) Nacionalidad', mh, normalizeByOrder(data['9_nacionalidad'], ORD_NACIONALIDAD));
      putProcedencia(ws, mh, data['10_procedencia']);
      putTable2(ws, '11) Área de residencia', mh, normalizeByOrder(
        normalizeAreaResidenciaList(data['11_area_residencia']),
        ORD_AREA_RESIDENCIA
      ));
      putTable2(ws, '12) Lugar de donde refieren', mh, normalizeByOrder(data['12_lugar_refieren'], ORD_REFIEREN));
      putTable2(ws, '13) Persona que agrede', mh, normalizeByOrder(data['13_persona_que_agrede'], ORD_QUIEN_AGREDE));
      putTable2(ws, '14) Tipos de violencia', mh, normalizeByOrder(data['14_tipos_violencia'], ORD_TIPOS_VIOLENCIA));
      putTable2(ws, '15) Motivo de la visita', mh, normalizeByOrder(data['15_motivo_visita'], ORD_MOTIVO_VISITA));
      putTable2(ws, '16) Referencia Externa', mh, normalizeByOrder(data['16_referencia_externa'], ORD_REF_EXTERNA));
      putTable2(ws, '17) Referida a (Interno)', mh, normalizeByOrder(data['17_referida_interno'], ORD_REF_INTERNA));
    };

    // Hojas por mes
    for (const [i, mRep] of (rep.mensuales || []).entries()){
      if (!mRep || !mRep['1_mujeres_atendidas']) continue;
      const mesNum = mRep.periodo?.mes_num || (i+1);
      const mesNom = (mRep.periodo?.mes_nombre || '').trim() || `Mes ${mesNum}`;
      // eslint-disable-next-line no-await-in-loop
      await paintMonthSheet(`${String(mesNum).padStart(2,'0')} - ${mesNom}`, mRep);
    }

    // Totales del año
    const tot = rep.totales;
    const wsT = wb.addWorksheet('Totales (año)');
    wsT.columns = [{ width:44 },{ width:14 }];
    wsT.addRow([`Mujeres atendidas — Totales ${y}`]).font = { bold:true, size:14 };

    const mhT = 'Totales';
    putTable2(wsT, '1) Mujeres Atendidas', mhT, [['Total', tot['1_mujeres_atendidas']?.total ?? 0]]);
    putTable2(wsT, '2) Sexo', mhT, normalizeByOrder(tot['2_sexo'], ORD_SEXO));
    putTable2(wsT, '3) Edad de Mujeres Atendidas', mhT, normalizeByOrder(tot['3_edad_rangos'], ORD_EDAD));
    putTable2(wsT, '4) Hijas e hijos de las mujeres atendidas', mhT, normalizeByOrder(tot['4_hijas_hijos_gestacion'], ORD_HIJOS));
    putTable2(wsT, '5) Estado Civil', mhT, normalizeByOrder(tot['5_estado_civil'], ORD_ESTADO_CIVIL));
    putTable2(wsT, '6) Escolaridad', mhT, normalizeByOrder(tot['6_escolaridad'], ORD_ESCOLARIDAD));
    putTable2(wsT, '7) Ocupación de mujeres atendidas', mhT, normalizeByOrder(tot['7_ocupacion'], ORD_OCUPACION));
    putTable2(wsT, '8) Etnia de mujeres atendidas', mhT, normalizeByOrder(tot['8_etnia'], ORD_ETNIA));
    putTable2(wsT, '9) Nacionalidad', mhT, normalizeByOrder(tot['9_nacionalidad'], ORD_NACIONALIDAD));
    putProcedencia(wsT, mhT, tot['10_procedencia']);
    putTable2(wsT, '11) Área de residencia', mhT, normalizeByOrder(
      normalizeAreaResidenciaList(tot['11_area_residencia']),
      ORD_AREA_RESIDENCIA
    ));
    putTable2(wsT, '12) Lugar de donde refieren', mhT, normalizeByOrder(tot['12_lugar_refieren'], ORD_REFIEREN));
    putTable2(wsT, '13) Persona que agrede', mhT, normalizeByOrder(tot['13_persona_que_agrede'], ORD_QUIEN_AGREDE));
    putTable2(wsT, '14) Tipos de violencia', mhT, normalizeByOrder(tot['14_tipos_violencia'], ORD_TIPOS_VIOLENCIA));
    putTable2(wsT, '15) Motivo de la visita', mhT, normalizeByOrder(tot['15_motivo_visita'], ORD_MOTIVO_VISITA));
    putTable2(wsT, '16) Referencia Externa', mhT, normalizeByOrder(tot['16_referencia_externa'], ORD_REF_EXTERNA));
    putTable2(wsT, '17) Referida a (Interno)', mhT, normalizeByOrder(tot['17_referida_interno'], ORD_REF_INTERNA));

    res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="reporte_anual_${y}.xlsx"`);
    if (res.flushHeaders) res.flushHeaders();
    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error:'Error generando Excel (anual)' });
  }
});

// al iniciar tu server (antes de las rutas)
app.set('etag', false);
app.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

// ─────────────────────────────────────────────────────────────────────────────
// Server
// ─────────────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`HTTP server listening on :${PORT}`);
});
