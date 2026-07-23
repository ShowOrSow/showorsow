"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { useToast } from "../ToastProvider";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScanLine, CameraOff } from "lucide-react";

// ScanCheckin — organizer door scanner. Reads the attendee's CheckinPass QR
// (`SOS1|eventId|attendeeParty`) via camera + BarcodeDetector and fires the
// same POST /checkin as the manual list. BarcodeDetector is Chromium-only, so
// a paste-the-code fallback is always shown; check-in authority stays with the
// organizer session either way.
export function ScanCheckin({
  eventId,
  disabled,
  onMutate,
}: {
  eventId: string;
  disabled: boolean;
  onMutate: () => void;
}) {
  const { push, pushError } = useToast();
  const [open, setOpen] = useState(false);
  const [cameraState, setCameraState] = useState<"idle" | "on" | "unavailable">("idle");
  const [manual, setManual] = useState("");
  const [busy, setBusy] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const seenRef = useRef<Set<string>>(new Set());

  const handlePayload = useCallback(
    async (raw: string) => {
      const parts = raw.trim().split("|");
      if (parts.length !== 3 || parts[0] !== "SOS1") {
        push({ kind: "error", message: "Not a ShowOrSow pass." });
        return;
      }
      const [, evId, party] = parts;
      if (evId !== eventId) {
        push({ kind: "error", message: "Pass is for a different event." });
        return;
      }
      if (seenRef.current.has(party) || busy) return;
      seenRef.current.add(party);
      setBusy(true);
      try {
        await api.checkin(eventId, party);
        push({ kind: "success", message: `Checked in: ${party.split("::")[0] || "attendee"} ✓` });
        onMutate();
      } catch (err) {
        seenRef.current.delete(party); // allow retry
        pushError(err, "Check-in failed");
      } finally {
        setBusy(false);
      }
    },
    [busy, eventId, onMutate, pushError, push],
  );

  // Camera + BarcodeDetector loop while the dialog is open.
  useEffect(() => {
    if (!open) return;
    let raf = 0;
    let cancelled = false;

    async function start() {
      const Detector = (
        window as unknown as {
          BarcodeDetector?: new (o: { formats: string[] }) => {
            detect(v: HTMLVideoElement): Promise<{ rawValue: string }[]>;
          };
        }
      ).BarcodeDetector;
      if (!Detector || !navigator.mediaDevices?.getUserMedia) {
        setCameraState("unavailable");
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        setCameraState("on");
        const detector = new Detector({ formats: ["qr_code"] });
        const tick = async () => {
          if (cancelled || !videoRef.current) return;
          try {
            const codes = await detector.detect(videoRef.current);
            for (const c of codes) void handlePayload(c.rawValue);
          } catch {
            /* detector hiccups between frames are normal */
          }
          raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      } catch {
        setCameraState("unavailable");
      }
    }
    void start();

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      setCameraState("idle");
    };
  }, [open, handlePayload]);

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled}
        onClick={() => {
          seenRef.current.clear();
          setOpen(true);
        }}
        className="gap-1.5 rounded-full"
      >
        <ScanLine className="size-4" />
        Scan pass
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Scan a check-in pass</DialogTitle>
          </DialogHeader>

          {cameraState !== "unavailable" ? (
            <div className="overflow-hidden rounded-xl border border-line bg-black">
              {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
              <video ref={videoRef} className="aspect-square w-full object-cover" muted playsInline />
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-line bg-accent/30 p-6 text-center">
              <CameraOff className="size-6 text-faint" />
              <p className="text-sm text-muted-foreground">
                Camera scanning isn&apos;t available in this browser — paste the
                pass code instead.
              </p>
            </div>
          )}

          <div className="flex gap-2">
            <input
              value={manual}
              onChange={(e) => setManual(e.target.value)}
              placeholder="SOS1|event|party…"
              className="mono min-w-0 flex-1 rounded-lg border border-line bg-surface px-3 py-2 text-xs outline-none focus:border-gold"
            />
            <Button
              type="button"
              size="sm"
              disabled={busy || !manual.trim()}
              onClick={() => {
                void handlePayload(manual);
                setManual("");
              }}
            >
              Check in
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
