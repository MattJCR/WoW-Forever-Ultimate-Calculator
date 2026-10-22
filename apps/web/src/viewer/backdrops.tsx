// Escenas de fondo del probador: una por ciudad o zona inicial de cada raza, dibujadas aquí (SVG propio, sin arte del juego).
// Lienzo 400×600; el horizonte está en y≈470 (donde se plantan los pies del personaje) y el SVG se recorta por los lados
// (`xMidYMax slice`), así que lo importante va centrado.
import type { ReactNode } from "react";

export interface Backdrop {
  /** Raza a la que acompaña por defecto (ChrRaces.ID); también es su id en el enlace. */
  id: number;
  /** Lugar que dibuja (clave de traducción). */
  name: string;
  art: () => ReactNode;
}

const Sky = ({ id, stops }: { id: string; stops: [number, string][] }) => (
  <>
    <defs>
      <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
        {stops.map(([o, c]) => <stop key={o} offset={o} stopColor={c} />)}
      </linearGradient>
    </defs>
    <rect width="400" height="600" fill={`url(#${id})`} />
  </>
);

const Ground = ({ id, top, bottom }: { id: string; top: string; bottom: string }) => (
  <>
    <defs>
      <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor={top} />
        <stop offset="1" stopColor={bottom} />
      </linearGradient>
    </defs>
    <rect y="470" width="400" height="130" fill={`url(#${id})`} />
  </>
);

const Cloud = ({ x, y, s = 1, o = 0.7, c = "#fff" }: { x: number; y: number; s?: number; o?: number; c?: string }) => (
  <g transform={`translate(${x} ${y}) scale(${s})`} fill={c} opacity={o}>
    <ellipse cx="0" cy="0" rx="46" ry="12" />
    <ellipse cx="-18" cy="-9" rx="24" ry="14" />
    <ellipse cx="14" cy="-12" rx="28" ry="16" />
  </g>
);

/** Almenas: una fila de dientes de muralla sobre un muro. */
const Crenels = ({ x, y, w, fill, n = 9 }: { x: number; y: number; w: number; fill: string; n?: number }) => {
  const step = w / n;
  return <>{Array.from({ length: Math.ceil(n / 2) }, (_, i) => <rect key={i} x={x + i * 2 * step} y={y - 8} width={step} height="9" fill={fill} />)}</>;
};

const Windows = ({ xs, y, w = 5, h = 9, fill }: { xs: number[]; y: number; w?: number; h?: number; fill: string }) => (
  <>{xs.map((x) => <rect key={x} x={x} y={y} width={w} height={h} rx={w / 2} fill={fill} />)}</>
);

/** Engranaje: disco con dientes. */
const Gear = ({ cx, cy, r, teeth = 10, fill, hole }: { cx: number; cy: number; r: number; teeth?: number; fill: string; hole: string }) => (
  <g>
    {Array.from({ length: teeth }, (_, i) => (
      <rect key={i} x={cx - r * 0.14} y={cy - r * 1.22} width={r * 0.28} height={r * 0.4} fill={fill} transform={`rotate(${(360 / teeth) * i} ${cx} ${cy})`} />
    ))}
    <circle cx={cx} cy={cy} r={r} fill={fill} />
    <circle cx={cx} cy={cy} r={r * 0.42} fill={hole} />
  </g>
);

const Palm = ({ x, y, s = 1, lean = 1 }: { x: number; y: number; s?: number; lean?: number }) => (
  <g transform={`translate(${x} ${y}) scale(${s * lean} ${s})`}>
    <path d="M0 0 Q6 -50 -4 -100" stroke="#5a3b22" strokeWidth="7" fill="none" strokeLinecap="round" />
    {[-70, -35, 0, 35, 70].map((a) => (
      <path key={a} d="M-4 -100 Q18 -122 40 -104 Q16 -108 -4 -100" fill="#2f7a3c" transform={`rotate(${a} -4 -100)`} />
    ))}
  </g>
);

/** Islas flotantes con torres y estandartes (las dos escenas de Cielonato). */
const Islands = ({ rock, tower, roof, banner, glow }: { rock: string; tower: string; roof: string; banner: string; glow: string }) => {
  const isle = (x: number, y: number, s: number) => (
    <g transform={`translate(${x} ${y}) scale(${s})`} key={`${x}-${y}`}>
      <path d="M-70 0 Q0 -14 70 0 Q50 30 18 60 Q0 80 -6 90 Q-20 50 -48 28 Q-64 14 -70 0Z" fill={rock} />
      <ellipse cx="0" cy="-2" rx="70" ry="9" fill="#7fae5a" />
      <rect x="-30" y="-48" width="14" height="46" fill={tower} />
      <polygon points="-34,-48 -23,-78 -12,-48" fill={roof} />
      <rect x="-4" y="-66" width="18" height="64" fill={tower} />
      <polygon points="-8,-66 5,-102 18,-66" fill={roof} />
      <rect x="22" y="-40" width="12" height="38" fill={tower} />
      <polygon points="19,-40 28,-64 37,-40" fill={roof} />
      <rect x="5" y="-102" width="2" height="10" fill={banner} />
      <path d="M6 -100 L24 -94 L6 -88Z" fill={banner} />
      <circle cx="5" cy="-54" r="3" fill={glow} />
    </g>
  );
  return (
    <>
      <polygon points="150,0 210,0 120,470 40,470" fill="#fff" opacity="0.09" />
      <polygon points="260,0 300,0 330,470 240,470" fill="#fff" opacity="0.07" />
      {isle(300, 190, 0.55)}
      {isle(90, 250, 0.7)}
      {isle(200, 360, 0.95)}
    </>
  );
};

const STORMWIND = () => (
  <>
    <Sky id="bd1" stops={[[0, "#5b8fd0"], [0.7, "#b9d6f0"], [1, "#f3e9c8"]]} />
    <circle cx="320" cy="110" r="60" fill="#fff6d0" opacity="0.35" />
    <circle cx="320" cy="110" r="34" fill="#fff6d0" opacity="0.9" />
    <Cloud x={90} y={90} s={1.1} />
    <Cloud x={260} y={190} s={0.8} o={0.55} />
    <polygon points="0,440 70,350 130,410 200,330 280,420 340,370 400,430 400,480 0,480" fill="#7f9bc4" />
    <rect x="50" y="340" width="300" height="140" fill="#aeb3c0" />
    <Crenels x={50} y={340} w={300} fill="#aeb3c0" n={20} />
    <rect x="160" y="250" width="80" height="230" fill="#c3c7d2" />
    <Crenels x={160} y={250} w={80} fill="#c3c7d2" n={8} />
    <polygon points="156,250 200,186 244,250" fill="#2f56a6" />
    <rect x="64" y="285" width="46" height="195" fill="#b7bcc8" />
    <polygon points="58,285 87,228 116,285" fill="#2f56a6" />
    <rect x="290" y="285" width="46" height="195" fill="#b7bcc8" />
    <polygon points="284,285 313,228 342,285" fill="#2f56a6" />
    <path d="M178 480 V420 Q200 390 222 420 V480Z" fill="#46506a" />
    <rect x="186" y="280" width="28" height="64" fill="#2a4fa0" />
    <rect x="198" y="280" width="4" height="64" fill="#e3b94a" />
    <rect x="76" y="320" width="22" height="46" fill="#2a4fa0" />
    <rect x="302" y="320" width="22" height="46" fill="#2a4fa0" />
    <Windows xs={[96, 120, 258, 280, 175, 217]} y={380} fill="#3a4660" />
    <Windows xs={[84, 300]} y={300} fill="#3a4660" />
    <Ground id="bg1" top="#8a8678" bottom="#5d5a50" />
  </>
);

const IRONFORGE = () => (
  <>
    <Sky id="bd3" stops={[[0, "#5d3b3e"], [0.55, "#c9814a"], [1, "#f1c48a"]]} />
    <polygon points="0,470 70,270 130,340 200,170 280,330 330,250 400,470" fill="#8d8f9e" />
    <polygon points="200,170 160,260 190,240 205,275 230,235 248,265" fill="#f4f6fb" />
    <polygon points="70,270 40,330 70,318 92,340 110,312" fill="#f4f6fb" />
    <polygon points="330,250 300,320 328,305 348,325 365,290" fill="#f4f6fb" />
    <polygon points="200,170 250,300 150,300" fill="#6e7080" opacity="0.35" />
    <defs>
      <radialGradient id="bd3g" cx="0.5" cy="0.8" r="0.7">
        <stop offset="0" stopColor="#ffd27a" />
        <stop offset="1" stopColor="#c4501f" />
      </radialGradient>
    </defs>
    <path d="M130 470 V360 Q200 270 270 360 V470Z" fill="#4a4a58" />
    <path d="M148 470 V368 Q200 292 252 368 V470Z" fill="url(#bd3g)" />
    <rect x="120" y="350" width="22" height="120" fill="#5c5c6c" />
    <rect x="258" y="350" width="22" height="120" fill="#5c5c6c" />
    {[130, 269].map((x) => <circle key={x} cx={x} cy={344} r="9" fill="#ffb347" />)}
    <Windows xs={[80, 100, 296, 316]} y={400} w={7} h={11} fill="#ffb347" />
    <Ground id="bg3" top="#dfe3ec" bottom="#9ca6b8" />
    <ellipse cx="60" cy="480" rx="60" ry="9" fill="#fff" opacity="0.5" />
    <ellipse cx="350" cy="486" rx="70" ry="9" fill="#fff" opacity="0.5" />
  </>
);

const DARNASSUS = () => (
  <>
    <Sky id="bd4" stops={[[0, "#232a6c"], [0.6, "#6c58b8"], [1, "#b69be0"]]} />
    <circle cx="92" cy="110" r="50" fill="#c8ecff" opacity="0.25" />
    <circle cx="92" cy="110" r="30" fill="#e6f7ff" />
    {[[220, 60], [300, 120], [350, 50], [180, 150], [370, 180], [40, 200]].map(([x, y]) => <circle key={`${x}${y}`} cx={x} cy={y} r="1.6" fill="#fff" opacity="0.8" />)}
    <path d="M165 470 Q172 380 186 300 Q192 250 188 210 L214 210 Q210 250 216 300 Q230 380 240 470Z" fill="#6b4a63" />
    <path d="M186 300 Q150 300 120 330 M214 300 Q250 300 285 335" stroke="#6b4a63" strokeWidth="12" fill="none" strokeLinecap="round" />
    <ellipse cx="200" cy="170" rx="150" ry="85" fill="#4e3a8c" />
    <ellipse cx="120" cy="215" rx="92" ry="55" fill="#6a4aa8" />
    <ellipse cx="290" cy="210" rx="96" ry="58" fill="#6a4aa8" />
    <ellipse cx="200" cy="150" rx="110" ry="55" fill="#8a66c8" />
    <ellipse cx="170" cy="130" rx="60" ry="26" fill="#a98ae0" opacity="0.7" />
    {[[110, 240], [150, 262], [250, 258], [292, 238], [200, 232], [70, 210], [330, 215]].map(([x = 0, y = 0]) => <g key={`${x}${y}`}><line x1={x} y1={y - 22} x2={x} y2={y} stroke="#cfe9ff" strokeWidth="1" opacity="0.6" /><circle cx={x} cy={y} r="4" fill="#9fe6ff" /></g>)}
    <Ground id="bg4" top="#3f7a7c" bottom="#244a52" />
    {[40, 90, 320, 365].map((x) => <path key={x} d={`M${x} 480 q4 -22 10 0`} stroke="#7fe0d0" strokeWidth="2" fill="none" opacity="0.7" />)}
  </>
);

const GNOMEREGAN = () => (
  <>
    <Sky id="bd7" stops={[[0, "#3a6f7c"], [0.65, "#79b5bd"], [1, "#d6e3d0"]]} />
    <Gear cx={90} cy={150} r={52} teeth={12} fill="#5f8a96" hole="#3a6f7c" />
    <Gear cx={330} cy={110} r={38} teeth={10} fill="#5f8a96" hole="#3a6f7c" />
    <Gear cx={250} cy={230} r={64} teeth={14} fill="#c2824a" hole="#79b5bd" />
    <rect x="40" y="340" width="320" height="130" fill="#6d8f98" />
    <rect x="70" y="290" width="70" height="180" fill="#8aa7ad" />
    <path d="M70 290 Q105 240 140 290Z" fill="#c2824a" />
    <rect x="270" y="300" width="60" height="170" fill="#8aa7ad" />
    <path d="M270 300 Q300 255 330 300Z" fill="#c2824a" />
    <rect x="165" y="260" width="70" height="210" fill="#a5bdc1" />
    <rect x="158" y="252" width="84" height="12" fill="#c2824a" />
    <rect x="45" y="378" width="310" height="12" fill="#c2824a" />
    <rect x="45" y="430" width="310" height="8" fill="#c2824a" />
    <rect x="130" y="350" width="10" height="120" fill="#c2824a" />
    <rect x="262" y="360" width="10" height="110" fill="#c2824a" />
    <Windows xs={[82, 102, 122, 284, 304, 178, 196, 214]} y={320} w={8} h={12} fill="#ffd27a" />
    {[[120, 270, 14], [300, 280, 12], [200, 235, 16]].map(([x = 0, y = 0, r = 0]) => <g key={`${x}`} fill="#fff" opacity="0.55"><circle cx={x} cy={y} r={r} /><circle cx={x + 10} cy={(y ?? 0) - 14} r={(r ?? 0) * 0.8} /></g>)}
    <Ground id="bg7" top="#8a9aa0" bottom="#566a72" />
    <path d="M0 500 H400 M0 540 H400 M100 470 V600 M230 470 V600 M330 470 V600" stroke="#6d7f86" strokeWidth="2" opacity="0.6" />
  </>
);

const SKY_ALLIANCE = () => (
  <>
    <Sky id="bd95" stops={[[0, "#7fb0e8"], [0.6, "#d4e6f6"], [1, "#f7e8b8"]]} />
    <circle cx="300" cy="90" r="50" fill="#fff4c0" opacity="0.8" />
    <Islands rock="#9a8f84" tower="#f1ead2" roof="#d9a93a" banner="#3a6ac0" glow="#fff0a0" />
    <Cloud x={70} y={450} s={1.4} o={0.85} />
    <Cloud x={330} y={470} s={1.3} o={0.85} />
    <Ground id="bg95" top="#fbf2d4" bottom="#d8c68a" />
  </>
);

const ORGRIMMAR = () => (
  <>
    <Sky id="bd2" stops={[[0, "#c8553a"], [0.6, "#f0a15c"], [1, "#fad79a"]]} />
    <circle cx="90" cy="170" r="46" fill="#ffe7a8" opacity="0.8" />
    <polygon points="0,470 0,330 60,300 110,350 160,300 190,340 230,290 290,340 340,300 400,340 400,470" fill="#8a3a28" />
    <polygon points="60,300 110,350 90,470 20,470" fill="#6c2a1e" opacity="0.5" />
    <rect x="40" y="380" width="320" height="90" fill="#6b3f24" />
    {Array.from({ length: 16 }, (_, i) => <polygon key={i} points={`${44 + i * 20},380 ${54 + i * 20},346 ${64 + i * 20},380`} fill="#5a3320" />)}
    <rect x="110" y="260" width="34" height="210" fill="#7a4a2c" />
    <rect x="256" y="260" width="34" height="210" fill="#7a4a2c" />
    {[127, 273].map((x) => <g key={x}><polygon points={`${x - 20},262 ${x},206 ${x + 20},262`} fill="#5a3320" /><polygon points={`${x - 22},300 ${x - 40},276 ${x - 16},288`} fill="#e8dcc0" /><polygon points={`${x + 22},300 ${x + 40},276 ${x + 16},288`} fill="#e8dcc0" /></g>)}
    <path d="M144 470 V350 Q200 290 256 350 V470Z" fill="#3a2418" />
    <rect x="160" y="300" width="80" height="22" fill="#7a4a2c" />
    <circle cx="200" cy="311" r="9" fill="#b3261e" />
    <rect x="88" y="300" width="14" height="60" fill="#b3261e" />
    <rect x="298" y="300" width="14" height="60" fill="#b3261e" />
    <Ground id="bg2" top="#c98652" bottom="#8a5230" />
  </>
);

const UNDERCITY = () => (
  <>
    <Sky id="bd5" stops={[[0, "#4f5e6a"], [0.6, "#8fa08a"], [1, "#c9d1a8"]]} />
    <circle cx="310" cy="100" r="40" fill="#e8efd0" opacity="0.8" />
    <circle cx="300" cy="92" r="34" fill="#5f6e68" opacity="0.35" />
    <polygon points="0,470 0,380 40,350 70,380 110,330 150,380 200,320 250,380 290,340 330,380 370,350 400,380 400,470" fill="#4a5a4e" />
    {[[60, 210], [140, 170], [300, 190], [350, 240]].map(([x, y]) => (
      <g key={`${x}`}>
        <rect x={(x ?? 0) - 12} y={y} width="24" height={470 - (y ?? 0)} fill="#5b4e63" />
        <polygon points={`${(x ?? 0) - 15},${y} ${x},${(y ?? 0) - 56} ${(x ?? 0) + 15},${y}`} fill="#493d52" />
        <Windows xs={[(x ?? 0) - 3]} y={(y ?? 0) + 30} w={6} h={14} fill="#a8f08a" />
      </g>
    ))}
    <rect x="165" y="270" width="70" height="200" fill="#62566b" />
    <polygon points="160,270 200,196 240,270" fill="#493d52" />
    <polygon points="196,196 200,170 204,196" fill="#493d52" />
    <Windows xs={[180, 195, 210, 222]} y={310} w={7} h={16} fill="#a8f08a" />
    <path d="M178 470 V410 Q200 380 222 410 V470Z" fill="#2a2432" />
    <path d="M30 470 V430 q-10 0 -10 -12 q0 -14 10 -14 q10 0 10 14 q0 12 -10 12" fill="#8c8f9c" transform="translate(20 8)" />
    <path d="M330 470 V436 q-9 0 -9 -11 q0 -12 9 -12 q9 0 9 12 q0 11 -9 11" fill="#8c8f9c" transform="translate(10 4)" />
    <ellipse cx="200" cy="470" rx="230" ry="26" fill="#bde6a8" opacity="0.28" />
    <Ground id="bg5" top="#667a58" bottom="#3a4a36" />
  </>
);

const THUNDER_BLUFF = () => (
  <>
    <Sky id="bd6" stops={[[0, "#5aa9e6"], [0.65, "#bfe0f0"], [1, "#f7f0c8"]]} />
    <circle cx="90" cy="100" r="56" fill="#fff6c8" opacity="0.4" />
    <circle cx="90" cy="100" r="32" fill="#fff6c8" />
    <Cloud x={280} y={110} s={1.2} />
    <Cloud x={190} y={190} s={0.7} o={0.55} />
    <polygon points="0,470 0,380 60,370 90,300 300,300 330,370 400,380 400,470" fill="#c79858" />
    <polygon points="90,300 60,370 110,470 40,470 0,380 60,370" fill="#a87a42" opacity="0.55" />
    <rect x="86" y="296" width="214" height="14" fill="#d7ad6c" />
    <polygon points="60,370 330,370 360,470 20,470" fill="#b88a4a" />
    {[[130, 296], [200, 292], [270, 296]].map(([x, y]) => (
      <g key={`${x}`}>
        <polygon points={`${(x ?? 0) - 28},${y} ${x},${(y ?? 0) - 52} ${(x ?? 0) + 28},${y}`} fill="#f0e2c0" />
        <polygon points={`${(x ?? 0) - 6},${y} ${x},${(y ?? 0) - 22} ${(x ?? 0) + 6},${y}`} fill="#7a4a2c" />
        <line x1={x} y1={(y ?? 0) - 52} x2={x} y2={(y ?? 0) - 66} stroke="#7a4a2c" strokeWidth="2" />
      </g>
    ))}
    <rect x="30" y="330" width="9" height="130" fill="#7a4a2c" />
    <circle cx="34.5" cy="330" r="12" fill="#c9503a" />
    <rect x="360" y="340" width="9" height="120" fill="#7a4a2c" />
    <circle cx="364.5" cy="340" r="12" fill="#3a9aa8" />
    <path d="M0 480 Q100 450 200 470 T400 460 V600 H0Z" fill="#86b04c" />
    <Ground id="bg6" top="#86b04c" bottom="#4e7a30" />
  </>
);

const ECHO_ISLES = () => (
  <>
    <Sky id="bd8" stops={[[0, "#2a8fa0"], [0.55, "#f0b866"], [1, "#fbd9a0"]]} />
    <circle cx="200" cy="360" r="70" fill="#ffe3a0" opacity="0.55" />
    <circle cx="200" cy="370" r="40" fill="#fff0c0" />
    <rect y="400" width="400" height="70" fill="#2a9aa8" />
    <rect y="400" width="400" height="6" fill="#fff" opacity="0.35" />
    <polygon points="0,470 0,330 60,300 120,340 170,320 230,350 290,310 350,330 400,320 400,470" fill="#1f6a3a" />
    <polygon points="0,470 0,380 70,355 140,390 220,370 300,395 400,365 400,470" fill="#2c8a48" />
    <Palm x={60} y={470} s={1.1} />
    <Palm x={345} y={470} s={1.2} lean={-1} />
    <Palm x={30} y={470} s={0.8} lean={-1} />
    {[110, 290].map((x) => (
      <g key={x}>
        <rect x={x - 7} y={400} width="14" height="70" fill="#7a4a2c" />
        <polygon points={`${x - 16},400 ${x},372 ${x + 16},400`} fill="#e04a3a" />
        <circle cx={x} cy={414} r="5" fill="#f4e0b0" />
        <rect x={x - 5} y={430} width="10" height="3" fill="#f4e0b0" />
      </g>
    ))}
    {[170, 232].map((x) => <g key={x}><polygon points={`${x - 30},455 ${x},410 ${x + 30},455`} fill="#c9a050" /><rect x={x - 18} y={455} width="36" height="15" fill="#8a5a30" /></g>)}
    <Ground id="bg8" top="#e0b87c" bottom="#b88a50" />
  </>
);

const SKY_HORDE = () => (
  <>
    <Sky id="bd96" stops={[[0, "#8a3a5a"], [0.55, "#f0845a"], [1, "#fbd08a"]]} />
    <circle cx="110" cy="130" r="58" fill="#ffd9a0" opacity="0.5" />
    <circle cx="110" cy="130" r="34" fill="#fff0c0" />
    <Islands rock="#6e4a40" tower="#d9b890" roof="#a8281e" banner="#c4281e" glow="#ffd070" />
    <Cloud x={80} y={450} s={1.4} o={0.7} c="#ffd0b0" />
    <Cloud x={330} y={470} s={1.3} o={0.7} c="#ffd0b0" />
    <Ground id="bg96" top="#d9a070" bottom="#8a5a40" />
  </>
);

/** Todas las escenas; el id es el de la raza a la que acompañan. */
export const BACKDROPS: Backdrop[] = [
  { id: 1, name: "Ventormenta", art: STORMWIND },
  { id: 3, name: "Forjaz", art: IRONFORGE },
  { id: 4, name: "Darnassus", art: DARNASSUS },
  { id: 7, name: "Gnomeregan", art: GNOMEREGAN },
  { id: 95, name: "Islas flotantes (Alianza)", art: SKY_ALLIANCE },
  { id: 2, name: "Orgrimmar", art: ORGRIMMAR },
  { id: 5, name: "Entrañas", art: UNDERCITY },
  { id: 6, name: "Cima del Trueno", art: THUNDER_BLUFF },
  { id: 8, name: "Islas del Eco", art: ECHO_ISLES },
  { id: 96, name: "Islas flotantes (Horda)", art: SKY_HORDE },
];

/** Fondo SVG de una escena (a todo el recuadro), o nada si el id no existe (0 = liso). */
export function BackdropArt({ id }: { id: number }) {
  const b = BACKDROPS.find((x) => x.id === id);
  if (!b) return null;
  return (
    <svg className="avatar-backdrop" viewBox="0 0 400 600" preserveAspectRatio="xMidYMax slice" aria-hidden="true" focusable="false">
      {b.art()}
    </svg>
  );
}
