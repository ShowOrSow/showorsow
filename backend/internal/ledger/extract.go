package ledger

import "strings"

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

// AllCreatedByTemplate returns all created contract ids matching a suffix.
func (r *SubmitAndWaitResponse) AllCreatedByTemplate(suffix string) []string {
	var out []string
	for _, e := range r.Transaction.Events {
		if e.Created != nil && MatchesTemplate(e.Created.TemplateID, suffix) {
			out = append(out, e.Created.ContractID)
		}
	}
	return out
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

// ArchivedByTemplate returns archived contract ids matching a suffix.
func (r *SubmitAndWaitResponse) ArchivedByTemplate(suffix string) []string {
	var out []string
	for _, e := range r.Transaction.Events {
		if e.Archived != nil && MatchesTemplate(e.Archived.TemplateID, suffix) {
			out = append(out, e.Archived.ContractID)
		}
	}
	return out
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

// NormalizeTemplateSuffix strips any package prefix from a full templateId.
func NormalizeTemplateSuffix(templateID string) string {
	parts := strings.SplitN(templateID, ":", 2)
	if len(parts) == 2 {
		return parts[1]
	}
	return templateID
}
