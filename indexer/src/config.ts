// Indexer configuration, loaded from process.env (see .env.example).
// Template/interface identity is by QUALIFIED NAME only (package-id-agnostic, 06 §1).

export interface QualifiedName {
  /** Module path, e.g. "ShowOrSow" or "Splice.Api.Token.HoldingV1". */
  module: string;
  /** Entity name, e.g. "Event" or "Holding". */
  entity: string;
}

export function parseQualified(s: string): QualifiedName {
  const idx = s.lastIndexOf(':');
  if (idx < 0) throw new Error(`bad qualified name (want module:Entity): ${s}`);
  return { module: s.slice(0, idx), entity: s.slice(idx + 1) };
}

export interface Config {
  databaseUrl: string;
  ledgerHttpBase: string;
  ledgerWsBase: string;
  appOperatorParty: string;
  potParty: string;
  ledgerJwt: string;
  streamMode: 'ws' | 'poll';
  pollIntervalMs: number;
  healthzPort: number;
  metaEventKey: string;
  templates: {
    event: QualifiedName;
    eventProposal: QualifiedName;
    rsvpInvite: QualifiedName;
    stakedRsvp: QualifiedName;
    allocation: QualifiedName;
    transferInstruction: QualifiedName;
    holding: QualifiedName;
  };
  /**
   * Fully-qualified WIRE identifiers for the token-standard interface filters (04 §2), e.g.
   * '#splice-api-token-holding-v1:Splice.Api.Token.HoldingV1:Holding'. The server's InterfaceFilter
   * needs a package-qualified id ('#pkg-name:Module:Entity' or 'pkgId:Module:Entity'); the bare
   * 'Module:Entity' the decoder matches on is NOT a valid wire id. Kept separate from the
   * package-agnostic match names in `templates` (F2).
   */
  interfaceWire: {
    allocation: string;
    transferInstruction: string;
    holding: string;
  };
}

function req(name: string): string {
  const v = process.env[name];
  if (v === undefined || v === '') throw new Error(`missing required env: ${name}`);
  return v;
}

function opt(name: string, dflt: string): string {
  const v = process.env[name];
  return v === undefined || v === '' ? dflt : v;
}

export function loadConfig(): Config {
  const appOperator = req('APP_OPERATOR_PARTY');
  const mode = opt('STREAM_MODE', 'ws');
  if (mode !== 'ws' && mode !== 'poll') {
    throw new Error(`STREAM_MODE must be 'ws' or 'poll', got: ${mode}`);
  }
  return {
    databaseUrl: req('DATABASE_URL'),
    ledgerHttpBase: opt('LEDGER_HTTP_BASE', 'http://localhost:7575'),
    ledgerWsBase: opt('LEDGER_WS_BASE', 'ws://localhost:7575'),
    appOperatorParty: appOperator,
    potParty: opt('POT_PARTY', appOperator),
    ledgerJwt: opt('LEDGER_JWT', ''),
    streamMode: mode,
    pollIntervalMs: Number(opt('POLL_INTERVAL_MS', '2000')),
    healthzPort: Number(opt('HEALTHZ_PORT', '8081')),
    metaEventKey: opt('META_EVENT_KEY', 'showorsow.dev/event'),
    templates: {
      event: parseQualified(opt('TPL_EVENT', 'ShowOrSow:Event')),
      eventProposal: parseQualified(opt('TPL_EVENT_PROPOSAL', 'ShowOrSow:EventProposal')),
      rsvpInvite: parseQualified(opt('TPL_RSVP_INVITE', 'ShowOrSow:RSVPInvite')),
      stakedRsvp: parseQualified(opt('TPL_STAKED_RSVP', 'ShowOrSow:StakedRSVP')),
      allocation: parseQualified(opt('IFACE_ALLOCATION', 'Splice.Api.Token.AllocationV1:Allocation')),
      transferInstruction: parseQualified(
        opt('IFACE_TRANSFER_INSTRUCTION', 'Splice.Api.Token.TransferInstructionV1:TransferInstruction'),
      ),
      holding: parseQualified(opt('IFACE_HOLDING', 'Splice.Api.Token.HoldingV1:Holding')),
    },
    interfaceWire: {
      allocation: opt(
        'IFACE_ALLOCATION_WIRE',
        '#splice-api-token-allocation-v1:Splice.Api.Token.AllocationV1:Allocation',
      ),
      transferInstruction: opt(
        'IFACE_TRANSFER_INSTRUCTION_WIRE',
        '#splice-api-token-transfer-instruction-v1:Splice.Api.Token.TransferInstructionV1:TransferInstruction',
      ),
      holding: opt(
        'IFACE_HOLDING_WIRE',
        '#splice-api-token-holding-v1:Splice.Api.Token.HoldingV1:Holding',
      ),
    },
  };
}
