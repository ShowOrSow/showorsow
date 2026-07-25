"use client";

import { motion } from "motion/react";
import { TokenLogo } from "../TokenLogo";
import Image from "next/image";
import { MapPin } from "lucide-react";

// FloatingCards — the Luma-landing anatomy: mini event cards scattered around
// a centered headline, drifting gently. Ours carry the one thing Luma's don't:
// a stake chip. Pure CSS/motion, no images; hidden below lg (they'd collide
// with the headline on small screens).
type Card = {
  title: string;
  venue: string;
  stake: string;
  token: string;
  photo: string;
  alt: string;
  className: string; // absolute position
  delay: number;
  rotate: number;
};

const CARDS: Card[] = [
  {
    title: "Canton Builders Night",
    photo: "/brand/events/monas.jpg",
    alt: "Monas, Jakarta",
    venue: "Jakarta",
    stake: "0.005",
    token: "cBTC",
    className: "left-[3%] top-[12%]",
    delay: 0,
    rotate: -6,
  },
  {
    title: "Web3 Dev Workshop",
    photo: "/brand/events/bandung.jpg",
    alt: "Bandung at night",
    venue: "Bandung",
    stake: "0.1",
    token: "cETH",
    className: "left-[7%] bottom-[10%]",
    delay: 0.8,
    rotate: 5,
  },
  {
    title: "Founder Dinner",
    photo: "/brand/events/jakarta.jpg",
    alt: "Sudirman, Jakarta",
    venue: "SCBD",
    stake: "0.01",
    token: "cBTC",
    // Mid-height cards sit at the headline's vertical centre, so between lg and
    // ~1220px they land under the hero paragraph and the copy paints over the
    // photo. They wait for xl, where the container has cleared them.
    className: "left-[16%] top-[46%] hidden xl:block",
    delay: 1.6,
    rotate: -3,
  },
  {
    title: "Hackathon Demo Day",
    photo: "/brand/events/borobudur.jpg",
    alt: "Borobudur",
    venue: "Online",
    stake: "0.05",
    token: "cETH",
    className: "right-[4%] top-[10%]",
    delay: 0.4,
    rotate: 6,
  },
  {
    title: "Community Meetup",
    photo: "/brand/events/bromo.jpg",
    alt: "Mount Bromo",
    venue: "Yogyakarta",
    stake: "0.005",
    token: "cBTC",
    className: "right-[14%] top-[48%] hidden xl:block", // mirror of the left mid card
    delay: 2.0,
    rotate: -5,
  },
  {
    title: "Run Club Sunday",
    photo: "/brand/events/gbk.jpg",
    alt: "Gelora Bung Karno",
    venue: "GBK",
    stake: "0.002",
    token: "cBTC",
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
            <div className="relative h-[4.5rem] overflow-hidden bg-ink">
              <Image
                src={c.photo}
                alt={c.alt}
                fill
                sizes="160px"
                className="object-cover"
                priority={false}
              />
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
