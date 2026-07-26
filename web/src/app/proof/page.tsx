"use client";

import Link from "next/link";
import { TokenLogo } from "@/components/TokenLogo";
import { Button } from "@/components/ui/button";
import { ArrowLeft, ExternalLink, Lock, RefreshCcw, Send, Flame } from "lucide-react";

// /proof — the DevNet receipts page.
//
// Why this page exists: the hosted demo talks to the SHARED hackcanton-01 DevNet
// with REAL cBTC and cETH (see /api/tokens — the instrument admins are BitSafe's
// cbtc-network and onRails' rails-cethMain-1-dev), so staking there moves real
// registry holdings. Those movements only exist as ledger transactions, and a
// judge cannot see someone else's. This page puts the receipts for complete
// cycles where anyone can check them, rather than asking for trust.
//
// Every id below came out of a submit-and-wait response during the runs; the
// balances are the end state we read back from the ledger afterwards.

type Step = {
  what: string;
  detail: string;
  updateId: string;
  icon: React.ReactNode;
  tone?: "refund" | "slash";
};

const CBTC_STEPS: Step[] = [
  {
    what: "Accept faucet transfer",
    detail: "TransferInstruction_Accept — cBTC becomes a real holding",
    updateId: "122040bd8730463bb8ad9f6b9aee52edf9135f7db449934a0775cf0949c0748b7464",
    icon: <Send className="size-4" />,
  },
  {
    what: "Stake locked into escrow",
    detail: "AllocationFactory_Allocate — 0.01 cBTC locked registry-side",
    updateId: "122036b5d46b0add85218c5676282d595799e943ec957f91a334d6247584b19dff16",
    icon: <Lock className="size-4" />,
  },
  {
    what: "Refund on check-in",
    detail: "Allocation_Cancel — attendee showed up, stake released",
    updateId: "1220a6432b215eb205df6debb9ce400335a6e2f6689ed891b1a3971f7e848ecc22bb",
    icon: <RefreshCcw className="size-4" />,
    tone: "refund",
  },
  {
    what: "Refund + slash, one transaction",
    detail: "CloseEvent — Bob refunded and Charlie slashed atomically",
    updateId: "122041fdf411d218ef8c9f94820346587d7540adc045a1f2b74db9159a468bffb62f",
    icon: <Flame className="size-4" />,
    tone: "slash",
  },
  {
    what: "Pot pays the people who came",
    detail: "TransferFactory_Transfer — the ghost's stake moves to Bob",
    updateId: "12207aa7bc0c99d22763b7961b363ec76867961935f42448a19d10c4a9c959227e85",
    icon: <Send className="size-4" />,
    tone: "refund",
  },
];

const CETH_STEPS: Step[] = [
  {
    what: "Accept cETH",
    detail: "TransferInstruction_Accept — 5.0 cETH received from onRails",
    updateId: "1220a638f102a5eb896535078ddf62afda494dddd0f3123cec80959fe907f71aa73a",
    icon: <Send className="size-4" />,
  },
  {
    what: "Redistribute between parties",
    detail: "TransferFactory_Transfer — 1.0 cETH moved, then accepted",
    // The only id we did not capture in full during the runs — labelled rather
    // than padded, so nobody wastes a lookup on a string that cannot resolve.
    updateId: "12200115161dfa4a91a8f502… (prefix only — full id not captured)",
    icon: <Send className="size-4" />,
  },
  {
    what: "Stake locked into escrow",
    detail: "AllocationFactory_Allocate — 0.5 cETH locked for an RSVP",
    updateId: "12208ee126ba6efd5d11ffdd6271dca445915acdc6bab76a8ed571fe39678e7d5ca1",
    icon: <Lock className="size-4" />,
  },
  {
    what: "Refund on settlement",
    detail: "CloseEvent → Allocation_Cancel — stake returned in full",
    updateId: "122078ec58c150ef213a78584e4d1de649508860c00485b8667cac4a9848b97b1804",
    icon: <RefreshCcw className="size-4" />,
    tone: "refund",
  },
];

export default function ProofPage() {
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-10 px-4 py-12 sm:px-6">
      <header className="flex flex-col gap-4">
        <Link
          href="/"
          className="flex w-fit items-center gap-1.5 text-sm text-muted-foreground hover:text-text"
        >
          <ArrowLeft className="size-4" />
          Back
        </Link>
        <h1 className="text-balance text-3xl font-semibold tracking-tight text-text sm:text-4xl">
          Receipts from Canton DevNet
        </h1>
        <p className="max-w-2xl text-muted-foreground">
          The demo you just clicked through is{" "}
          <strong className="text-text">not a sandbox</strong>. It runs against
          the shared <span className="mono text-text">hackcanton-01</span>{" "}
          DevNet, staking{" "}
          <strong className="text-text">real cBTC and real cETH</strong> issued
          by BitSafe and onRails — the demo accounts are parties the node
          operator provisioned, which is why signup is closed. The runs below are
          complete event cycles on that node; each line carries that
          transaction&apos;s update id, and every one printed in full can be
          looked up there.
        </p>
        <p className="rounded-xl border border-line bg-accent/40 p-4 text-sm leading-relaxed text-muted-foreground">
          The point worth noticing: the two runs are the{" "}
          <strong className="text-text">same code</strong>. Our stake logic is
          written against the generic CIP-56 Holding and Allocation interfaces,
          so switching from cBTC to cETH was a config change — a different
          registry URL and instrument id. No contract or backend edits.
        </p>
      </header>

      <TokenSection
        label="cBTC"
        blurb="Bitcoin-backed, issued by BitSafe. Two full event cycles: one refund-only, one with a no-show — including the pot payout."
        steps={CBTC_STEPS}
        balances={[
          { party: "organizer", amount: "0.02" },
          { party: "alice", amount: "0.02" },
          { party: "bob", amount: "0.02", note: "refund + the ghost's stake" },
          { party: "charlie", amount: "0.00", note: "ghosted — slashed" },
        ]}
      />

      <TokenSection
        label="cETH"
        blurb="1:1 wrapped ETH, issued by onRails. Received, redistributed between parties, then staked and settled."
        steps={CETH_STEPS}
        balances={[
          { party: "alice", amount: "4.00", note: "5.0 − 1.0 sent, stake refunded" },
          { party: "bob", amount: "1.00", note: "received by transfer" },
        ]}
      />

      <section className="rounded-2xl border border-line bg-surface p-6">
        <h2 className="font-semibold text-text">Verify it yourself</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          The parties are{" "}
          <span className="mono text-xs text-text">showorsow-organizer</span>,{" "}
          <span className="mono text-xs text-text">-alice</span>,{" "}
          <span className="mono text-xs text-text">-bob</span> and{" "}
          <span className="mono text-xs text-text">-charlie</span> on the
          hackcanton-01 participant. Our two Daml packages are vetted there:{" "}
          <span className="mono text-xs text-text">showorsow</span> (aaa0018a…)
          and <span className="mono text-xs text-text">showorsow-demo-token</span>{" "}
          (50bdca9c…).
        </p>

        <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
          There is deliberately{" "}
          <strong className="text-text">no public explorer link</strong> to give
          you here. Canton shows a transaction only to its informees — if a
          stranger could open someone&apos;s stake in a browser, the privacy this
          project is built on would not exist. So verification is a query you run
          against the participant, with your own token:
        </p>
        <pre className="mono mt-3 overflow-x-auto rounded-xl border border-line bg-ink p-4 text-[11px] leading-relaxed text-text">
{`curl -X POST \\
  https://ledger-api-json.participant.hackcanton-01.devnet.naas.noders.services/v2/updates/update-by-id \\
  -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" \\
  -d '{"updateId":"<any id above>",
       "updateFormat":{"includeTransactions":{"eventFormat":
         {"filtersByParty":{},"filtersForAnyParty":{},"verbose":true},
        "transactionShape":"TRANSACTION_SHAPE_ACS_DELTA"}}}'`}
        </pre>
        <p className="mt-2 text-xs text-muted-foreground">
          Run it as one of our parties and you get the transaction back; run it
          as an unrelated party and you get nothing — which is the guarantee, not
          a failure.
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <Button asChild variant="outline" className="rounded-full border-line">
            <a
              href="https://github.com/ShowOrSow/showorsow"
              target="_blank"
              rel="noreferrer"
              className="gap-1.5"
            >
              Read the source
              <ExternalLink className="size-3.5" />
            </a>
          </Button>
          <Button asChild className="rounded-full">
            <Link href="/discover">Try the live demo</Link>
          </Button>
        </div>
      </section>
    </div>
  );
}

function TokenSection({
  label,
  blurb,
  steps,
  balances,
}: {
  label: string;
  blurb: string;
  steps: Step[];
  balances: { party: string; amount: string; note?: string }[];
}) {
  return (
    <section className="overflow-hidden rounded-3xl border border-line bg-surface">
      <div className="flex items-start gap-3 border-b border-line bg-accent/40 px-6 py-5">
        <TokenLogo label={label} size={40} />
        <div>
          <h2 className="text-lg font-semibold text-text">{label} on DevNet</h2>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{blurb}</p>
        </div>
      </div>

      <ol className="divide-y divide-line">
        {steps.map((s) => (
          <li key={s.updateId} className="flex flex-wrap items-start gap-3 px-6 py-4">
            <span
              className={`mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent ${
                s.tone === "slash" ? "text-slash" : "text-refund"
              }`}
            >
              {s.icon}
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-medium text-text">{s.what}</p>
              <p className="text-sm text-muted-foreground">{s.detail}</p>
              <p className="mono mt-1 break-all text-[11px] leading-relaxed text-faint">
                {s.updateId}
              </p>
            </div>
          </li>
        ))}
      </ol>

      <div className="border-t border-line px-6 py-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-faint">
          Balances after the runs
        </p>
        {/* Rows stack on phones: the note ("5.0 − 1.0 sent, stake refunded") is
            ~168px and never shrinks, which left ~34px for the party name at
            320px — clipped to "sho…", exactly the part that tells rows apart. */}
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {balances.map((b) => (
            <div
              key={b.party}
              className="flex flex-col gap-1 rounded-xl border border-line px-3 py-2 sm:flex-row sm:items-baseline sm:justify-between sm:gap-3"
            >
              <span className="mono truncate text-sm text-muted-foreground">
                showorsow-{b.party}
              </span>
              <span className="shrink-0 sm:text-right">
                <span className="mono font-semibold tabular-nums text-text">
                  {b.amount}
                </span>{" "}
                <span className="text-xs text-muted-foreground">{label}</span>
                {b.note && (
                  <span className="block text-[11px] text-faint">{b.note}</span>
                )}
              </span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
