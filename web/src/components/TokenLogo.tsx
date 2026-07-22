import Image from "next/image";
import { cn } from "@/lib/utils";

// Official token marks, shipped under /public/brand/tokens:
//   cbtc.svg — BitSafe's cBTC token logo (cbtc-faucet.bitsafe.finance)
//   ceth.png — onRails' cETH mark (ceth.network)
// SHOW is our own demo token, so it reuses the ShowOrSow mark. Anything else
// (a token added purely by config) degrades to an initial chip — the app is
// token-agnostic by design and must never break on an unknown instrument.
const MARKS: Record<string, { src: string; alt: string; bg: string }> = {
  cbtc: { src: "/brand/tokens/cbtc.svg", alt: "cBTC", bg: "bg-[#D4EDF4]" },
  ceth: { src: "/brand/tokens/ceth.png", alt: "cETH", bg: "bg-[#E7F09C]" },
  show: { src: "/brand/logo-mark.png", alt: "SHOW", bg: "bg-accent" },
};

export function tokenMark(label: string | undefined) {
  return MARKS[(label ?? "").toLowerCase()];
}

/**
 * Round token chip. `size` is the pixel diameter — 16/20 inline with text,
 * 24–32 for cards, 40+ for the vault header.
 */
export function TokenLogo({
  label,
  size = 20,
  className,
}: {
  label: string | undefined;
  size?: number;
  className?: string;
}) {
  const mark = tokenMark(label);
  const shell = cn(
    "inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full",
    className,
  );

  if (!mark) {
    return (
      <span
        className={cn(shell, "bg-accent font-semibold text-refund")}
        style={{ width: size, height: size, fontSize: Math.round(size * 0.5) }}
        aria-hidden
      >
        {(label ?? "?").charAt(0).toUpperCase()}
      </span>
    );
  }

  return (
    <span
      className={cn(shell, mark.bg)}
      style={{ width: size, height: size }}
      title={mark.alt}
    >
      <Image
        src={mark.src}
        alt={mark.alt}
        width={size}
        height={size}
        // unoptimized: next/image's optimizer rejects SVG with a 400 unless
        // dangerouslyAllowSVG is enabled, which would blank the cBTC mark. These
        // are 16–40px chrome icons, so there is nothing for the optimizer to win.
        unoptimized
        // eager: a token mark is identity, not decoration — lazy-loading a 20px
        // icon buys nothing and makes the amount next to it pop in late.
        loading="eager"
        className="h-full w-full object-contain"
      />
    </span>
  );
}

/** Logo + label, the standard way to name a token inline. */
export function TokenBadge({
  label,
  size = 18,
  className,
}: {
  label: string | undefined;
  size?: number;
  className?: string;
}) {
  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      <TokenLogo label={label} size={size} />
      <span className="font-medium">{label}</span>
    </span>
  );
}
