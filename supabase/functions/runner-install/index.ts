import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    const url = new URL(req.url);
    const token = url.searchParams.get("token");

    if (!token) {
      return new Response("Missing token parameter", {
        status: 400,
        headers: { "Content-Type": "text/plain", ...corsHeaders }
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { data: server, error } = await supabase
      .from("servers")
      .select("id, name")
      .eq("token", token)
      .maybeSingle();

    if (error || !server) {
      return new Response("Invalid token", {
        status: 401,
        headers: { "Content-Type": "text/plain", ...corsHeaders }
      });
    }

    const installScript = `#!/bin/bash
# ╔══════════════════════════════════════════════════════════════════════════════╗
# ║  HAMAYNI RUNNER INSTALLER v3.1 "Maçon"                                       ║
# ╚══════════════════════════════════════════════════════════════════════════════╝

set -euo pipefail

HAMAYNI_DIR="/opt/hamayni"
HAMAYNI_TOKEN="${token}"
HAMAYNI_API="${supabaseUrl}/functions/v1/hamayni-runner-api"

echo "╔══════════════════════════════════════════════════════════════════════════════╗"
echo "║  🏗️  HAMAYNI RUNNER INSTALLER v3.1                                           ║"
echo "╚══════════════════════════════════════════════════════════════════════════════╝"

if [[ \\$EUID -ne 0 ]]; then
   echo "❌ Ce script doit être exécuté en tant que root (sudo)"
   exit 1
fi

mkdir -p "\\$HAMAYNI_DIR"
mkdir -p "\\$HAMAYNI_DIR/contracts"
mkdir -p "\\$HAMAYNI_DIR/logs"

echo "\\$HAMAYNI_TOKEN" > "\\$HAMAYNI_DIR/.token"
chmod 600 "\\$HAMAYNI_DIR/.token"

cat > "\\$HAMAYNI_DIR/runner.sh" << 'RUNNER_SCRIPT'
#!/bin/bash
set -euo pipefail

HAMAYNI_DIR="/opt/hamayni"
TOKEN=\\$(cat "\\$HAMAYNI_DIR/.token")
API_URL="PLACEHOLDER_API_URL"
HOSTNAME=\\$(hostname)
IP=\\$(hostname -I 2>/dev/null | awk '{print \\$1}' || echo "0.0.0.0")

HEARTBEAT_INTERVAL=60
CLAIM_INTERVAL=5
LAST_HEARTBEAT=0

log() {
    echo "[\\$(date '+%Y-%m-%d %H:%M:%S')] \\$1" | tee -a "\\$HAMAYNI_DIR/logs/runner.log"
}

send_heartbeat() {
    local response http_code
    response=\\$(curl -s -w "\\n%{http_code}" -X POST "\\$API_URL/heartbeat" \\
        -H "Content-Type: application/json" \\
        -d "{\\"token\\": \\"\\$TOKEN\\", \\"hostname\\": \\"\\$HOSTNAME\\", \\"ip\\": \\"\\$IP\\"}" 2>/dev/null || echo "000")

    http_code=\\$(echo "\\$response" | tail -n1)

    if [[ "\\$http_code" == "200" ]]; then
        log "💚 Heartbeat OK"
        return 0
    else
        log "❌ Heartbeat FAILED (HTTP \\$http_code)"
        return 1
    fi
}

claim_contract() {
    local response http_code body
    response=\\$(curl -s -w "\\n%{http_code}" -X POST "\\$API_URL/claim" \\
        -H "Content-Type: application/json" \\
        -d "{\\"token\\": \\"\\$TOKEN\\"}" 2>/dev/null || echo "000")

    http_code=\\$(echo "\\$response" | tail -n1)
    body=\\$(echo "\\$response" | sed '\\$d')

    if [[ "\\$http_code" == "204" ]]; then
        return 1
    elif [[ "\\$http_code" == "200" ]]; then
        echo "\\$body"
        return 0
    else
        log "⚠️  Claim error (HTTP \\$http_code)"
        return 1
    fi
}

execute_contract() {
    local cid="\\$1"
    local scr="\\$2"
    local script_file="\\$HAMAYNI_DIR/contracts/mission_\\${cid}.sh"
    local log_file="\\$HAMAYNI_DIR/logs/mission_\\${cid}.log"
    local exit_code status logs

    log "🔧 Executing contract: \\$cid"

    echo "\\$scr" > "\\$script_file"
    chmod +x "\\$script_file"

    set +e
    bash "\\$script_file" > "\\$log_file" 2>&1
    exit_code=\\$?
    set -e

    if [[ \\$exit_code -eq 0 ]]; then
        status="SUCCESS"
        log "✅ Contract \\$cid completed successfully"
    else
        status="FAILED"
        log "❌ Contract \\$cid failed (exit code: \\$exit_code)"
    fi

    logs=\\$(tail -c 10000 "\\$log_file" 2>/dev/null || echo "No logs available")
    report_result "\\$cid" "\\$status" "\\$logs"
}

report_result() {
    local cid="\\$1"
    local stat="\\$2"
    local lgs="\\$3"
    local escaped_logs=\\$(echo "\\$lgs" | jq -Rs '.')

    local response http_code
    response=\\$(curl -s -w "\\n%{http_code}" -X POST "\\$API_URL/report" \\
        -H "Content-Type: application/json" \\
        -d "{\\"token\\": \\"\\$TOKEN\\", \\"contract_id\\": \\"\\$cid\\", \\"status\\": \\"\\$stat\\", \\"logs\\": \\$escaped_logs}" 2>/dev/null || echo "000")

    http_code=\\$(echo "\\$response" | tail -n1)

    if [[ "\\$http_code" == "200" ]]; then
        log "📤 Report sent: \\$cid -> \\$stat"
    else
        log "⚠️  Report failed (HTTP \\$http_code)"
    fi
}

log "🚀 HAMAYNI RUNNER v3.1 démarré"
log "📡 API: \\$API_URL"

send_heartbeat || true
LAST_HEARTBEAT=\\$(date +%s)

while true; do
    NOW=\\$(date +%s)

    if (( NOW - LAST_HEARTBEAT >= HEARTBEAT_INTERVAL )); then
        send_heartbeat || true
        LAST_HEARTBEAT=\\$NOW
    fi

    claim_response=\\$(claim_contract) || claim_response=""

    if [[ -n "\\$claim_response" ]]; then
        cid=\\$(echo "\\$claim_response" | jq -r '.contract_id' 2>/dev/null || echo "")
        scr=\\$(echo "\\$claim_response" | jq -r '.script' 2>/dev/null || echo "")

        if [[ -n "\\$cid" && -n "\\$scr" ]]; then
            log "📥 Contract claimed: \\$cid"
            execute_contract "\\$cid" "\\$scr"
        fi
    fi

    sleep \\$CLAIM_INTERVAL
done
RUNNER_SCRIPT

sed -i "s|PLACEHOLDER_API_URL|\\$HAMAYNI_API|g" "\\$HAMAYNI_DIR/runner.sh"
chmod +x "\\$HAMAYNI_DIR/runner.sh"

apt-get update -qq && apt-get install -y -qq jq curl > /dev/null 2>&1 || yum install -y -q jq curl > /dev/null 2>&1 || true

cat > /etc/systemd/system/hamayni-runner.service << 'SERVICE_FILE'
[Unit]
Description=Hamayni Runner - Infrastructure d'Exécution Distribuée
After=network.target

[Service]
Type=simple
ExecStart=/opt/hamayni/runner.sh
Restart=always
RestartSec=10
User=root
WorkingDirectory=/opt/hamayni
StandardOutput=append:/opt/hamayni/logs/runner.log
StandardError=append:/opt/hamayni/logs/runner.log

[Install]
WantedBy=multi-user.target
SERVICE_FILE

systemctl daemon-reload
systemctl enable hamayni-runner.service
systemctl restart hamayni-runner.service

echo ""
echo "╔══════════════════════════════════════════════════════════════════════════════╗"
echo "║  ✅ INSTALLATION TERMINÉE                                                    ║"
echo "╚══════════════════════════════════════════════════════════════════════════════╝"
echo ""
echo "📋 Commandes utiles:"
echo "   • Voir les logs:    journalctl -u hamayni-runner -f"
echo "   • Statut:           systemctl status hamayni-runner"
echo "   • Redémarrer:       systemctl restart hamayni-runner"
echo ""
echo "🎉 Le serveur est prêt à recevoir et exécuter des contrats!"
`;

    return new Response(installScript, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Disposition": "inline",
        ...corsHeaders,
      },
    });
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : "Unknown error";
    console.error("Runner install error:", errMsg);
    return new Response(`Error: ${errMsg}`, {
      status: 500,
      headers: { "Content-Type": "text/plain", ...corsHeaders }
    });
  }
});
