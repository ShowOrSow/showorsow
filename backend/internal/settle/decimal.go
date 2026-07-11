package settle

import "math/big"

// sumDecimalStrings sums a list of decimal strings exactly (big.Rat) and
// renders the result. Empty input → "0". The result scale is the max input
// scale so no precision is lost.
func sumDecimalStrings(vals []string) string {
	if len(vals) == 0 {
		return "0"
	}
	total := new(big.Rat)
	maxScale := 0
	for _, v := range vals {
		r, ok := new(big.Rat).SetString(v)
		if !ok {
			continue
		}
		total.Add(total, r)
		if s := scaleOf(v); s > maxScale {
			maxScale = s
		}
	}
	return total.FloatString(maxScale)
}

// scaleOf returns the number of fractional digits in a decimal string.
func scaleOf(s string) int {
	for i := 0; i < len(s); i++ {
		if s[i] == '.' {
			return len(s) - i - 1
		}
	}
	return 0
}
