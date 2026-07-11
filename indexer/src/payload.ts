// Daml JSON payload accessors. Kept tolerant: the JSON API v2 encoding renders records as
// plain objects, Decimal/Numeric as strings (or numbers), Time as ISO strings, Optional as
// null | value, and TextMap as an object. These helpers read those shapes without baking in
// token decimals (03 §1: instrument facts are opaque config).

export function asString(v: unknown): string | undefined {
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'bigint') return String(v);
  return undefined;
}

/** Decimal/Numeric — always stored as a string so numeric scale is never lost. */
export function asDecimal(v: unknown): string | undefined {
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'bigint') return String(v);
  return undefined;
}

export function asBool(v: unknown): boolean | undefined {
  if (typeof v === 'boolean') return v;
  return undefined;
}

/** Optional a -> null | a on the wire; returns the inner value or undefined. */
export function optional(v: unknown): unknown {
  return v === null || v === undefined ? undefined : v;
}

export function getField(obj: Record<string, unknown>, ...names: string[]): unknown {
  for (const n of names) {
    if (n in obj) return obj[n];
  }
  return undefined;
}

/**
 * Read a value out of a Daml `TextMap`/`Metadata` shape. The token-standard `Metadata` is
 * `{ values : TextMap Text }`; a bare TextMap is `{ k: v }`. Also tolerates the JSON API's
 * list-of-pairs encoding `[[k, v], ...]`.
 */
export function metaLookup(meta: unknown, key: string): string | undefined {
  if (meta === null || meta === undefined) return undefined;
  // token-standard Metadata: { values: { k: v } }
  if (typeof meta === 'object' && 'values' in (meta as Record<string, unknown>)) {
    return metaLookup((meta as Record<string, unknown>)['values'], key);
  }
  if (Array.isArray(meta)) {
    for (const pair of meta) {
      if (Array.isArray(pair) && pair.length === 2 && pair[0] === key) {
        return asString(pair[1]);
      }
    }
    return undefined;
  }
  if (typeof meta === 'object') {
    const v = (meta as Record<string, unknown>)[key];
    return asString(v);
  }
  return undefined;
}
