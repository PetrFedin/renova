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
NEXT_SID=$(python3 -c "import json,sys; d=json.loads(sys.argv[1]); current=next(x for x in d['stages'] if x['id']==sys.argv[2]); nxt=next((x for x in sorted(d['stages'], key=lambda x: x.get('sort_order', 0)) if x.get('sort_order', 0)>current.get('sort_order', 0) and x['status']=='planned'), None); print(nxt['id'] if nxt else '')" "$STAGES" "$SID")

# Полный защищённый поток: платёж этапа блокируется до приёмки и проходит после решения заказчика.
if [ "$STATUS" = "active" ]; then
  PAY=$(curl -sf -X POST "$API/api/v1/projects/$PID/payments" \
    -H "X-User-Id: $KID" -H 'Content-Type: application/json' \
    -d "{\"title\":\"E2E оплата этапа\",\"amount\":1,\"payment_type\":\"stage\",\"stage_id\":\"$SID\"}")
  PAYID=$(python3 -c "import json,sys; print(json.loads(sys.argv[1])['id'])" "$PAY")

  BLOCK_CODE=$(curl -s -o /tmp/renova-payment-blocked.json -w '%{http_code}' -X POST \
    "$API/api/v1/projects/$PID/payments/$PAYID/confirm" -H "X-User-Id: $CID")
  test "$BLOCK_CODE" = "409"

  ACCEPTANCE=$(curl -sf -X POST "$API/api/v1/projects/$PID/work-acceptances" \
    -H "X-User-Id: $KID" -H 'Content-Type: application/json' \
    -d "{\"stage_id\":\"$SID\",\"checklist\":[\"Проверить результат\"],\"comment\":\"E2E: готово к приёмке\"}")
  AID=$(python3 -c "import json,sys; print(json.loads(sys.argv[1])['id'])" "$ACCEPTANCE")

  curl -sf -X POST "$API/api/v1/projects/$PID/work-acceptances/$AID/accept" \
    -H "X-User-Id: $CID" -H 'Content-Type: application/json' \
    -d '{"quality_score":10,"comment":"E2E: принято"}' | grep -q 'accepted'

  AFTER_ACCEPT=$(curl -sf "$API/api/v1/projects/$PID" -H "X-User-Id: $CID")
  ACCEPTED_STATUS=$(python3 -c "import json,sys; d=json.loads(sys.argv[1]); print(next(x['status'] for x in d['stages'] if x['id']==sys.argv[2]))" "$AFTER_ACCEPT" "$SID")
  test "$ACCEPTED_STATUS" = "done"

  if [ -n "$NEXT_SID" ]; then
    NEXT_STATUS=$(python3 -c "import json,sys; d=json.loads(sys.argv[1]); print(next(x['status'] for x in d['stages'] if x['id']==sys.argv[2]))" "$AFTER_ACCEPT" "$NEXT_SID")
    test "$NEXT_STATUS" = "active"
  fi

  STAGE_PAYMENT_COUNT=$(curl -sf "$API/api/v1/projects/$PID/payments" -H "X-User-Id: $CID" | python3 -c "import json,sys; rows=json.load(sys.stdin); print(sum(1 for x in rows if x.get('stage_id')==sys.argv[1] and x.get('payment_type')=='stage'))" "$SID")
  test "$STAGE_PAYMENT_COUNT" = "1"

  curl -sf -X POST "$API/api/v1/projects/$PID/payments/$PAYID/confirm" \
    -H "X-User-Id: $CID" | grep -q 'confirmed'
  echo "E2E acceptance/payment: blocked-before, accepted, next-stage-active, single-payment, confirmed-after OK"

  # D-07: canonical / legacy acceptance act visible in Document Center
  DOCS=$(curl -sf "$API/api/v1/projects/$PID/documents" -H "X-User-Id: $CID")
  echo "$DOCS" | python3 -c "import json,sys; d=json.load(sys.stdin); kinds={i.get('kind') for i in d.get('items',[])}; assert 'acceptance_act' in kinds or 'stage_acceptance_act' in kinds, kinds"
  echo "E2E documents: acceptance act present OK"


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
curl -sf --max-time 10 -X POST "$API/api/v1/projects/$PID/receipts/manual" -H "X-User-Id: $KID" -H 'Content-Type: application/json' -d '{"amount":500,"description":"Наличные за доставку","expense_category":"delivery"}' | grep -q amount
curl -sf --max-time 10 "$API/api/v1/projects/$PID/analytics/expenses.csv" -H "X-User-Id: $CID" | grep -q Комната
curl -sf "$API/api/v1/projects/$PID/analytics/expenses-summary" -H "X-User-Id: $CID" | grep -q by_room
curl -sf -X POST "$API/api/v1/projects/$PID/viewers" -H "X-User-Id: $CID" -H 'Content-Type: application/json' -d '{"phone":"+70000000003"}' | grep -q ok
curl -sf "$API/api/v1/projects/$PID/viewers" -H "X-User-Id: $CID" | grep -q user_id
VIEWER=$(curl -sf -X POST "$API/api/v1/auth/demo/guest" -H 'Content-Type: application/json' | python3 -c "import json,sys; print(json.load(sys.stdin)['id'])")
VP=$(curl -sf "$API/api/v1/projects" -H "X-User-Id: $VIEWER" | python3 -c "import json,sys; d=json.load(sys.stdin); print(len(d))")
test "$VP" -ge 1 && echo "E2E guest: projects=$VP OK"

# --- Document Center wave-2 (D-04/D-06/D-07) ---
UPLOAD=$(curl -sf -X POST "$API/api/v1/projects/$PID/documents/upload" \
  -H "X-User-Id: $CID" \
  -F "file=@/etc/hosts;type=text/plain;filename=hosts-note.txt" \
  -F "title=Договор-заглушка" \
  -F "document_type=contract")
DOC_ID=$(echo "$UPLOAD" | python3 -c "import json,sys; print(json.load(sys.stdin)['id'])")
test -n "$DOC_ID"
echo "E2E documents: upload OK id=$DOC_ID"

curl -sf -X POST "$API/api/v1/projects/$PID/documents/$DOC_ID/archive" -H "X-User-Id: $CID" | grep -q archived
curl -sf -X POST "$API/api/v1/projects/$PID/documents/$DOC_ID/restore" -H "X-User-Id: $CID" | grep -q active
echo "E2E documents: archive/restore OK"

# Completely foreign user (fresh register, not shared) → 404
FOREIGN_PHONE="+7999$(date +%s | tail -c 8)"
curl -sf -X POST "$API/api/v1/auth/sms/send" -H 'Content-Type: application/json' -d "{\"phone\":\"$FOREIGN_PHONE\"}" >/dev/null || true
# Dev OTP often accepts 0000 / 1234 — try register endpoint if SMS verify unsupported
FOREIGN=$(curl -sf -X POST "$API/api/v1/auth/register" -H 'Content-Type: application/json' \
  -d "{\"phone\":\"$FOREIGN_PHONE\",\"role\":\"customer\",\"full_name\":\"E2E Foreign\"}" \
  || curl -sf -X POST "$API/api/v1/auth/sms/verify" -H 'Content-Type: application/json' \
  -d "{\"phone\":\"$FOREIGN_PHONE\",\"code\":\"0000\",\"role\":\"customer\",\"full_name\":\"E2E Foreign\"}")
FOREIGN_ID=$(echo "$FOREIGN" | python3 -c "import json,sys; print(json.load(sys.stdin)['id'])")
FOREIGN_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$API/api/v1/projects/$PID/documents" -H "X-User-Id: $FOREIGN_ID")
test "$FOREIGN_CODE" = "404"
echo "E2E documents: foreign access 404 OK"

# Read-only viewer by shared phone +70000000003
VIEWER_RO=$(curl -sf "$API/api/v1/projects/$PID/viewers" -H "X-User-Id: $CID" | python3 -c "import json,sys; rows=json.load(sys.stdin); print(rows[0]['user_id'] if rows else '')")
if [ -z "$VIEWER_RO" ]; then
  SHARE=$(curl -sf -X POST "$API/api/v1/projects/$PID/viewers" -H "X-User-Id: $CID" -H 'Content-Type: application/json' -d '{"phone":"+70000000003"}')
  VIEWER_RO=$(echo "$SHARE" | python3 -c "import json,sys; print(json.load(sys.stdin).get('user_id',''))")
fi
test -n "$VIEWER_RO"
VIEWER_GET=$(curl -s -o /dev/null -w "%{http_code}" "$API/api/v1/projects/$PID/documents" -H "X-User-Id: $VIEWER_RO")
test "$VIEWER_GET" = "200"
VIEWER_WRITE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API/api/v1/projects/$PID/documents/upload" \
  -H "X-User-Id: $VIEWER_RO" \
  -F "file=@/etc/hosts;type=text/plain;filename=nope.txt" \
  -F "title=viewer-denied")
test "$VIEWER_WRITE" = "403" -o "$VIEWER_WRITE" = "404"
echo "E2E documents: viewer read-only OK (get=$VIEWER_GET write=$VIEWER_WRITE viewer=$VIEWER_RO)"

# --- Wave 3: media membership ACL + legal hold ---
MEDIA_PATH=$(echo "$UPLOAD" | python3 -c "import json,sys,re; u=json.load(sys.stdin).get('href') or ''; u=re.sub(r'^https?://[^/]+','',u); print(u.split('/api/v1/media/',1)[-1] if '/api/v1/media/' in u or u.startswith('api/v1/media/') else '')")
if [ -n "$MEDIA_PATH" ]; then
  NOAUTH=$(curl -s -o /dev/null -w "%{http_code}" "$API/api/v1/media/$MEDIA_PATH")
  test "$NOAUTH" = "401"
  OWNER_M=$(curl -s -o /dev/null -w "%{http_code}" "$API/api/v1/media/$MEDIA_PATH" -H "X-User-Id: $CID")
  test "$OWNER_M" = "200"
  FOREIGN_M=$(curl -s -o /dev/null -w "%{http_code}" "$API/api/v1/media/$MEDIA_PATH" -H "X-User-Id: $FOREIGN_ID")
  test "$FOREIGN_M" = "404"
  echo "E2E media ACL: noauth=$NOAUTH owner=$OWNER_M foreign=$FOREIGN_M OK"
else
  echo "E2E media ACL: SKIP (no href on upload)"
fi

HOLD=$(curl -sf -X POST "$API/api/v1/projects/$PID/documents/$DOC_ID/legal-hold" \
  -H "X-User-Id: $CID" -H 'Content-Type: application/json' \
  -d '{"enabled":true,"retention_until":"2030-01-01T00:00:00"}')
echo "$HOLD" | python3 -c "import json,sys; d=json.load(sys.stdin); assert d['meta']['legal_hold'] is True"
DEL_HOLD=$(curl -s -o /dev/null -w "%{http_code}" -X DELETE "$API/api/v1/projects/$PID/documents/$DOC_ID" -H "X-User-Id: $CID")
test "$DEL_HOLD" = "409"
curl -sf -X POST "$API/api/v1/projects/$PID/documents/$DOC_ID/legal-hold" \
  -H "X-User-Id: $CID" -H 'Content-Type: application/json' \
  -d '{"enabled":false}' >/dev/null
echo "E2E legal hold: block-delete=$DEL_HOLD OK"

# --- Wave 3b: OCR classify + e-sign providers ---
OCR_GET=$(curl -sf "$API/api/v1/projects/$PID/documents/$DOC_ID/ocr" -H "X-User-Id: $CID")
echo "$OCR_GET" | python3 -c "import json,sys; d=json.load(sys.stdin); assert d['ocr']['status']=='done'; assert d['ocr'].get('suggested_type')"
# Upload with contract in title → type applied
UP2=$(curl -sf -X POST "$API/api/v1/projects/$PID/documents/upload" \
  -H "X-User-Id: $CID" \
  -F "file=@/etc/hosts;type=text/plain;filename=note.txt" \
  -F "title=Договор на ремонт" \
  -F "document_type=upload")
echo "$UP2" | python3 -c "import json,sys; d=json.load(sys.stdin); assert d['kind']=='contract', d; assert d['meta']['ocr']['status']=='done'"
echo "E2E OCR: classify+apply OK"

PROVS=$(curl -sf "$API/api/v1/esign/providers" -H "X-User-Id: $CID")
echo "$PROVS" | python3 -c "import json,sys; d=json.load(sys.stdin); names={p['name'] for p in d['providers']}; assert 'in_app' in names and 'kontur' in names"
SIGN=$(curl -sf -X POST "$API/api/v1/projects/$PID/documents/$DOC_ID/sign" \
  -H "X-User-Id: $CID" -H 'Content-Type: application/json' \
  -d '{"signature_type":"in_app","provider":"in_app"}')
echo "$SIGN" | python3 -c "import json,sys; d=json.load(sys.stdin); assert d.get('signature_id')"
K501=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API/api/v1/projects/$PID/documents/$DOC_ID/sign" \
  -H "X-User-Id: $CID" -H 'Content-Type: application/json' \
  -d '{"provider":"kontur"}')
# already signed may 400, so use fresh upload for kontur 501
DOC3=$(curl -sf -X POST "$API/api/v1/projects/$PID/documents/upload" \
  -H "X-User-Id: $CID" \
  -F "file=@/etc/hosts;type=text/plain;filename=esign.txt" \
  -F "title=Для подписи контур" \
  -F "document_type=contract")
DID3=$(echo "$DOC3" | python3 -c "import json,sys; print(json.load(sys.stdin)['id'])")
K501=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API/api/v1/projects/$PID/documents/$DID3/sign" \
  -H "X-User-Id: $CID" -H 'Content-Type: application/json' \
  -d '{"provider":"kontur"}')
test "$K501" = "501"
echo "E2E e-sign: providers+in_app+kontur501=$K501 OK"




BATH_STAGES=$(curl -sf "$API/api/v1/projects/$PID" -H "X-User-Id: $CID" | python3 -c "import json,sys; d=json.load(sys.stdin); print(len(d.get('stages',[])))")
test "$BATH_STAGES" -ge 6 && echo "E2E stages: count=$BATH_STAGES OK"
echo "E2E extended: acceptance + payment gate + next stage + PDF + receipts + digest + expenses OK"
