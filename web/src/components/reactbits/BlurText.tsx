"use client";

import { motion } from "motion/react";
import { useMemo } from "react";

// BlurText — from React Bits (reactbits.dev/text-animations/blur-text), the
// motion variant: each word enters blurred + offset, then settles. Trimmed to
// the props we use; animation values match the upstream default preset.
export function BlurText({
  text,
  delay = 0,
  stepDelay = 0.06,
  className = "",
  as: Tag = "span",
}: {
  text: string;
  /** seconds before the first word starts */
  delay?: number;
  /** seconds between successive words */
  stepDelay?: number;
  className?: string;
  as?: "span" | "p" | "h1" | "h2";
}) {
  const words = useMemo(() => text.split(" "), [text]);
  return (
    <Tag className={className}>
      {words.map((w, i) => (
        <motion.span
          key={`${w}-${i}`}
          className="inline-block will-change-transform"
          initial={{ filter: "blur(10px)", opacity: 0, y: 12 }}
          animate={{ filter: "blur(0px)", opacity: 1, y: 0 }}
          transition={{ duration: 0.45, delay: delay + i * stepDelay, ease: "easeOut" }}
        >
          {w}
          {i < words.length - 1 ? " " : ""}
        </motion.span>
      ))}
    </Tag>
  );
}
