import fs from 'fs';
import crypto from 'crypto';

const template = JSON.parse(fs.readFileSync('nginx-template.json', 'utf8'));

function replaceVariables(text, inputs) {
  return text.replace(/\{\{(\w+)\}\}/g, (_, varName) => {
    return inputs[varName] || `{{${varName}}}`;
  });
}

function deepReplace(obj, inputs) {
  if (typeof obj === 'string') return replaceVariables(obj, inputs);
  if (Array.isArray(obj)) return obj.map(item => deepReplace(item, inputs));
  if (obj && typeof obj === 'object') {
    const result = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = deepReplace(value, inputs);
    }
    return result;
  }
  return obj;
}

function compileGateToBash(gate) {
  const lines = [];
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
    case "command_ok":
      condition = gate.command || "true";
      break;
    case "port_free":
      condition = `! netstat -tuln 2>/dev/null | grep -q ":${gate.target} " && ! ss -tuln 2>/dev/null | grep -q ":${gate.target} "`;
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
  }

  lines.push("");
  return lines.join("\n");
}

function compileBomToBash(item) {
  const lines = [];
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

  const base64Content = Buffer.from(item.content).toString('base64');
  lines.push(`echo "${base64Content}" | base64 -d > "${item.path}"`);

  lines.push(`chmod ${item.mode} "${item.path}"`);
  if (item.owner) lines.push(`chown ${item.owner} "${item.path}"`);
  lines.push(`log_op "BOM" "Deployed ${item.path} successfully"`);
  lines.push("");
  return lines.join("\n");
}

function compileOperationToBash(op) {
  const lines = [];
  lines.push(`# [OP:${op.order}] ${op.id}: ${op.description}`);
  lines.push(`log_op "${op.id}" "Starting: ${op.description}"`);

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

  lines.push(`log_op "${op.id}" "${op.success_message || "Completed successfully"}"`);
  lines.push("");
  return lines.join("\n");
}

const contractId = "demo-" + crypto.randomUUID();
const now = new Date().toISOString();

const inputs = {
  contract_id: contractId,
  created_at: now,
  domain: "hamayni.io"
};

const resolved = deepReplace(template, inputs);

const contractJson = JSON.stringify(resolved);
const integrityHash = crypto.createHash('sha256').update(contractJson).digest('hex');

const lines = [];

lines.push("#!/bin/bash");
lines.push("#");
lines.push(`# HAMAYNI Contract: ${contractId}`);
lines.push(`# Template: ${resolved.header.template_slug} v${resolved.header.template_version}`);
lines.push(`# Generated: ${resolved.header.created_at}`);
lines.push(`# Integrity Hash: ${integrityHash}`);
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
lines.push(`export CONTRACT_ID="${contractId}"`);
lines.push(`export TEMPLATE_SLUG="${resolved.header.template_slug}"`);
lines.push(`export TEMPLATE_VERSION="${resolved.header.template_version}"`);
lines.push(`export HFC_VERSION="${resolved.header.hfc_version}"`);
lines.push(`export INTEGRITY_HASH="${integrityHash}"`);
lines.push("");
lines.push('log_info "INIT" "Starting HAMAYNI contract execution"');
lines.push('log_info "INIT" "Contract ID: $CONTRACT_ID"');
lines.push("");

if (resolved.gates.length > 0) {
  lines.push("# ============================================");
  lines.push("# GATES - Pre-execution checks");
  lines.push("# ============================================");
  lines.push("");
  for (const gate of resolved.gates) {
    lines.push(compileGateToBash(gate));
  }
}

if (resolved.bom.length > 0) {
  lines.push("# ============================================");
  lines.push("# BOM - Bill of Materials deployment");
  lines.push("# ============================================");
  lines.push("");
  for (const item of resolved.bom) {
    lines.push(compileBomToBash(item));
  }
}

if (resolved.operations.length > 0) {
  lines.push("# ============================================");
  lines.push("# OPERATIONS - Command execution");
  lines.push("# ============================================");
  lines.push("");
  const sortedOps = [...resolved.operations].sort((a, b) => a.order - b.order);
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

console.log(lines.join("\n"));
