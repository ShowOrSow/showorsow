// Normalized ledger event model.
//
// The JSON Ledger API v2 update stream delivers "transactions" (updates). Each update
// carries a flat list of events: CreatedEvent, ArchivedEvent (a.k.a. exercised-consuming),
// and non-consuming ExercisedEvent nodes. The raw wire shapes differ slightly between the
// WS (AsyncAPI) and HTTP (active-contracts) transports; the stream feeders normalize both
// into the shapes below so the handlers stay transport-agnostic and pure.

import type { QualifiedName } from './config.ts';

/** A create node: full template id + payload argument (JSON). */
export interface CreatedNode {
  kind: 'created';
  contractId: string;
  templateId: QualifiedName;
  /** Decoded create argument (template payload) as a JSON object. */
  payload: Record<string, unknown>;
  /**
   * Interface views present on the create, keyed by interface qualified name.
   * Used to read TransferInstruction / Holding / Allocation views package-id-agnostically.
   */
  interfaceViews?: Record<string, Record<string, unknown>>;
}

/** An archive node: only a contract id + template id — NO payload (06 §1 cid-refresh rule). */
export interface ArchivedNode {
  kind: 'archived';
  contractId: string;
  templateId: QualifiedName;
  /**
   * Interfaces the archived contract's template implements (from ArchivedEvent.implementedInterfaces,
   * or copied from the consuming ExercisedEvent under LEDGER_EFFECTS). Interface-typed archives
   * (Allocation / TransferInstruction / Holding) are matched by this, since the wire templateId is
   * always the concrete implementing template, never the interface id (06 §2 E12/E14/E15b).
   */
  implementedInterfaces?: QualifiedName[];
}

/** A non-consuming (or consuming) exercise node visible in the update. Disambiguates E5/E10/E16. */
export interface ExercisedNode {
  kind: 'exercised';
  contractId: string;
  templateId: QualifiedName;
  /** Interface id if this was an interface choice (e.g. Allocation_ExecuteTransfer). */
  interfaceId?: QualifiedName;
  /** Interfaces the exercised contract's template implements (mirrors ArchivedNode). */
  implementedInterfaces?: QualifiedName[];
  choice: string;
  consuming: boolean;
}

export type LedgerNode = CreatedNode | ArchivedNode | ExercisedNode;

/** One update = one ledger transaction, as seen by appOperator. */
export interface LedgerUpdate {
  /** Update id (WS path). Undefined on the polling fallback (06 §3). */
  updateId?: string;
  /** Ledger offset AFTER this update — advanced into indexer_state in the same txn (06 §1). */
  offset: string;
  /** Effective time of the update, ISO-8601 (for settled_at etc.), optional. */
  recordTime?: string;
  nodes: LedgerNode[];
}

export function nameEq(a: QualifiedName, b: QualifiedName): boolean {
  return a.module === b.module && a.entity === b.entity;
}
