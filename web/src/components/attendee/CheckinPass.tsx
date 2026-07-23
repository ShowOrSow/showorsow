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
      <div
        className="w-40 overflow-hidden rounded-lg border border-line bg-white p-1.5 shadow-sm"
        // qrcode emits a self-contained <svg> string; nothing user-controlled inside.
        dangerouslySetInnerHTML={{ __html: svg }}
      />
      <p className="text-center text-xs text-muted-foreground">
        Show this at the door — the organizer scans it to check you in.
      </p>
    </div>
  );
}
