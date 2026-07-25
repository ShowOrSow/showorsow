"use client";

import { motion } from "motion/react";
import { TokenLogo } from "../TokenLogo";
import { Ticket, MapPin } from "lucide-react";

// FloatingCards — the Luma-landing anatomy: mini event cards scattered around
// a centered headline, drifting gently. Ours carry the one thing Luma's don't:
// a stake chip. Pure CSS/motion, no images; hidden below lg (they'd collide
// with the headline on small screens).
type Card = {
  title: string;
  venue: string;
  stake: string;
  token: string;
  gradient: string;
  className: string; // absolute position
  delay: number;
  rotate: number;
};

const CARDS: Card[] = [
  {
    title: "Canton Builders Night",
    venue: "Jakarta",
    stake: "0.005",
    token: "cBTC",
    gradient: "from-emerald-400/90 via-teal-300/80 to-sky-300/80",
    className: "left-[3%] top-[12%]",
    delay: 0,
    rotate: -6,
  },
  {
    title: "Web3 Dev Workshop",
    venue: "Bandung",
    stake: "0.1",
    token: "cETH",
    gradient: "from-sky-400/90 via-indigo-300/80 to-violet-300/80",
    className: "left-[7%] bottom-[10%]",
    delay: 0.8,
    rotate: 5,
  },
  {
    title: "Founder Dinner",
    venue: "SCBD",
    stake: "0.01",
    token: "cBTC",
    gradient: "from-amber-300/90 via-orange-300/80 to-rose-300/80",
    className: "left-[16%] top-[46%]",
    delay: 1.6,
    rotate: -3,
  },
  {
    title: "Hackathon Demo Day",
    venue: "Online",
    stake: "0.05",
    token: "cETH",
    gradient: "from-violet-400/90 via-fuchsia-300/80 to-pink-300/80",
    className: "right-[4%] top-[10%]",
    delay: 0.4,
    rotate: 6,
  },
  {
    title: "Community Meetup",
    venue: "Yogyakarta",
    stake: "0.005",
    token: "cBTC",
    gradient: "from-teal-400/90 via-emerald-300/80 to-lime-300/80",
    className: "right-[14%] top-[48%]",
    delay: 2.0,
    rotate: -5,
  },
  {
    title: "Run Club Sunday",
    venue: "GBK",
    stake: "0.002",
    token: "cBTC",
    gradient: "from-rose-300/90 via-pink-300/80 to-fuchsia-300/80",
    className: "right-[6%] bottom-[9%]",
    delay: 1.2,
    rotate: 4,
  },
];

export function FloatingCards() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 hidden lg:block">
      {CARDS.map((c) => (
        <motion.div
          key={c.title}
          className={`absolute w-40 ${c.className}`}
          style={{ rotate: c.rotate }}
          initial={{ opacity: 0, y: 18, scale: 0.94 }}
          animate={{ opacity: 1, y: [0, -9, 0], scale: 1 }}
          transition={{
            opacity: { duration: 0.7, delay: c.delay * 0.25 },
            scale: { duration: 0.7, delay: c.delay * 0.25 },
            y: {
              duration: 7 + c.delay,
              repeat: Infinity,
              ease: "easeInOut",
              delay: c.delay,
            },
          }}
        >
          <div className="overflow-hidden rounded-2xl border border-line bg-surface shadow-[0_16px_40px_-20px_rgba(16,24,32,0.35)]">
            <div
              className={`flex h-[4.5rem] items-center justify-center bg-gradient-to-br ${c.gradient}`}
            >
              <Ticket className="size-6 rotate-12 text-white/70" />
            </div>
            <div className="flex flex-col gap-1 p-2.5">
              <p className="truncate text-xs font-semibold text-text">{c.title}</p>
              <p className="flex items-center gap-1 text-[10px] text-muted-foreground">
                <MapPin className="size-2.5 shrink-0" />
                {c.venue}
              </p>
              <span className="mt-0.5 inline-flex w-fit items-center gap-1 rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-medium text-refund">
                <TokenLogo label={c.token} size={11} />
                {c.stake} {c.token}
              </span>
            </div>
          </div>
        </motion.div>
      ))}
    </div>
  );
}
