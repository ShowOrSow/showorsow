package api

import "math/big"

// sumGE reports whether the exact sum of decimal-string amounts is ≥ threshold.
// Used by the §3.1 pre-check (Holding sum ≥ stakeAmount).
func sumGE(amounts []string, threshold string) bool {
	total := new(big.Rat)
	for _, a := range amounts {
		if r, ok := new(big.Rat).SetString(a); ok {
			total.Add(total, r)
		}
	}
	th, ok := new(big.Rat).SetString(threshold)
	if !ok {
		return false
	}
	return total.Cmp(th) >= 0
}
