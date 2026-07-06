#!/usr/bin/env bash
set -euo pipefail
API="${API:-http://127.0.0.1:8100}"
CUST=$(curl -sf -X POST "$API/api/v1/auth/demo" -H 'Content-Type: application/json' -d '{"role":"customer"}')
CONT=$(curl -sf -X POST "$API/api/v1/auth/demo" -H 'Content-Type: application/json' -d '{"role":"contractor"}')
CID=$(python3 -c "import json,sys; print(json.loads(sys.argv[1])['id'])" "$CUST")
KID=$(python3 -c "import json,sys; print(json.loads(sys.argv[1])['id'])" "$CONT")
PID=$(curl -sf --max-time 10 "$API/api/v1/projects" -H "X-User-Id: $CID" | python3 -c "import json,sys; ps=json.load(sys.stdin); p=next((x for x in ps if x.get('contractor_id')), ps[0]); print(p['id'])")
HAS=$(curl -sf --max-time 10 "$API/api/v1/projects/$PID" -H "X-User-Id: $CID" | python3 -c "import json,sys; print(json.load(sys.stdin).get('contractor_id') or '')")
if [ -z "$HAS" ]; then
  curl -sf --max-time 10 -X POST "$API/api/v1/subscription/checkout" -H "X-User-Id: $KID" >/dev/null || true
  curl -sf --max-time 10 -X POST "$API/api/v1/projects/$PID/assign" -H "X-User-Id: $KID" >/dev/null
fi
STAGES=$(curl -sf "$API/api/v1/projects/$PID" -H "X-User-Id: $CID")
SID=$(python3 -c "import json,sys; d=json.loads(sys.argv[1]); s=next((x for x in d['stages'] if x['status']=='active'), None); print(s['id'] if s else d['stages'][0]['id'])" "$STAGES")
STATUS=$(python3 -c "import json,sys; d=json.loads(sys.argv[1]); print(next(x['status'] for x in d['stages'] if x['id']==sys.argv[2]))" "$STAGES" "$SID")
if [ "$STATUS" = "active" ]; then
  curl -sf -X POST "$API/api/v1/projects/$PID/stages/$SID/submit" -H "X-User-Id: $KID" >/dev/null
  curl -sf -X POST "$API/api/v1/projects/$PID/stages/$SID/accept" -H "X-User-Id: $CID" >/dev/null
fi
curl -sf "$API/api/v1/projects/$PID/calendar" -H "X-User-Id: $CID" | grep -q events
curl -sf "$API/api/v1/projects/$PID/chats" -H "X-User-Id: $CID" | grep -q '\['
curl -sf "$API/api/v1/audit/logs" -H "X-User-Id: $KID" | grep -q '\['
echo "E2E OK: project=$PID stage=$SID status=$STATUS"
curl -sf --max-time 20 -o /dev/null -w "" "$API/api/v1/projects/$PID/estimate.pdf" -H "X-User-Id: $CID"
curl -sf --max-time 15 -X POST "$API/api/v1/projects/$PID/receipts/scan" -H "X-User-Id: $KID" -H 'Content-Type: application/json' \
  -d '{"qr_raw":"t=20260627T1200&s=1500.00&fn=9999078901234567&i=12345&fp=1234567890&n=1"}' | grep -q amount
curl -sf "$API/api/v1/notifications/approval-digest" -H "X-User-Id: $KID" | grep -q count
ROOM=$(curl -sf "$API/api/v1/projects/$PID" -H "X-User-Id: $CID" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['rooms'][0]['id'] if d.get('rooms') else '')")
if [ -n "$ROOM" ]; then
  curl -sf --max-time 15 -X POST "$API/api/v1/projects/$PID/receipts/scan" -H "X-User-Id: $KID" -H 'Content-Type: application/json' \
    -d "{\"qr_raw\":\"t=20260627T1200&s=800.00&fn=9999078901234567&i=12346&fp=1234567891&n=1\",\"room_id\":\"$ROOM\",\"expense_category\":\"materials\"}" | grep -q stage_id
fi
curl -sf --max-time 10 -X POST "$API/api/v1/projects/$PID/receipts/manual" -H "X-User-Id: $KID" -H 'Content-Type: application/json'   -d '{"amount":500,"description":"Наличные за доставку","expense_category":"delivery"}' | grep -q amount
curl -sf --max-time 10 "$API/api/v1/projects/$PID/analytics/expenses.csv" -H "X-User-Id: $CID" | grep -q Комната
curl -sf "$API/api/v1/projects/$PID/analytics/expenses-summary" -H "X-User-Id: $CID" | grep -q by_room
curl -sf -X POST "$API/api/v1/projects/$PID/viewers" -H "X-User-Id: $CID" -H 'Content-Type: application/json' -d '{"phone":"+70000000003"}' | grep -q ok
curl -sf "$API/api/v1/projects/$PID/viewers" -H "X-User-Id: $CID" | grep -q user_id
VIEWER=$(curl -sf -X POST "$API/api/v1/auth/demo/guest" -H 'Content-Type: application/json' | python3 -c "import json,sys; print(json.load(sys.stdin)['id'])")
VP=$(curl -sf "$API/api/v1/projects" -H "X-User-Id: $VIEWER" | python3 -c "import json,sys; d=json.load(sys.stdin); print(len(d))")
test "$VP" -ge 1 && echo "E2E guest: projects=$VP OK"
# bathroom plan stages
BATH_STAGES=$(curl -sf "$API/api/v1/projects/$PID" -H "X-User-Id: $CID" | python3 -c "import json,sys; d=json.load(sys.stdin); print(len(d.get('stages',[])))")
test "$BATH_STAGES" -ge 6 && echo "E2E stages: count=$BATH_STAGES OK"
echo "E2E extended: PDF + receipts + digest + expenses OK"
