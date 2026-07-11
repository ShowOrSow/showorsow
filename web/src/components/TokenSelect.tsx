"use client";

import useSWR from "swr";
import type { Token } from "@/lib/types";

// TokenSelect (08 §4): GET /api/tokens, shows live decimals from registry metadata.
export function TokenSelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (label: string, token: Token | undefined) => void;
}) {
  const { data, isLoading } = useSWR<Token[]>("/api/tokens");

  return (
    <div className="flex flex-col gap-1">
      <label className="text-sm text-muted" htmlFor="token">
        Token
      </label>
      <select
        id="token"
        value={value}
        disabled={isLoading}
        onChange={(e) => {
          const label = e.target.value;
          onChange(label, data?.find((t) => t.label === label));
        }}
        className="rounded-lg border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-gold"
      >
        <option value="" disabled>
          {isLoading ? "Loading tokens…" : "Select a token"}
        </option>
        {data?.map((t) => (
          <option key={t.label} value={t.label}>
            {t.label} · {t.decimals} decimals
          </option>
        ))}
      </select>
    </div>
  );
}
