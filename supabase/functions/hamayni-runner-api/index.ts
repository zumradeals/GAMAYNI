import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    const url = new URL(req.url);
    const path = url.pathname.split("/").pop();

    if (req.method === "POST" && path === "heartbeat") {
      const body = await req.json();
      const { token, hostname, ip } = body;

      if (!token) {
        return new Response(JSON.stringify({ error: "Missing token" }), {
          status: 400,
          headers: { "Content-Type": "application/json", ...corsHeaders }
        });
      }

      const { data: server, error: findError } = await supabase
        .from("servers")
        .select("id, name")
        .eq("token", token)
        .maybeSingle();

      if (findError || !server) {
        return new Response(JSON.stringify({ error: "Invalid token" }), {
          status: 401,
          headers: { "Content-Type": "application/json", ...corsHeaders }
        });
      }

      const updateData: Record<string, unknown> = {
        status: "online",
        last_heartbeat: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      if (hostname) updateData.hostname = hostname;
      if (ip && ip !== "0.0.0.0") updateData.ip = ip;

      await supabase.from("servers").update(updateData).eq("id", server.id);
      await supabase.rpc("check_server_health");

      return new Response(JSON.stringify({ success: true, server_id: server.id }), {
        status: 200,
        headers: { "Content-Type": "application/json", ...corsHeaders }
      });
    }

    if (req.method === "POST" && path === "claim") {
      const body = await req.json();
      const { token } = body;

      if (!token) {
        return new Response(JSON.stringify({ error: "Missing token" }), {
          status: 400,
          headers: { "Content-Type": "application/json", ...corsHeaders }
        });
      }

      const { data: server, error: serverError } = await supabase
        .from("servers")
        .select("id, name")
        .eq("token", token)
        .maybeSingle();

      if (serverError || !server) {
        return new Response(JSON.stringify({ error: "Invalid token" }), {
          status: 401,
          headers: { "Content-Type": "application/json", ...corsHeaders }
        });
      }

      const { data: contract, error: contractError } = await supabase
        .from("contracts")
        .select("id, compiled_script")
        .eq("server_id", server.id)
        .eq("status", "PENDING")
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();

      if (!contract) {
        return new Response(null, {
          status: 204,
          headers: corsHeaders
        });
      }

      const claimTime = new Date().toISOString();

      await supabase
        .from("contracts")
        .update({ status: "CLAIMED", claimed_at: claimTime, updated_at: claimTime })
        .eq("id", contract.id);

      const { data: execution } = await supabase
        .from("contract_executions")
        .insert({
          contract_id: contract.id,
          server_id: server.id,
          server_name: server.name,
          status: "CLAIMED",
          started_at: claimTime,
        })
        .select("id")
        .maybeSingle();

      return new Response(JSON.stringify({
        contract_id: contract.id,
        script: contract.compiled_script,
        execution_id: execution?.id || null
      }), {
        status: 200,
        headers: { "Content-Type": "application/json", ...corsHeaders }
      });
    }

    if (req.method === "POST" && path === "report") {
      const body = await req.json();
      const { token, contract_id, status, logs, execution_id } = body;

      if (!token || !contract_id || !status) {
        return new Response(JSON.stringify({ error: "Missing required fields" }), {
          status: 400,
          headers: { "Content-Type": "application/json", ...corsHeaders }
        });
      }

      if (!["SUCCESS", "FAILED"].includes(status)) {
        return new Response(JSON.stringify({ error: "Status must be SUCCESS or FAILED" }), {
          status: 400,
          headers: { "Content-Type": "application/json", ...corsHeaders }
        });
      }

      const { data: server, error: serverError } = await supabase
        .from("servers")
        .select("id, name")
        .eq("token", token)
        .maybeSingle();

      if (serverError || !server) {
        return new Response(JSON.stringify({ error: "Invalid token" }), {
          status: 401,
          headers: { "Content-Type": "application/json", ...corsHeaders }
        });
      }

      const { data: contract } = await supabase
        .from("contracts")
        .select("id, server_id, claimed_at")
        .eq("id", contract_id)
        .maybeSingle();

      if (!contract || contract.server_id !== server.id) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 403,
          headers: { "Content-Type": "application/json", ...corsHeaders }
        });
      }

      const completedAt = new Date().toISOString();
      const durationMs = contract.claimed_at
        ? new Date(completedAt).getTime() - new Date(contract.claimed_at).getTime()
        : null;

      const executionLogs = {
        timestamp: completedAt,
        server_name: server.name,
        logs: logs || "",
      };

      await supabase
        .from("contracts")
        .update({ status, execution_logs: executionLogs, updated_at: completedAt })
        .eq("id", contract_id);

      if (execution_id) {
        await supabase
          .from("contract_executions")
          .update({ status, execution_logs: executionLogs, completed_at: completedAt, duration_ms: durationMs })
          .eq("id", execution_id);
      }

      return new Response(JSON.stringify({ success: true, contract_id, status, duration_ms: durationMs }), {
        status: 200,
        headers: { "Content-Type": "application/json", ...corsHeaders }
      });
    }

    if (req.method === "GET" && path === "status") {
      return new Response(JSON.stringify({ status: "ok", version: "3.1", name: "hamayni-runner-api" }), {
        status: 200,
        headers: { "Content-Type": "application/json", ...corsHeaders }
      });
    }

    return new Response(JSON.stringify({ error: "Not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json", ...corsHeaders }
    });

  } catch (error) {
    const errMsg = error instanceof Error ? error.message : "Unknown error";
    console.error("Runner API error:", errMsg);
    return new Response(JSON.stringify({ error: errMsg }), {
      status: 500,
      headers: { "Content-Type": "application/json", ...corsHeaders }
    });
  }
});
