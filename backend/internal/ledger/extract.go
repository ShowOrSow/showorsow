package ledger

// Helpers to pull contract ids out of a submit-and-wait transaction result.

// CreatedByTemplate returns the contract id of the first created contract whose
// templateId matches the given module:entity suffix (package-id-agnostic).
func (r *SubmitAndWaitResponse) CreatedByTemplate(suffix string) (string, bool) {
	for _, e := range r.Transaction.Events {
		if e.Created != nil && MatchesTemplate(e.Created.TemplateID, suffix) {
			return e.Created.ContractID, true
		}
	}
	return "", false
}

// CreatedByInterface returns the contract id of the first created contract that
// exposes an interface view matching the given interface suffix.
func (r *SubmitAndWaitResponse) CreatedByInterface(ifaceSuffix string) (string, bool) {
	for _, e := range r.Transaction.Events {
		if e.Created == nil {
			continue
		}
		for _, v := range e.Created.InterfaceViews {
			if MatchesInterface(v.InterfaceID, ifaceSuffix) {
				return e.Created.ContractID, true
			}
		}
	}
	return "", false
}

// InterfaceViewValue returns the raw interface view JSON of an active contract
// for the interface suffix, if present.
func (ac *ActiveContract) InterfaceViewValue(ifaceSuffix string) ([]byte, bool) {
	for _, v := range ac.CreatedEvent.InterfaceViews {
		if MatchesInterface(v.InterfaceID, ifaceSuffix) {
			return v.ViewValue, len(v.ViewValue) > 0
		}
	}
	return nil, false
}

// ShortCid returns a display-friendly prefix of a contract id.
func ShortCid(cid string) string {
	if len(cid) <= 12 {
		return cid
	}
	return cid[:8] + "…" + cid[len(cid)-4:]
}
