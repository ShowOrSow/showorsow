#!/usr/bin/env bash
# ShowOrSow — provision the SHOW demo token on the Canton sandbox.
#
# Idempotent-ish ops helper: uploads the demo-token DAR, ensures a DemoIssuer
# exists (faucet mints through it), and ensures a DemoAllocationFactory exists
# whose `senders` are every hosted user party (attendees must be observers on the
# factory to discover it and stake). Run once after the backend has seeded/
# allocated its parties; re-run after new signups to (re)build the factory so the
# new parties can stake.
#
#   sudo bash /opt/showorsow/deploy/provision-demo-token.sh
#
# NB: the DemoIssuer/DemoAllocationFactory contracts persist in Postgres, so this
# only needs re-running on a fresh ledger DB or to widen the factory's senders.
# A proper fix would have the Go backend ensure these after SeedDemoUsers.
set -u
API=http://127.0.0.1:6864
DARS=/opt/showorsow/dars
command -v jq >/dev/null || apt-get install -y -qq jq >/dev/null 2>&1
OP=$(cat /opt/showorsow/canton-data/appoperator.party)

# 1) upload the newest demo-token DAR (highest version wins name resolution).
DAR=$(ls -1 "$DARS"/showorsow-demo-token-*.dar 2>/dev/null | sort -V | tail -1)
[ -n "$DAR" ] && echo "[prov] upload $(basename "$DAR") -> HTTP $(curl -sS -o /dev/null -w '%{http_code}' -X POST "$API/v2/packages" --data-binary @"$DAR" -H 'Content-Type: application/octet-stream')"

end() { curl -sf "$API/v2/state/ledger-end" | jq .offset; }
acs() { curl -sS -X POST "$API/v2/state/active-contracts" -H 'Content-Type: application/json' \
  -d "{\"filter\":{\"filtersByParty\":{\"$OP\":{\"cumulative\":[{\"WildcardFilter\":{\"includeCreatedEventBlob\":false}}]}}},\"verbose\":false,\"activeAtOffset\":$(end)}"; }
submit() { # $1=commands-json-array
  curl -sS -X POST "$API/v2/commands/submit-and-wait-for-transaction" -H 'Content-Type: application/json' -d @- <<J | jq -r '.transaction.updateId // .cause // "?"'
{"commands":{"commands":$1,"commandId":"prov-$RANDOM","userId":"showorsow","actAs":["$OP"]},"transactionFormat":{"eventFormat":{"verbose":false,"filtersByParty":{"$OP":{"cumulative":[{"WildcardFilter":{"includeCreatedEventBlob":false}}]}}},"transactionShape":"TRANSACTION_SHAPE_LEDGER_EFFECTS"}}
J
}

CUR=$(acs)
# 2) ensure a DemoIssuer (create if none visible).
if ! echo "$CUR" | jq -e '.[].contractEntry.JsActiveContract.createdEvent | select(.templateId|test("DemoToken:DemoIssuer$"))' >/dev/null 2>&1; then
  echo "[prov] create DemoIssuer -> $(submit "[{\"CreateCommand\":{\"templateId\":\"#showorsow-demo-token:DemoToken:DemoIssuer\",\"createArguments\":{\"issuer\":\"$OP\"}}}]")"
else echo "[prov] DemoIssuer present"; fi

# 3) rebuild the DemoAllocationFactory with ALL hosted user parties as senders.
SENDERS=$(curl -sf "$API/v2/parties" | jq -c "[.partyDetails[].party | select(. != \"$OP\") | select(startswith(\"participant\")|not)]")
[ "$SENDERS" = "[]" ] || [ -z "$SENDERS" ] && SENDERS="[\"$OP\"]"
# archive any existing factory, then create one with the current sender set.
echo "$CUR" | jq -r '.[].contractEntry.JsActiveContract.createdEvent | select(.templateId|test("DemoToken:DemoAllocationFactory$")) | "\(.templateId)\t\(.contractId)"' | while IFS=$'\t' read tid cid; do
  submit "[{\"ExerciseCommand\":{\"templateId\":\"$tid\",\"contractId\":\"$cid\",\"choice\":\"Archive\",\"choiceArgument\":{}}}]" >/dev/null; echo "[prov] archived old factory"
done
echo "[prov] create DemoAllocationFactory senders=$SENDERS -> $(submit "[{\"CreateCommand\":{\"templateId\":\"#showorsow-demo-token:DemoToken:DemoAllocationFactory\",\"createArguments\":{\"admin\":\"$OP\",\"senders\":$SENDERS}}}]")"
echo "[prov] done"
