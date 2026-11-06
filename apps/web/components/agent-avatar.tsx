import { memo } from "react";

/**
 * Flat vector characters, one per agent: a solid irregular silhouette in one colour with
 * simple white-and-black eyes. No gradients, shadows, mouths or props. The shape and colour
 * are chosen deterministically from the agent's name, so every list shows the same face.
 */

export type AvatarShape = "blob" | "burst" | "stack" | "round" | "flower" | "cloud" | "splat" | "spiky" | "arch" | "star";

export const AVATAR_SHAPES: AvatarShape[] = ["blob", "burst", "stack", "round", "flower", "cloud", "splat", "spiky", "arch", "star"];

export const AVATAR_COLORS = [
  "#e2b23a", // mustard
  "#f0752c", // orange
  "#ee7cc2", // pink
  "#ef5a2a", // red-orange
  "#9b6fda", // purple
  "#4e6fe4", // cobalt blue
  "#3cb5b1", // teal
  "#3f9e4f", // green
  "#e8418f", // magenta
  "#2a7fc8", // deep blue
];

function hash(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

export function characterFor(seed: string): { shape: AvatarShape; color: string } {
  const h = hash(seed.toLowerCase());
  return { shape: AVATAR_SHAPES[h % AVATAR_SHAPES.length], color: AVATAR_COLORS[(h >>> 8) % AVATAR_COLORS.length] };
}

/** Points of a star-like polygon, alternating between two radii. */
function spikes(count: number, outer: number, inner: number, wobble = 0): string {
  const pts: string[] = [];
  for (let i = 0; i < count * 2; i++) {
    const r = (i % 2 === 0 ? outer : inner) + (wobble ? ((i * 7) % 5) * wobble : 0);
    const a = (Math.PI * i) / count - Math.PI / 2;
    pts.push(`${(50 + r * Math.cos(a)).toFixed(1)},${(50 + r * Math.sin(a)).toFixed(1)}`);
  }
  return pts.join(" ");
}

/** Circles around a ring, for petals and scallops. */
function ring(count: number, radius: number, size: number, rx = size, ry = size, offset = 0): { cx: number; cy: number; rx: number; ry: number; rot: number }[] {
  const out = [];
  for (let i = 0; i < count; i++) {
    const a = (2 * Math.PI * i) / count - Math.PI / 2 + offset;
    out.push({ cx: 50 + radius * Math.cos(a), cy: 50 + radius * Math.sin(a), rx, ry, rot: (a * 180) / Math.PI + 90 });
  }
  return out;
}

const BURST = spikes(9, 48, 27, 1.2);
const SPIKY = spikes(16, 46, 36);
const STAR = spikes(5, 48, 26);
const PETALS = ring(7, 27, 16, 13, 19);
const SCALLOPS = ring(8, 29, 15);

function Body({ shape, color }: { shape: AvatarShape; color: string }) {
  switch (shape) {
    case "blob":
      return (
        <path
          fill={color}
          d="M46 6c12-2 20 6 30 10s18 12 18 24-10 16-10 28-8 22-22 24-20-8-32-10S6 72 6 56s8-18 14-28S34 8 46 6z"
        />
      );
    case "burst":
      return <polygon fill={color} points={BURST} />;
    case "stack":
      return (
        <g fill={color}>
          <rect x="12" y="10" width="76" height="30" rx="15" />
          <rect x="6" y="35" width="88" height="30" rx="15" />
          <rect x="14" y="60" width="74" height="30" rx="15" />
        </g>
      );
    case "round":
      return <rect fill={color} x="6" y="6" width="88" height="88" rx="40" />;
    case "flower":
      return (
        <g fill={color}>
          {PETALS.map((p, i) => (
            <ellipse key={i} cx={p.cx} cy={p.cy} rx={p.rx} ry={p.ry} transform={`rotate(${p.rot} ${p.cx} ${p.cy})`} />
          ))}
          <circle cx="50" cy="50" r="24" />
        </g>
      );
    case "cloud":
      return (
        <g fill={color}>
          {SCALLOPS.map((p, i) => (
            <circle key={i} cx={p.cx} cy={p.cy} r={p.rx} />
          ))}
          <circle cx="50" cy="50" r="31" />
        </g>
      );
    case "splat":
      return (
        <g fill={color}>
          <path d="M50 10c10 0 14 8 24 10s18 10 16 22-12 12-14 22-6 22-18 24-16-8-26-10S8 70 8 58s8-14 10-24S40 10 50 10z" />
          <circle cx="78" cy="22" r="11" />
          <circle cx="20" cy="30" r="9" />
          <circle cx="76" cy="80" r="9" />
          <circle cx="26" cy="82" r="10" />
        </g>
      );
    case "spiky":
      return <polygon fill={color} points={SPIKY} />;
    case "arch":
      return <path fill={color} d="M14 94V48C14 24 30 10 50 10s36 14 36 38v46H66V58a16 16 0 0 0-32 0v36z" />;
    case "star":
      return <polygon fill={color} points={STAR} />;
  }
}

function Eyes({ shape }: { shape: AvatarShape }) {
  // Each silhouette gets eyes that sit naturally in its mass.
  const y = shape === "arch" ? 40 : shape === "star" ? 52 : 50;
  const gap = shape === "stack" || shape === "round" ? 11 : 12;
  const sleepy = shape === "round";
  if (sleepy) {
    return (
      <g>
        <ellipse cx={50 - gap} cy={y} rx="10" ry="7" fill="#fff" />
        <ellipse cx={50 + gap} cy={y} rx="10" ry="7" fill="#fff" />
        <path d={`M${40 - gap} ${y} h20 a10 7 0 0 1 -20 0z`} fill="#111" />
        <path d={`M${40 + gap} ${y} h20 a10 7 0 0 1 -20 0z`} fill="#111" />
      </g>
    );
  }
  const narrow = shape === "burst" || shape === "splat" || shape === "star";
  return (
    <g>
      <ellipse cx={50 - gap} cy={y} rx={narrow ? 7 : 8.5} ry={narrow ? 11 : 9} fill="#fff" />
      <ellipse cx={50 + gap} cy={y} rx={narrow ? 7 : 8.5} ry={narrow ? 11 : 9} fill="#fff" />
      <ellipse cx={50 - gap + 2.5} cy={y + 0.5} rx={narrow ? 3.4 : 4.4} ry={narrow ? 7.5 : 5.6} fill="#111" />
      <ellipse cx={50 + gap + 2.5} cy={y + 0.5} rx={narrow ? 3.4 : 4.4} ry={narrow ? 7.5 : 5.6} fill="#111" />
    </g>
  );
}

export const AgentAvatar = memo(function AgentAvatar({
  seed,
  shape,
  color,
  size = 56,
  className = "",
  title,
}: {
  /** Usually the agent's ENS name; picks the character when shape/colour are not given. */
  seed: string;
  shape?: AvatarShape;
  color?: string;
  size?: number | string;
  className?: string;
  title?: string;
}) {
  const auto = characterFor(seed);
  const s = shape ?? auto.shape;
  const c = color ?? auto.color;
  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      className={`shrink-0 ${className}`}
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
    >
      {title && <title>{title}</title>}
      <Body shape={s} color={c} />
      <Eyes shape={s} />
    </svg>
  );
});
