// Decode raw JSON Ledger API v2 wire payloads into the normalized LedgerUpdate model.
//
// The exact field names differ across JSON API v2 revisions and between the WS (updates) and
// HTTP (active-contracts) transports; DevNet resets can shuffle package ids too. This decoder
// is deliberately tolerant: it matches template/interface identity by QUALIFIED NAME only
// (package-id-agnostic, 06 §1) and probes the handful of shapes the current spec revisions use.
//
// Wire notes (v2, 3.4.x):
//   - A transaction update has `{ transaction: { updateId, offset, events: [...] } }`, or the
//     WS envelope `{ update: { transactionTree | transaction: {...} } }`.
//   - Each event is one of `{ CreatedEvent }` / `{ ArchivedEvent }` / `{ ExercisedEvent }`
//     (tagged object) OR a flat object with an `eventType`/`kind` discriminator.
//   - A template id renders as "pkgId:Module.Path:Entity"; we drop the package id and keep the
//     LAST two colon-segments as module + entity. Interface ids render the same way.

import type { QualifiedName } from './config.ts';
import type { LedgerUpdate, LedgerNode, CreatedNode, ArchivedNode, ExercisedNode } from './ledger-types.ts';

type Obj = Record<string, unknown>;

function isObj(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** "pkg:Mod.Path:Entity" or "pkg:Mod:Entity" -> { module, entity }. Package id dropped. */
export function parseTemplateId(raw: unknown): QualifiedName | undefined {
  const s = typeof raw === 'string' ? raw : isObj(raw) ? templateIdFromObj(raw) : undefined;
  if (s === undefined) return undefined;
  const parts = s.split(':');
  if (parts.length < 2) return undefined;
  const entity = parts[parts.length - 1]!;
  const module = parts[parts.length - 2]!;
  return { module, entity };
}

function templateIdFromObj(o: Obj): string | undefined {
  // Structured id: { packageId, moduleName, entityName }.
  const mod = o['moduleName'] ?? o['module'];
  const ent = o['entityName'] ?? o['entity'];
  if (typeof mod === 'string' && typeof ent === 'string') return `pkg:${mod}:${ent}`;
  return undefined;
}

function firstDefined<T>(...vs: (T | undefined)[]): T | undefined {
  for (const v of vs) if (v !== undefined) return v;
  return undefined;
}

/** Pull the inner event object out of a tagged `{ CreatedEvent: {...} }` or flat shape. */
function unwrapEvent(raw: unknown): { tag: string | undefined; body: Obj } | undefined {
  if (!isObj(raw)) return undefined;
  for (const tag of ['CreatedEvent', 'ArchivedEvent', 'ExercisedEvent']) {
    const b = raw[tag];
    if (isObj(b)) return { tag, body: b };
  }
  // flat discriminated shape
  const disc = firstDefined(raw['eventType'], raw['kind'], raw['type']);
  if (typeof disc === 'string') return { tag: normalizeTag(disc), body: raw };
  // active-contracts entries: { contractId, templateId, createArgument | createArguments }
  if ('createArgument' in raw || 'createArguments' in raw || 'payload' in raw) {
    return { tag: 'CreatedEvent', body: raw };
  }
  return undefined;
}

function normalizeTag(s: string): string {
  const l = s.toLowerCase();
  if (l.includes('creat')) return 'CreatedEvent';
  if (l.includes('archiv')) return 'ArchivedEvent';
  if (l.includes('exercis')) return 'ExercisedEvent';
  return s;
}

/** JSON API v2: implementedInterfaces: [interfaceId, ...] on Created/Archived/Exercised events. */
function readImplementedInterfaces(body: Obj): QualifiedName[] | undefined {
  const raw = body['implementedInterfaces'] ?? body['implemented_interfaces'];
  if (!Array.isArray(raw)) return undefined;
  const out: QualifiedName[] = [];
  for (const r of raw) {
    const q = parseTemplateId(r);
    if (q) out.push(q);
  }
  return out.length ? out : undefined;
}

function readInterfaceViews(body: Obj): Record<string, Obj> | undefined {
  // JSON API v2: interfaceViews: [{ interfaceId, viewValue | viewStatus, ... }]
  const raw = body['interfaceViews'] ?? body['interface_views'];
  if (!Array.isArray(raw)) return undefined;
  const out: Record<string, Obj> = {};
  for (const iv of raw) {
    if (!isObj(iv)) continue;
    const q = parseTemplateId(iv['interfaceId'] ?? iv['interface_id']);
    const view = firstDefined(iv['viewValue'], iv['view'], iv['value']);
    if (q && isObj(view)) out[`${q.module}:${q.entity}`] = view;
  }
  return Object.keys(out).length ? out : undefined;
}

function decodeNode(raw: unknown): LedgerNode | undefined {
  const uw = unwrapEvent(raw);
  if (!uw) return undefined;
  const { tag, body } = uw;
  const templateId = parseTemplateId(body['templateId'] ?? body['template_id']);
  const contractId = typeof body['contractId'] === 'string'
    ? (body['contractId'] as string)
    : typeof body['contract_id'] === 'string'
      ? (body['contract_id'] as string)
      : undefined;
  if (contractId === undefined) return undefined;

  if (tag === 'CreatedEvent') {
    if (templateId === undefined) return undefined;
    const payloadRaw = firstDefined(
      body['createArgument'],
      body['createArguments'],
      body['payload'],
      body['argument'],
    );
    const created: CreatedNode = {
      kind: 'created',
      contractId,
      templateId,
      payload: isObj(payloadRaw) ? payloadRaw : {},
    };
    const views = readInterfaceViews(body);
    if (views) created.interfaceViews = views;
    return created;
  }

  if (tag === 'ArchivedEvent') {
    if (templateId === undefined) return undefined;
    const archived: ArchivedNode = { kind: 'archived', contractId, templateId };
    const impl = readImplementedInterfaces(body);
    if (impl) archived.implementedInterfaces = impl;
    return archived;
  }

  if (tag === 'ExercisedEvent') {
    const choice =
      typeof body['choice'] === 'string' ? (body['choice'] as string) : '';
    const consuming = body['consuming'] === true;
    const node: ExercisedNode = {
      kind: 'exercised',
      contractId,
      templateId: templateId ?? { module: '', entity: '' },
      choice,
      consuming,
    };
    const iface = parseTemplateId(body['interfaceId'] ?? body['interface_id']);
    if (iface) node.interfaceId = iface;
    const impl = readImplementedInterfaces(body);
    if (impl) node.implementedInterfaces = impl;
    return node;
  }

  return undefined;
}

/**
 * Decode one wire event into normalized node(s). Under TRANSACTION_SHAPE_LEDGER_EFFECTS (the WS
 * primary path, 06 §2/F1) archives are NOT delivered as ArchivedEvents — they appear as CONSUMING
 * ExercisedEvents. The handlers only treat kind==='archived' as an archive, so for every consuming
 * exercise we ALSO synthesize an ArchivedNode (same cid/template/interfaces). That makes the
 * E10/E11/E12/E16 archive-correlation conditions observable while keeping the exercise node around
 * for its choice signal (CloseEvent / Settle / AllocationRequest_*).
 */
function decodeNodes(raw: unknown): LedgerNode[] {
  const n = decodeNode(raw);
  if (!n) return [];
  if (n.kind === 'exercised' && n.consuming) {
    const archived: ArchivedNode = { kind: 'archived', contractId: n.contractId, templateId: n.templateId };
    if (n.implementedInterfaces) archived.implementedInterfaces = n.implementedInterfaces;
    return [n, archived];
  }
  return [n];
}

/**
 * Decode one WS/HTTP transaction envelope into a LedgerUpdate. Returns undefined if the
 * envelope carries no transaction (e.g. a heartbeat / reassignment we ignore, 06 §4).
 */
export function decodeUpdate(raw: unknown): LedgerUpdate | undefined {
  if (!isObj(raw)) return undefined;
  // Peel common envelopes.
  const tx =
    (isObj(raw['transaction']) && (raw['transaction'] as Obj)) ||
    (isObj(raw['update']) && isObj((raw['update'] as Obj)['transaction']) &&
      ((raw['update'] as Obj)['transaction'] as Obj)) ||
    (isObj(raw['update']) && isObj((raw['update'] as Obj)['transactionTree']) &&
      ((raw['update'] as Obj)['transactionTree'] as Obj)) ||
    raw;
  const eventsRaw = firstDefined(tx['events'], tx['eventsById'], tx['nodes']);
  let eventList: unknown[] = [];
  if (Array.isArray(eventsRaw)) eventList = eventsRaw;
  else if (isObj(eventsRaw)) eventList = Object.values(eventsRaw);
  else return undefined;

  const offset = firstDefined(
    typeof tx['offset'] === 'string' || typeof tx['offset'] === 'number' ? String(tx['offset']) : undefined,
    typeof raw['offset'] === 'string' || typeof raw['offset'] === 'number' ? String(raw['offset']) : undefined,
  );
  if (offset === undefined) return undefined;

  const nodes: LedgerNode[] = [];
  for (const ev of eventList) {
    for (const n of decodeNodes(ev)) nodes.push(n);
  }

  const update: LedgerUpdate = { offset, nodes };
  const updateId = firstDefined(
    typeof tx['updateId'] === 'string' ? (tx['updateId'] as string) : undefined,
    typeof tx['update_id'] === 'string' ? (tx['update_id'] as string) : undefined,
  );
  if (updateId !== undefined) update.updateId = updateId;
  const recordTime = firstDefined(
    typeof tx['recordTime'] === 'string' ? (tx['recordTime'] as string) : undefined,
    typeof tx['effectiveAt'] === 'string' ? (tx['effectiveAt'] as string) : undefined,
  );
  if (recordTime !== undefined) update.recordTime = recordTime;
  return update;
}
