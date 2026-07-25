"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { QrCode } from "lucide-react";

// CheckinPass — the attendee's door pass. Encodes `SOS1|eventId|attendeeParty`
// as a QR the organizer scans (ScanCheckin.tsx); scanning fires the same
// POST /checkin the manual list uses. The payload carries no secret — check-in
// authority stays with the organizer's session, the QR only says who to check in.
export function CheckinPass({
  eventId,
  attendeeParty,
}: {
  eventId: string;
  attendeeParty: string;
}) {
  const [svg, setSvg] = useState<string>("");

  useEffect(() => {
    let alive = true;
    QRCode.toString(`SOS1|${eventId}|${attendeeParty}`, {
      type: "svg",
      errorCorrectionLevel: "M",
      margin: 2,
      color: { dark: "#052e16", light: "#ffffff" },
    })
      .then((s) => alive && setSvg(s))
      .catch(() => alive && setSvg(""));
    return () => {
      alive = false;
    };
  }, [eventId, attendeeParty]);

  if (!svg) return null;

  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-line bg-accent/40 p-4">
      <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-faint">
        <QrCode className="size-3.5" />
        Your check-in pass
      </p>
      {/* Bigger on phones: the payload (~110 chars) makes a dense QR, and this
          gets scanned off a screen by another phone camera — larger modules
          survive glare and focus hunting. Desktop keeps the compact size. */}
      <div
        className="w-52 max-w-full overflow-hidden rounded-lg border border-line bg-white p-2 shadow-sm sm:w-40 sm:p-1.5"
        // qrcode emits a self-contained <svg> string; nothing user-controlled inside.
        dangerouslySetInnerHTML={{ __html: svg }}
      />
      <p className="text-center text-xs text-muted-foreground">
        Show this at the door — the organizer scans it to check you in.
      </p>
    </div>
  );
}
