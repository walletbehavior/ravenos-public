import worker from "../worker.mjs";

async function sha256(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function originDiagnostic(env) {
  const base = String(env.RAVENOS_PUBLIC_ORIGIN_URL || "").replace(/\/+$/, "");
  const token = String(env.RAVENOS_PUBLIC_ORIGIN_TOKEN || "");
  if (!base || !token) {
    return Response.json({ ok: false, status: null, failure_class: "binding_unavailable" }, {
      status: 503,
      headers: { "cache-control": "no-store" },
    });
  }
  try {
    const response = await fetch(`${base}/opportunities.json`, {
      method: "GET",
      headers: { accept: "application/json", "x-ravenos-public-token": token },
      redirect: "manual",
    });
    const text = await response.text();
    const contentType = String(response.headers.get("content-type") || "").toLowerCase();
    let publicContract = null;
    if (contentType.includes("application/json")) {
      try {
        const payload = JSON.parse(text);
        publicContract = {
          schema_version: payload?.schema_version || null,
          key: payload?.key || null,
          generated_at: payload?.generated_at || null,
          safe_public: payload?.safe_public === true,
        };
      } catch {
        publicContract = { invalid_json: true };
      }
    }
    const cloudflareError = text.match(/error\s*code\s*(\d{4})/i)?.[1] || null;
    return Response.json({
      ok: response.ok,
      status: response.status,
      content_type: contentType || null,
      content_length: Number(response.headers.get("content-length") || 0) || null,
      body_bytes: new TextEncoder().encode(text).byteLength,
      body_sha256: await sha256(text),
      cf_ray: response.headers.get("cf-ray") || null,
      cloudflare_error_code: cloudflareError,
      public_contract: publicContract,
    }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const safeMessage = String(error instanceof Error ? error.message : "origin_fetch_failed")
      .split(token).join("[REDACTED]")
      .split(base).join("[PROTECTED_ORIGIN]")
      .slice(0, 240);
    return Response.json({
      ok: false,
      status: null,
      failure_class: error instanceof Error ? error.name : "origin_fetch_failed",
      failure_message: safeMessage,
    }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}

export default {
  async fetch(request, env, context) {
    const prefix = String(env.RAVENOS_PREFLIGHT_ROUTE_PREFIX || "");
    const url = new URL(request.url);
    if (!prefix || (url.pathname !== prefix && !url.pathname.startsWith(`${prefix}/`))) {
      return new Response("Not found", { status: 404 });
    }
    url.pathname = url.pathname.slice(prefix.length) || "/";
    if (url.pathname === "/__origin_diagnostic") return originDiagnostic(env);
    return worker.fetch(new Request(url, request), env, context);
  },
};
