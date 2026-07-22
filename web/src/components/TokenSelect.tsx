"use client";

import useSWR from "swr";
import type { Token } from "@/lib/types";
import { TokenLogo } from "./TokenLogo";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// TokenSelect (08 §4): GET /api/tokens, shows the instrument's official mark
// plus live decimals read from the registry metadata. The list is pure config —
// adding cBTC/cETH is an env change, never a code change.
export function TokenSelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (label: string, token: Token | undefined) => void;
}) {
  const { data, isLoading } = useSWR<Token[]>("/api/tokens");

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor="token">Token</Label>
      <Select
        value={value || undefined}
        disabled={isLoading}
        onValueChange={(label) =>
          onChange(label, data?.find((t) => t.label === label))
        }
      >
        <SelectTrigger id="token" className="w-full">
          <SelectValue
            placeholder={isLoading ? "Loading tokens…" : "Select a token"}
          />
        </SelectTrigger>
        <SelectContent>
          {data?.map((t) => (
            <SelectItem key={t.label} value={t.label}>
              <span className="flex items-center gap-2">
                <TokenLogo label={t.label} size={18} />
                <span className="font-medium">{t.label}</span>
                {t.decimals >= 0 && (
                  <span className="text-xs text-muted-foreground">
                    {t.decimals} decimals
                  </span>
                )}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
