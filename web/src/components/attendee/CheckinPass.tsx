"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { QrCode } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

// CheckinPass — the attendee's door pass. Encodes `SOS1|eventId|attendeeParty`
// as a QR the organizer scans (ScanCheckin.tsx); scanning fires the same
// POST /checkin the manual list uses. The payload carries no secret — check-in
// authority stays with the organizer's session, the QR only says who to check in.
//
// Behind a button rather than always on the card: the pass is only needed at the
// door, and putting it in a dialog lets the QR be as large as the screen allows
// with the page dimmed behind it — a dense ~127-char code read off one screen by
// another phone's camera wants every pixel and every bit of contrast it can get.
export function CheckinPass({
  eventId,
  attendeeParty,
}: {
  eventId: string;
  attendeeParty: string;
}) {
  const [svg, setSvg] = useState<string>("");
  const [open, setOpen] = useState(false);

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
    <>
      <Button
        type="button"
        variant="outline"
        onClick={() => setOpen(true)}
        className="w-full gap-2 rounded-xl border-line"
      >
        <QrCode className="size-4" />
        Show check-in pass
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Your check-in pass</DialogTitle>
          </DialogHeader>

          {/* Capped by viewport height as well as width: the pass is square, so
              on a short screen (phone in landscape) a width-only cap makes it
              taller than the dialog and you have to scroll a code you are
              trying to hold up. It shrinks to fit instead. */}
          <div
            className="mx-auto w-full max-w-[min(22rem,55dvh)] overflow-hidden rounded-xl border border-line bg-white p-3 shadow-sm"
            // qrcode emits a self-contained <svg> string; nothing user-controlled inside.
            dangerouslySetInnerHTML={{ __html: svg }}
          />

          <p className="text-center text-sm text-muted-foreground">
            Show this at the door — the organizer scans it to check you in.
          </p>
        </DialogContent>
      </Dialog>
    </>
  );
}
