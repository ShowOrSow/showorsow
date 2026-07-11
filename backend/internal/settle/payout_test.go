package settle

import (
	"math/big"
	"testing"
)

// TestFloorDiv covers the payout share math (05 §5): floor division at the
// registry's decimals, dust remains in the pot.
func TestFloorDiv(t *testing.T) {
	tests := []struct {
		name      string
		total     string
		n         int64
		decimals  int
		wantShare string
	}{
		// 1 ghost stake 0.01 split among 2 checked-in @ 10 decimals →
		// 0.005 each, no dust.
		{"clean-split", "0.01", 2, 10, "0.0050000000"},
		// 0.01 among 3 @ 10 decimals → 0.0033333333, dust 0.0000000001 stays.
		{"with-dust", "0.01", 3, 10, "0.0033333333"},
		// share floors to zero at coarse decimals → caller skips payouts.
		{"floors-to-zero", "0.01", 3, 1, "0.0"},
		// larger: 3 ghosts × 0.5 = 1.5 among 2 → 0.75 each.
		{"multi-ghost", "1.5", 2, 10, "0.7500000000"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			total, _ := new(big.Rat).SetString(tc.total)
			share := floorDiv(total, tc.n, tc.decimals)
			got := ratToDecimalString(share, tc.decimals)
			if got != tc.wantShare {
				t.Fatalf("floorDiv(%s/%d @%d) = %s, want %s", tc.total, tc.n, tc.decimals, got, tc.wantShare)
			}
		})
	}
}

// TestSumDecimalStrings covers exact decimal summation used for balance
// snapshots and the pre-check.
func TestSumDecimalStrings(t *testing.T) {
	tests := []struct {
		in   []string
		want string
	}{
		{nil, "0"},
		{[]string{"0.01", "0.02", "0.03"}, "0.06"},
		{[]string{"1.0000000001", "0.0000000002"}, "1.0000000003"},
		{[]string{"5"}, "5"},
	}
	for _, tc := range tests {
		if got := sumDecimalStrings(tc.in); got != tc.want {
			t.Errorf("sumDecimalStrings(%v) = %s, want %s", tc.in, got, tc.want)
		}
	}
}
