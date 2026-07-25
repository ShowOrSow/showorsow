// MonumentArt — tiny flat-illustration covers for the floating hero cards.
// Inline SVG silhouettes (Indonesian landmarks + generic venues): crisp at any
// size, zero external images, and they inherit each card's gradient sky.
// White-on-gradient keeps them readable on every cover colour.
export function MonumentArt({ variant }: { variant: MonumentVariant }) {
  const art = ART[variant];
  return (
    <svg
      viewBox="0 0 160 72"
      className="h-full w-full"
      preserveAspectRatio="xMidYMax meet"
      aria-hidden
    >
      {art}
    </svg>
  );
}

export type MonumentVariant =
  | "monas"
  | "borobudur"
  | "skyline"
  | "stadium"
  | "mountain"
  | "gate";

const white = "rgba(255,255,255,0.85)";
const soft = "rgba(255,255,255,0.55)";

const ART: Record<MonumentVariant, React.ReactNode> = {
  // Monas — plinth, obelisk, flame.
  monas: (
    <g>
      <rect x="0" y="64" width="160" height="8" fill={soft} />
      <rect x="66" y="56" width="28" height="8" fill={white} />
      <rect x="72" y="50" width="16" height="6" fill={soft} />
      <polygon points="76,50 84,50 81,16 79,16" fill={white} />
      <ellipse cx="80" cy="13" rx="3.4" ry="4.4" fill="rgba(255,224,130,0.95)" />
      <rect x="20" y="60" width="18" height="4" fill={soft} />
      <rect x="122" y="60" width="18" height="4" fill={soft} />
    </g>
  ),
  // Borobudur — three stupa tiers.
  borobudur: (
    <g>
      <rect x="0" y="64" width="160" height="8" fill={soft} />
      <rect x="28" y="56" width="104" height="8" fill={white} />
      <rect x="42" y="48" width="76" height="8" fill={soft} />
      <rect x="56" y="40" width="48" height="8" fill={white} />
      <path d="M80 18 C 72 18 66 26 66 40 L 94 40 C 94 26 88 18 80 18 Z" fill={white} />
      <rect x="78" y="12" width="4" height="7" fill={white} />
      <path d="M46 34 a7 9 0 0 1 14 0 l0 6 -14 0 Z" fill={soft} />
      <path d="M100 34 a7 9 0 0 1 14 0 l0 6 -14 0 Z" fill={soft} />
    </g>
  ),
  // City skyline — blocks + antenna.
  skyline: (
    <g>
      <rect x="0" y="64" width="160" height="8" fill={soft} />
      <rect x="16" y="34" width="18" height="30" fill={soft} />
      <rect x="38" y="22" width="22" height="42" fill={white} />
      <rect x="64" y="40" width="14" height="24" fill={soft} />
      <rect x="82" y="14" width="24" height="50" fill={white} />
      <rect x="92" y="6" width="3" height="8" fill={white} />
      <rect x="110" y="30" width="16" height="34" fill={soft} />
      <rect x="130" y="44" width="14" height="20" fill={white} />
      <g fill="rgba(255,224,130,0.9)">
        <rect x="44" y="28" width="3" height="3" />
        <rect x="52" y="36" width="3" height="3" />
        <rect x="88" y="22" width="3" height="3" />
        <rect x="97" y="34" width="3" height="3" />
        <rect x="88" y="46" width="3" height="3" />
      </g>
    </g>
  ),
  // Stadium — GBK-ish roof ring.
  stadium: (
    <g>
      <rect x="0" y="64" width="160" height="8" fill={soft} />
      <path d="M20 64 C 20 34 140 34 140 64 Z" fill={soft} />
      <path d="M30 64 C 30 42 130 42 130 64 Z" fill="rgba(255,255,255,0.25)" />
      <path d="M14 50 C 60 20 100 20 146 50" stroke={white} strokeWidth="5" fill="none" strokeLinecap="round" />
      <rect x="76" y="24" width="8" height="3" fill="rgba(255,224,130,0.9)" />
    </g>
  ),
  // Mountain — twin peaks + sun.
  mountain: (
    <g>
      <rect x="0" y="64" width="160" height="8" fill={soft} />
      <circle cx="126" cy="20" r="9" fill="rgba(255,224,130,0.9)" />
      <polygon points="12,64 58,22 96,64" fill={white} />
      <polygon points="50,64 96,30 148,64" fill={soft} />
      <polygon points="52,28 58,22 66,30 58,36" fill="rgba(255,255,255,0.95)" />
    </g>
  ),
  // Temple gate (candi bentar) — split gateway.
  gate: (
    <g>
      <rect x="0" y="64" width="160" height="8" fill={soft} />
      <path d="M52 64 L52 30 C52 22 58 16 66 14 L70 14 L70 64 Z" fill={white} />
      <path d="M108 64 L108 30 C108 22 102 16 94 14 L90 14 L90 64 Z" fill={white} />
      <rect x="48" y="60" width="26" height="4" fill={soft} />
      <rect x="86" y="60" width="26" height="4" fill={soft} />
      <rect x="55" y="24" width="12" height="3" fill={soft} />
      <rect x="93" y="24" width="12" height="3" fill={soft} />
    </g>
  ),
};
