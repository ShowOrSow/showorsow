// Ledger receipts in the UI. Every write we make returns the transaction's
// update id (backend: SubmitAndWaitResponse.TxID), and the cBTC/cETH challenge
// asks to see the transaction, not a balance. So each action reports what moved
// and hands over the id you can look up on the participant.
//
// Shown at the moment of the action rather than stored per row: the indexer only
// records update ids for settlements, and a receipt is most useful right when
// the thing happens.

/** "1220abc…7e85" — enough to recognise, short enough for a toast. */
export function shortTx(txId: string): string {
  if (txId.length <= 18) return txId;
  return `${txId.slice(0, 10)}…${txId.slice(-4)}`;
}

export interface TxToast {
  kind: "success";
  message: string;
  action?: { label: string; onClick: () => void };
}

/**
 * Build the toast for a completed ledger write. Falls back to a plain success
 * message when the deployment did not return an id, so the caller never has to
 * branch.
 */
export function txToast(what: string, txId?: string): TxToast {
  if (!txId) return { kind: "success", message: what };
  return {
    kind: "success",
    message: `${what} · tx ${shortTx(txId)}`,
    action: {
      label: "Copy tx id",
      onClick: () => {
        void navigator.clipboard?.writeText(txId);
      },
    },
  };
}
