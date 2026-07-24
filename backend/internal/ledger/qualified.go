package ledger

import "strings"

// Qualified names for our templates & standard interfaces. Package ids are
// resolved at runtime because DevNet resets change them; the JSON API accepts a
// "#package-name:Module:Entity" form for standard packages, and for our own
// package we substitute the uploaded package id at boot. These constants hold
// the module:entity suffix used for package-id-agnostic matching.

// Standard token-standard interface ids (package-name form, resolved by the
// participant). Per 03 §4 / 04 §1.
const (
	HoldingInterfaceID             = "#splice-api-token-holding-v1:Splice.Api.Token.HoldingV1:Holding"
	AllocationInterfaceID          = "#splice-api-token-allocation-v1:Splice.Api.Token.AllocationV1:Allocation"
	TransferInstructionInterfaceID = "#splice-api-token-transfer-instruction-v1:Splice.Api.Token.TransferInstructionV1:TransferInstruction"

	// Factory interface ids used as the templateId of factory exercises. The
	// registry returns the factory CONTRACT id (ContractID); the templateId must
	// name the interface, never the contract id (F2).
	AllocationFactoryInterfaceID = "#splice-api-token-allocation-instruction-v1:Splice.Api.Token.AllocationInstructionV1:AllocationFactory"
	TransferFactoryInterfaceID   = "#splice-api-token-transfer-instruction-v1:Splice.Api.Token.TransferInstructionV1:TransferFactory"
)

// Our template module:entity suffixes (matched package-id-agnostically).
const (
	TplEventProposal = "ShowOrSow:EventProposal"
	TplEvent         = "ShowOrSow:Event"
	TplRSVPInvite    = "ShowOrSow:RSVPInvite"
	TplStakedRSVP    = "ShowOrSow:StakedRSVP"
)

// EntityDemoIssuer is the entity name of the mintable demo-token issuer (04
// §1.7). It is matched by ENTITY name only (never module:entity) because the
// demo-token package ships in its OWN DAR — deployed only in demo/dev — so the
// backend does not carry its package id or module name (05 §6c).
const EntityDemoIssuer = "DemoIssuer"

// EntityDemoHolding is the entity name of the demo-token holding (04 §1.7). Its
// createArgument is {issuer, owner, amount} — read directly in the demo payout
// path, since a wildcard ACS query populates createArgument but not the Holding
// interface view (which requires an InterfaceFilter).
const EntityDemoHolding = "DemoHolding"

// PackageQualifier is prepended to our template suffixes to form a full
// templateId. On upload the backend learns the package id (or uses the
// package-name form "#showorsow:…"). Configured via SHOWOROSOW_PACKAGE_ID env.
type PackageQualifier string

// TemplateID joins the package qualifier with a module:entity suffix.
func (q PackageQualifier) TemplateID(suffix string) string {
	if q == "" {
		return "#showorsow:" + suffix
	}
	return string(q) + ":" + suffix
}

// MatchesTemplate reports whether a full templateId ends with the given
// module:entity suffix, ignoring the package id (DevNet-reset resilient, 06 §1).
func MatchesTemplate(templateID, suffix string) bool {
	// templateId form: <package>:<Module>:<Entity>
	parts := strings.SplitN(templateID, ":", 2)
	if len(parts) == 2 {
		return parts[1] == suffix
	}
	return templateID == suffix
}

// MatchesInterface reports whether an interfaceId matches by module:entity
// suffix, ignoring package id.
func MatchesInterface(interfaceID, suffix string) bool {
	return MatchesTemplate(interfaceID, suffix)
}

// MatchesEntity reports whether a full templateId's ENTITY (the last
// colon-separated segment) equals entity, ignoring both package id and module.
// Used to match the demo-token DemoIssuer whose module name the backend does
// not know (EntityDemoIssuer, 05 §6c).
func MatchesEntity(templateID, entity string) bool {
	i := strings.LastIndexByte(templateID, ':')
	if i < 0 {
		return templateID == entity
	}
	return templateID[i+1:] == entity
}
