import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

interface HfcHeader {
  contract_id: string;
  hfc_version: string;
  template_slug: string;
  template_version: string;
  created_at: string;
  forged_by: string;
  description?: string;
  tags?: string[];
}

type GateOperator =
  | "exists" | "not_exists" | "equals" | "not_equals"
  | "contains" | "command_ok" | "command_fail"
  | "env_set" | "port_free" | "port_used";

interface HfcGate {
  id: string;
  description: string;
  operator: GateOperator;
  target: string;
  expected?: string;
  command?: string;
  on_failure: "abort" | "warn" | "skip";
  error_message?: string;
}

type BomFileMode = "0644" | "0755" | "0600" | "0700" | "0400";

interface HfcBomItem {
  id: string;
  path: string;
  content: string;
  is_base64?: boolean;
  mode: BomFileMode;
  owner?: string;
  create_parents?: boolean;
  is_template?: boolean;
  description?: string;
}

type OperationType = "shell" | "docker" | "systemctl" | "apt" | "curl" | "git" | "custom";

interface HfcOperation {
  id: string;
  order: number;
  type: OperationType;
  description: string;
  command: string;
  workdir?: string;
  env?: Record<string, string>;
  timeout?: number;
  retries?: number;
  retry_delay?: number;
  ignore_errors?: boolean;
  requires_gate?: string;
  success_message?: string;
  failure_message?: string;
}

interface HfcProof {
  integrity_hash: string;
  server_signature: string;
  signed_at: string;
  signer_version: string;
  template_hash?: string;
  inputs_hash?: string;
}

interface HamayniFinalContract {
  header: HfcHeader;
  gates: HfcGate[];
  bom: HfcBomItem[];
  operations: HfcOperation[];
  proofs: HfcProof;
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function replaceVariables(template: string, inputs: Record<string, unknown>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, varName) => {
    const value = inputs[varName];
    if (value === undefined || value === null) return `{{${varName}}}`;
    if (typeof value === "object") return JSON.stringify(value);
    return String(value);
  });
}

function deepReplaceVariables(obj: unknown, inputs: Record<string, unknown>): unknown {
  if (typeof obj === "string") return replaceVariables(obj, inputs);
  if (Array.isArray(obj)) return obj.map((item) => deepReplaceVariables(item, inputs));
  if (obj !== null && typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = deepReplaceVariables(value, inputs);
    }
    return result;
  }
  return obj;
}

async function sha256(data: string): Promise<string> {
  const encoder = new TextEncoder();
  const dataBuffer = encoder.encode(data);
  const hashBuffer = await crypto.subtle.digest("SHA-256", dataBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function signContract(data: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(data));
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function compileGateToBash(gate: HfcGate): string {
  const lines: string[] = [];
  lines.push(`# [GATE] ${gate.id}: ${gate.description}`);
  lines.push(`log_gate "${gate.id}" "Checking: ${gate.description}"`);

  let condition = "";
  switch (gate.operator) {
    case "exists":
      condition = `[ -e "${gate.target}" ]`;
      break;
    case "not_exists":
      condition = `[ ! -e "${gate.target}" ]`;
      break;
    case "equals":
      condition = `[ "${gate.target}" = "${gate.expected}" ]`;
      break;
    case "not_equals":
      condition = `[ "${gate.target}" != "${gate.expected}" ]`;
      break;
    case "contains":
      condition = `echo "${gate.target}" | grep -q "${gate.expected}"`;
      break;
    case "command_ok":
      condition = gate.command || "true";
      break;
    case "command_fail":
      condition = `! ${gate.command || "false"}`;
      break;
    case "env_set":
      condition = `[ -n "\${${gate.target}:-}" ]`;
      break;
    case "port_free":
      condition = `! netstat -tuln 2>/dev/null | grep -q ":${gate.target} " && ! ss -tuln 2>/dev/null | grep -q ":${gate.target} "`;
      break;
    case "port_used":
      condition = `netstat -tuln 2>/dev/null | grep -q ":${gate.target} " || ss -tuln 2>/dev/null | grep -q ":${gate.target} "`;
      break;
  }

  const errorMsg = gate.error_message || `Gate ${gate.id} failed`;

  if (gate.on_failure === "abort") {
    lines.push(`if ! (${condition}); then`);
    lines.push(`  log_error "GATE_FAILED" "${errorMsg}"`);
    lines.push(`  exit 1`);
    lines.push(`fi`);
  } else if (gate.on_failure === "warn") {
    lines.push(`if ! (${condition}); then`);
    lines.push(`  log_warn "GATE_WARNING" "${errorMsg}"`);
    lines.push(`fi`);
  } else {
    lines.push(`GATE_${gate.id.toUpperCase().replace(/-/g, "_")}=0`);
    lines.push(`if (${condition}); then`);
    lines.push(`  GATE_${gate.id.toUpperCase().replace(/-/g, "_")}=1`);
    lines.push(`  log_gate "${gate.id}" "PASSED"`);
    lines.push(`else`);
    lines.push(`  log_warn "GATE_SKIPPED" "${errorMsg}"`);
    lines.push(`fi`);
  }

  lines.push("");
  return lines.join("\n");
}

function compileBomToBash(item: HfcBomItem): string {
  const lines: string[] = [];
  lines.push(`# [BOM] ${item.id}: ${item.description || item.path}`);

  const isDirectory = item.content === "" &&
    (item.description?.toLowerCase().includes("directory") ||
     item.id.startsWith("dir-") || item.id.startsWith("dir_"));

  if (isDirectory) {
    lines.push(`log_op "BOM" "Creating directory ${item.path}"`);
    lines.push(`mkdir -p "${item.path}"`);
    lines.push(`chmod ${item.mode} "${item.path}"`);
    if (item.owner) lines.push(`chown ${item.owner} "${item.path}"`);
    lines.push(`log_op "BOM" "Created directory ${item.path} successfully"`);
    lines.push("");
    return lines.join("\n");
  }

  lines.push(`log_op "BOM" "Deploying file ${item.path}"`);
  if (item.create_parents) lines.push(`mkdir -p "$(dirname "${item.path}")"`);

  if (item.is_base64) {
    lines.push(`echo "${item.content}" | base64 -d > "${item.path}"`);
  } else {
    const encoder = new TextEncoder();
    const data = encoder.encode(item.content);
    const base64Content = btoa(String.fromCharCode(...data));
    lines.push(`echo "${base64Content}" | base64 -d > "${item.path}"`);
  }

  lines.push(`chmod ${item.mode} "${item.path}"`);
  if (item.owner) lines.push(`chown ${item.owner} "${item.path}"`);
  lines.push(`log_op "BOM" "Deployed ${item.path} successfully"`);
  lines.push("");
  return lines.join("\n");
}

function compileOperationToBash(op: HfcOperation): string {
  const lines: string[] = [];
  lines.push(`# [OP:${op.order}] ${op.id}: ${op.description}`);
  lines.push(`log_op "${op.id}" "Starting: ${op.description}"`);

  if (op.requires_gate) {
    const gateVar = `GATE_${op.requires_gate.toUpperCase().replace(/-/g, "_")}`;
    lines.push(`if [ "\${${gateVar}:-1}" != "1" ]; then`);
    lines.push(`  log_warn "${op.id}" "Skipped due to gate ${op.requires_gate}"`);
    lines.push(`else`);
  }

  if (op.workdir) lines.push(`pushd "${op.workdir}" > /dev/null`);

  if (op.env) {
    for (const [key, value] of Object.entries(op.env)) {
      lines.push(`export ${key}="${value}"`);
    }
  }

  let cmd = op.command;
  if (op.timeout) {
    cmd = `timeout ${op.timeout} bash -c '${cmd.replace(/'/g, "'\\''")}'`;
  }

  if (op.retries && op.retries > 1) {
    const delay = op.retry_delay || 5;
    lines.push(`RETRY_COUNT=0`);
    lines.push(`MAX_RETRIES=${op.retries}`);
    lines.push(`while [ $RETRY_COUNT -lt $MAX_RETRIES ]; do`);
    lines.push(`  if ${cmd}; then break; fi`);
    lines.push(`  RETRY_COUNT=$((RETRY_COUNT + 1))`);
    lines.push(`  if [ $RETRY_COUNT -lt $MAX_RETRIES ]; then`);
    lines.push(`    log_warn "${op.id}" "Retry $RETRY_COUNT/$MAX_RETRIES in ${delay}s..."`);
    lines.push(`    sleep ${delay}`);
    lines.push(`  else`);
    if (op.ignore_errors) {
      lines.push(`    log_warn "${op.id}" "${op.failure_message || "Operation failed but continuing"}"`);
    } else {
      lines.push(`    log_error "${op.id}" "${op.failure_message || "Operation failed after retries"}"`);
      lines.push(`    exit 1`);
    }
    lines.push(`  fi`);
    lines.push(`done`);
  } else {
    if (op.ignore_errors) {
      lines.push(`${cmd} || log_warn "${op.id}" "${op.failure_message || "Command failed but ignoring"}"`);
    } else {
      lines.push(`${cmd}`);
    }
  }

  if (op.workdir) lines.push(`popd > /dev/null`);
  if (op.requires_gate) lines.push(`fi`);

  lines.push(`log_op "${op.id}" "${op.success_message || "Completed successfully"}"`);
  lines.push("");
  return lines.join("\n");
}

function compileHfcToBash(contract: HamayniFinalContract): string {
  const lines: string[] = [];

  lines.push("#!/bin/bash");
  lines.push("#");
  lines.push(`# HAMAYNI Contract: ${contract.header.contract_id}`);
  lines.push(`# Template: ${contract.header.template_slug} v${contract.header.template_version}`);
  lines.push(`# Generated: ${contract.header.created_at}`);
  lines.push(`# Integrity Hash: ${contract.proofs.integrity_hash}`);
  lines.push("#");
  lines.push("# DO NOT MODIFY - Auto-generated by HAMAYNI Factory");
  lines.push("#");
  lines.push("");
  lines.push("set -euo pipefail");
  lines.push("IFS=$'\\n\\t'");
  lines.push("");

  lines.push("# ============================================");
  lines.push("# LOGGING FUNCTIONS");
  lines.push("# ============================================");
  lines.push("");
  lines.push('LOG_FILE="/var/log/hamayni/${CONTRACT_ID:-unknown}.log"');
  lines.push('mkdir -p "$(dirname "$LOG_FILE")" 2>/dev/null || true');
  lines.push("");
  lines.push("log_msg() {");
  lines.push('  local level="$1" tag="$2" msg="$3"');
  lines.push('  local timestamp=$(date -u +"%Y-%m-%dT%H:%M:%SZ")');
  lines.push('  local log_line="[$timestamp] [$level] [$tag] $msg"');
  lines.push('  echo "$log_line"');
  lines.push('  echo "$log_line" >> "$LOG_FILE" 2>/dev/null || true');
  lines.push("}");
  lines.push("");
  lines.push('log_gate() { log_msg "GATE" "$1" "$2"; }');
  lines.push('log_op() { log_msg "OP" "$1" "$2"; }');
  lines.push('log_error() { log_msg "ERROR" "$1" "$2"; }');
  lines.push('log_warn() { log_msg "WARN" "$1" "$2"; }');
  lines.push('log_info() { log_msg "INFO" "$1" "$2"; }');
  lines.push("");

  lines.push("# ============================================");
  lines.push("# CONTRACT METADATA");
  lines.push("# ============================================");
  lines.push("");
  lines.push(`export CONTRACT_ID="${contract.header.contract_id}"`);
  lines.push(`export TEMPLATE_SLUG="${contract.header.template_slug}"`);
  lines.push(`export TEMPLATE_VERSION="${contract.header.template_version}"`);
  lines.push(`export HFC_VERSION="${contract.header.hfc_version}"`);
  lines.push(`export INTEGRITY_HASH="${contract.proofs.integrity_hash}"`);
  lines.push("");
  lines.push('log_info "INIT" "Starting HAMAYNI contract execution"');
  lines.push('log_info "INIT" "Contract ID: $CONTRACT_ID"');
  lines.push("");

  if (contract.gates.length > 0) {
    lines.push("# ============================================");
    lines.push("# GATES - Pre-execution checks");
    lines.push("# ============================================");
    lines.push("");
    for (const gate of contract.gates) {
      lines.push(compileGateToBash(gate));
    }
  }

  if (contract.bom.length > 0) {
    lines.push("# ============================================");
    lines.push("# BOM - Bill of Materials deployment");
    lines.push("# ============================================");
    lines.push("");
    for (const item of contract.bom) {
      lines.push(compileBomToBash(item));
    }
  }

  if (contract.operations.length > 0) {
    lines.push("# ============================================");
    lines.push("# OPERATIONS - Command execution");
    lines.push("# ============================================");
    lines.push("");
    const sortedOps = [...contract.operations].sort((a, b) => a.order - b.order);
    for (const op of sortedOps) {
      lines.push(compileOperationToBash(op));
    }
  }

  lines.push("# ============================================");
  lines.push("# COMPLETION");
  lines.push("# ============================================");
  lines.push("");
  lines.push('log_info "COMPLETE" "Contract execution finished successfully"');
  lines.push('log_info "COMPLETE" "Integrity verified: $INTEGRITY_HASH"');
  lines.push("");
  lines.push("exit 0");

  return lines.join("\n");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ status: "error", message: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: userData, error: authError } = await supabase.auth.getUser();
    if (authError || !userData?.user) {
      return new Response(JSON.stringify({ status: "error", message: "Invalid token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const userId = userData.user.id;
    const body = await req.json();
    const { template_slug, inputs } = body;

    if (!template_slug) {
      return new Response(JSON.stringify({ status: "error", message: "template_slug is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const { data: template, error: templateError } = await supabase
      .from("template_canons")
      .select("*")
      .eq("slug", template_slug)
      .eq("is_published", true)
      .maybeSingle();

    if (templateError || !template) {
      return new Response(JSON.stringify({ status: "error", message: `Template not found: ${template_slug}` }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const templateContent = template.content;
    const contractId = crypto.randomUUID();
    const now = new Date().toISOString();

    const resolvedInputs = { ...inputs, contract_id: contractId, created_at: now };

    const contractWithoutProofs = deepReplaceVariables(templateContent, resolvedInputs);

    const contractJson = JSON.stringify(contractWithoutProofs);
    const integrityHash = await sha256(contractJson);
    const signingSecret = Deno.env.get("HAMAYNI_SIGNING_SECRET") || "default-hamayni-secret-2024";
    const serverSignature = await signContract(contractJson, signingSecret);

    const finalContract: HamayniFinalContract = {
      ...(contractWithoutProofs as HamayniFinalContract),
      header: {
        ...(contractWithoutProofs as HamayniFinalContract).header,
        contract_id: contractId,
        hfc_version: "1.0",
        template_slug: template.slug,
        template_version: template.version,
        created_at: now,
        forged_by: userId,
      },
      proofs: {
        integrity_hash: integrityHash,
        server_signature: serverSignature,
        signed_at: now,
        signer_version: "hamayni-factory-3.1",
      },
    };

    const compiledScript = compileHfcToBash(finalContract);

    const { data: intention } = await supabase.from("intentions").insert({
      user_id: userId,
      template_id: template.id,
      inputs: inputs || {},
      status: "FORGED",
    }).select("id").single();

    await supabase.from("contracts").insert({
      id: contractId,
      user_id: userId,
      intention_id: intention?.id || null,
      hfc_json: finalContract,
      compiled_script: compiledScript,
      integrity_hash: integrityHash,
      status: "PENDING",
    });

    return new Response(JSON.stringify({
      contract_id: contractId,
      integrity_hash: integrityHash,
      compiled_script: compiledScript,
      hfc_json: finalContract,
      status: "success",
      message: "Contract forged successfully",
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });

  } catch (error) {
    const errMsg = error instanceof Error ? error.message : "Unknown error";
    console.error("Factory error:", errMsg);
    return new Response(JSON.stringify({ status: "error", message: errMsg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});
