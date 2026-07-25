"use client";

// Aurora — React Bits background (reactbits.dev/backgrounds/aurora), CSS
// variant: slow drifting colour fields behind a fine dot grid. Kept pure CSS
// (no WebGL) so it costs nothing on the hero's first paint and degrades to a
// flat wash under prefers-reduced-motion. Emerald-led to match the brand.
export function Aurora({ className = "" }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={`pointer-events-none absolute inset-0 overflow-hidden ${className}`}
    >
      <div className="aurora-blob aurora-a" />
      <div className="aurora-blob aurora-b" />
      <div className="aurora-blob aurora-c" />
      {/* Grain + grid keep the gradients from looking like a plain blur. */}
      <div className="dot-grid absolute inset-0 opacity-[0.55]" />
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-ground" />
    </div>
  );
}
