#!/bin/sh
# End-to-end test of a built Podux against a real frps.
#
#   PODUX_BIN=./podux FRPS_BIN=./frps CATCHER_BIN=./catcher test/e2e/run.sh
#
# Needs curl. Uses ports 17000 (frps), 17500 (frps dashboard), 18080 (frps vhost
# HTTP), 17010 (frps tcpmux), 18090 (Podux), 18099 (webhook catcher), 16080-16090
# and 17100 on 127.0.0.1. Exits non-zero on the first failed check.
set -u
: "${PODUX_BIN:?}" "${FRPS_BIN:?}" "${CATCHER_BIN:?}"
WORK=$(mktemp -d)
B=http://127.0.0.1:18090
PIDS=""
cleanup() { for p in $PIDS; do kill "$p" 2>/dev/null; done; }
trap cleanup EXIT

fail() { echo "FAIL: $*"; echo "--- frpc log"; grep -v "^$" "$WORK/data/frpc/frpc.log" | tail -30; echo "--- podux errors"; grep -iE "error|warn" "$WORK/podux.log" | tail -10; exit 1; }
check() { # check <description> <expected substring> <actual>
  case "$3" in *"$2"*) echo "ok   $1" ;; *) fail "$1: expected '$2' in '$3'" ;; esac
}
wait_for() { # wait_for <description> <seconds> <command...>
  desc=$1; secs=$2; shift 2
  i=0; while [ $i -lt "$secs" ]; do "$@" >/dev/null 2>&1 && { echo "ok   $desc"; return; }; sleep 1; i=$((i + 1)); done
  fail "$desc (timed out after ${secs}s)"
}

cat > "$WORK/frps.toml" <<TOML
bindPort = 17000
vhostHTTPPort = 18080
tcpmuxHTTPConnectPort = 17010
subdomainHost = "e2e.test"
auth.token = "tok"
webServer.addr = "127.0.0.1"
webServer.port = 17500
webServer.user = "admin"
webServer.password = "pw"
TOML
"$FRPS_BIN" -c "$WORK/frps.toml" > "$WORK/frps.log" 2>&1 & PIDS="$PIDS $!"
"$CATCHER_BIN" 127.0.0.1:18099 "$WORK/hooks.log" & PIDS="$PIDS $!"
mkdir -p "$WORK/files" && echo "hello from static_file" > "$WORK/files/hello.txt"
"$PODUX_BIN" serve --http 127.0.0.1:18090 --dir "$WORK/data" > "$WORK/podux.log" 2>&1 & PIDS="$PIDS $!"
wait_for "podux starts" 30 curl -sf $B/api/health

curl -sf -XPOST $B/api/system/initialize -H 'content-type: application/json' \
  -d '{"email":"e2e@example.com","password":"12345678","language":"en"}' >/dev/null || fail "initialize"
login() {
  T=$(curl -s -XPOST $B/api/collections/fh_users/auth-with-password -H 'content-type: application/json' \
    -d '{"identity":"e2e@example.com","password":"12345678"}' | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')
  [ -n "$T" ] || fail "login"
}
login
api() { m=$1; u=$2; shift 2; curl -s -X"$m" "$B$u" -H "Authorization: $T" -H 'content-type: application/json' "$@"; }
id_of() { sed -n 's/.*"id":"\([a-z0-9]\{15\}\)".*/\1/p' | head -1; }
proxy() { # proxy <json fields>
  api POST /api/collections/fh_proxies/records -d "{\"serverId\":\"$S\",\"status\":\"enabled\",\"bootStatus\":\"offline\",$1}"
}

api PUT /api/notifications -d '{"enabled":true,"events":{"proxyDown":true,"frpcExited":true,"proxyExpired":true,"recovered":true},"webhook":{"enabled":true,"url":"http://127.0.0.1:18099/hook"}}' >/dev/null
S=$(api POST /api/collections/fh_servers/records -d '{"serverName":"e2e","serverAddr":"127.0.0.1","serverPort":17000,"auth":{"method":"token","token":"tok"},"dashboard":{"url":"http://127.0.0.1:17500","user":"admin","password":"pw"}}' | id_of)
[ -n "$S" ] || fail "create server"

TCP=$(proxy '"name":"web","proxyType":"tcp","localIP":"127.0.0.1","localPort":18090,"remotePort":16080,"healthCheck":{"type":"tcp","intervalSeconds":5}' | id_of)
proxy '"name":"site","proxyType":"http","localIP":"127.0.0.1","localPort":18090,"subdomain":"site","options":{"httpUser":"u","httpPassword":"p","locations":["/api"],"requestHeaders":{"set":{"x-e2e":"1"}}}' >/dev/null
proxy '"name":"files","proxyType":"http","customDomains":["files.example.org"],"plugin":{"type":"static_file","localPath":"'"$WORK/files"'","stripPrefix":"static"}' >/dev/null
proxy '"name":"mux","proxyType":"tcpmux","localIP":"127.0.0.1","localPort":18090,"customDomains":["mux.example.org"]' >/dev/null
NAS=$(proxy '"name":"nas","proxyType":"stcp","localIP":"127.0.0.1","localPort":18090,"secretKey":"k"' | id_of)
api POST /api/collections/fh_visitors/records -d "{\"name\":\"v\",\"visitorType\":\"stcp\",\"serverId\":\"$S\",\"serverName\":\"nas-$NAS\",\"secretKey\":\"k\",\"bindPort\":17100,\"status\":\"enabled\"}" >/dev/null
check "launch" "frpc started" "$(api POST /api/frpc/launch -d "{\"id\":\"$S\"}")"

wait_for "tcp tunnel" 20 curl -sf http://127.0.0.1:16080/api/health
wait_for "stcp visitor" 20 curl -sf http://127.0.0.1:17100/api/health
check "http basic auth required" "401" "$(curl -s -o /dev/null -w '%{http_code}' -H 'Host: site.e2e.test' http://127.0.0.1:18080/api/health)"
check "http with auth, location /api" "API is healthy" "$(curl -s -u u:p -H 'Host: site.e2e.test' http://127.0.0.1:18080/api/health)"
check "http outside the location" "404" "$(curl -s -o /dev/null -w '%{http_code}' -u u:p -H 'Host: site.e2e.test' http://127.0.0.1:18080/other)"
check "static_file plugin" "hello from static_file" "$(curl -s -H 'Host: files.example.org' http://127.0.0.1:18080/static/hello.txt)"
check "tcpmux httpconnect" "200" "$(curl -s -o /dev/null -w '%{http_code}' -p -x http://127.0.0.1:17010 http://mux.example.org/api/health)"

echo "== conflicts and batch"
check "port conflict" "validation_port_conflict" "$(proxy '"name":"dup","proxyType":"tcp","localPort":22,"remotePort":16080')"
check "lb group shares a port" '"id"' "$(proxy '"name":"lb1","proxyType":"tcp","localIP":"127.0.0.1","localPort":18090,"remotePort":16085,"options":{"loadBalancer":{"group":"g","groupKey":"k"}}')"
LB2=$(proxy '"name":"lb2","proxyType":"tcp","localIP":"127.0.0.1","localPort":18090,"remotePort":16085,"options":{"loadBalancer":{"group":"g","groupKey":"k"}}' | id_of)
[ -n "$LB2" ] || fail "second proxy of the lb group"
check "batch disable" '"count":1' "$(api POST /api/proxies/batch -d "{\"ids\":[\"$LB2\"],\"action\":\"disable\"}")"

echo "== traffic, probes, export, logs"
curl -s http://127.0.0.1:16080/api/health >/dev/null
sleep 16 # frps dashboard stats are cached for 15s
check "traffic from frps dashboard" "todayTrafficIn" "$(api GET /api/proxies/status)"
check "7-day history" "trafficIn" "$(api GET /api/proxies/$TCP/traffic)"
check "frps info" '"version"' "$(api GET /api/servers/$S/frps)"
wait_for "external probe marks the tcp proxy reachable" 75 sh -c "curl -s '$B/api/proxies/status' -H 'Authorization: $T' | grep -q '\"reachable\":true'"
check "export redacts the token" "<redacted>" "$(api GET "/api/frpc/export?id=$S")"
check "log download" "start proxy success" "$(api GET "/api/frpc/logs/download?id=$S")"
check "all-servers log names servers" "[e2e]" "$(api GET "/api/frpc/logs/download?id=all")"

echo "== expiry"
EXP=$(proxy '"name":"tmp","proxyType":"tcp","localIP":"127.0.0.1","localPort":18090,"remotePort":16089,"expiresAt":"2020-01-01 00:00:00.000Z"' | id_of)
wait_for "expired proxy disabled" 75 sh -c "curl -s '$B/api/collections/fh_proxies/records/$EXP' -H 'Authorization: $T' | grep -q '\"status\":\"disabled\"'"

echo "== backup and restore"
BK=$(api POST /api/system/backups | sed -n 's/.*"name":"\([^"]*\)".*/\1/p')
[ -n "$BK" ] || fail "create backup"
AFTER=$(proxy '"name":"after","proxyType":"udp","localPort":53,"remotePort":16090' | id_of)
check "restore accepted" "restoring" "$(api POST "/api/system/backups/$BK/restore")"
sleep 3
wait_for "podux restarts after restore" 60 curl -sf $B/api/health
login
check "data restored to the backup" "404" "$(curl -s -o /dev/null -w '%{http_code}' "$B/api/collections/fh_proxies/records/$AFTER" -H "Authorization: $T")"

echo "== alerts"
api POST /api/frpc/launch -d "{\"id\":\"$S\"}" >/dev/null
BAD=$(api POST /api/collections/fh_servers/records -d '{"serverName":"bad","serverAddr":"127.0.0.1","serverPort":17999}' | id_of)
api POST /api/frpc/launch -d "{\"id\":\"$BAD\"}" >/dev/null
wait_for "frpc_exited webhook" 20 grep -q frpc_exited "$WORK/hooks.log"
check "proxy_expired webhook" "proxy_expired" "$(cat "$WORK/hooks.log")"

echo "PASS"
