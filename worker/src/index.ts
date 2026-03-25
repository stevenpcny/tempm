export interface Env {
  DB: D1Database;
  ALLOWED_ORIGINS: string;
  ADMIN_PASSWORD: string;
}

interface ForwardRule {
  subdomain: string;
  target: string;
}

// ========== Helpers ==========

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 10);
}

function corsHeaders(request: Request, env: Env): Record<string, string> {
  const origin = request.headers.get("Origin") || "";
  const allowed = (env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim());
  const isAllowed = allowed.includes(origin);
  return {
    "Access-Control-Allow-Origin": isAllowed ? origin : (allowed[0] || "*"),
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
  };
}

async function streamToText(stream: ReadableStream | null): Promise<string> {
  if (!stream) return "";
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let result = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    result += decoder.decode(value, { stream: true });
  }
  return result;
}

// ========== D1 Config Helpers ==========

async function getConfig(db: D1Database, key: string): Promise<string> {
  try {
    const row = await db.prepare("SELECT value FROM config WHERE key = ?").bind(key).first() as { value: string } | null;
    return row?.value || "";
  } catch {
    return "";
  }
}

async function setConfig(db: D1Database, key: string, value: string): Promise<void> {
  await db.prepare("INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)").bind(key, value).run();
}

async function getDomains(db: D1Database): Promise<string[]> {
  const raw = await getConfig(db, "domains");
  try { return JSON.parse(raw); } catch { return []; }
}

async function getForwardRules(db: D1Database): Promise<ForwardRule[]> {
  const raw = await getConfig(db, "forward_rules");
  try { return JSON.parse(raw); } catch { return []; }
}

function checkAuth(request: Request, env: Env): boolean {
  const auth = request.headers.get("Authorization") || "";
  return auth === `Bearer ${env.ADMIN_PASSWORD}`;
}

// ========== Email parsing ==========

function decodeQP(str: string): string {
  return str
    .replace(/=\r?\n/g, "")
    .replace(/=([0-9A-Fa-f]{2})/g, (_, hex) =>
      String.fromCharCode(parseInt(hex, 16))
    );
}

function parseEmailContent(rawEmail: string) {
  let textBody = "";
  let htmlBody = "";
  let subject = "";

  const subjectMatch = rawEmail.match(/^Subject:\s*(.+)$/im);
  if (subjectMatch) {
    subject = subjectMatch[1].trim();
    subject = subject.replace(
      /=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g,
      (_, _charset, encoding, encoded) => {
        try {
          if (encoding.toUpperCase() === "B") return atob(encoded);
          return encoded
            .replace(/_/g, " ")
            .replace(/=([0-9A-Fa-f]{2})/g, (_2: string, hex: string) =>
              String.fromCharCode(parseInt(hex, 16))
            );
        } catch { return encoded; }
      }
    );
  }

  const boundaryMatch = rawEmail.match(
    /Content-Type:\s*multipart\/\w+;\s*boundary="?([^"\s;]+)"?/i
  );

  if (boundaryMatch) {
    const boundary = boundaryMatch[1];
    const parts = rawEmail.split(`--${boundary}`);
    for (const part of parts) {
      const rnrn = part.indexOf("\r\n\r\n");
      const nn = part.indexOf("\n\n");
      const bodyStart = rnrn >= 0 ? rnrn + 4 : (nn >= 0 ? nn + 2 : -1);
      if (bodyStart === -1) continue;
      const body = part.substring(bodyStart).trim();
      const isB64 = part.includes("Content-Transfer-Encoding: base64");
      const isQP = part.includes("Content-Transfer-Encoding: quoted-printable");

      if (part.includes("Content-Type: text/plain")) {
        textBody = isB64 ? (() => { try { return atob(body.replace(/\s/g, "")); } catch { return body; } })()
          : isQP ? decodeQP(body) : body;
      }
      if (part.includes("Content-Type: text/html")) {
        htmlBody = isB64 ? (() => { try { return atob(body.replace(/\s/g, "")); } catch { return body; } })()
          : isQP ? decodeQP(body) : body;
      }
    }
  } else {
    const rnrn = rawEmail.indexOf("\r\n\r\n");
    const nn = rawEmail.indexOf("\n\n");
    const bodyStart = rnrn >= 0 ? rnrn + 4 : (nn >= 0 ? nn + 2 : -1);
    if (bodyStart > -1) {
      const body = rawEmail.substring(bodyStart);
      const isB64 = rawEmail.includes("Content-Transfer-Encoding: base64");
      const isQP = rawEmail.includes("Content-Transfer-Encoding: quoted-printable");
      if (rawEmail.includes("Content-Type: text/html")) {
        htmlBody = isB64 ? (() => { try { return atob(body.replace(/\s/g, "")); } catch { return body; } })()
          : isQP ? decodeQP(body) : body;
      } else {
        textBody = isB64 ? (() => { try { return atob(body.replace(/\s/g, "")); } catch { return body; } })()
          : isQP ? decodeQP(body) : body;
      }
    }
  }

  return { subject, textBody, htmlBody };
}

// ========== HTTP Request Handler ==========

async function handleFetch(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const headers = corsHeaders(request, env);

  if (request.method === "OPTIONS") {
    return new Response(null, { headers });
  }

  // GET /api/config
  if (url.pathname === "/api/config" && request.method === "GET") {
    const domains = await getDomains(env.DB);
    const forwardRules = await getForwardRules(env.DB);
    const siteName = await getConfig(env.DB, "site_name");
    const autoDeleteHours = await getConfig(env.DB, "auto_delete_hours");
    const linkFilter = await getConfig(env.DB, "link_filter");
    const sitePasswordHash = await getConfig(env.DB, "site_password_hash");
    return Response.json({
      domains,
      forwardDomains: forwardRules.map((r) => r.subdomain),
      siteName: siteName || "云端接码",
      autoDeleteHours: parseInt(autoDeleteHours) || 24,
      linkFilter: linkFilter || "",
      hasPassword: sitePasswordHash !== "",
    }, { headers });
  }

  // POST /api/site-login
  if (url.pathname === "/api/site-login" && request.method === "POST") {
    const raw = await request.text();
    const body = JSON.parse(raw) as { password: string };
    const storedHash = await getConfig(env.DB, "site_password_hash");
    if (!storedHash) {
      return Response.json({ ok: true }, { headers });
    }
    const encoder = new TextEncoder();
    const data = encoder.encode(body.password);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
    if (hashHex === storedHash) {
      return Response.json({ ok: true }, { headers });
    }
    return Response.json({ error: "密码错误" }, { status: 401, headers });
  }

  // GET /api/emails?address=xxx@domain.com
  if (url.pathname === "/api/emails" && request.method === "GET") {
    const address = (url.searchParams.get("address") || "").toLowerCase();
    if (!address) {
      return Response.json({ error: "address required" }, { status: 400, headers });
    }
    const domain = address.split("@")[1];
    const domains = await getDomains(env.DB);
    const forwardRules = await getForwardRules(env.DB);
    const allDomains = [
      ...domains.map((d) => d.toLowerCase()),
      ...forwardRules.map((r) => r.subdomain.toLowerCase()),
    ];
    if (!allDomains.includes(domain)) {
      return Response.json({ error: "invalid domain" }, { status: 400, headers });
    }
    const result = await env.DB.prepare(
      "SELECT id, mail_to as 'to', mail_from as 'from', subject, text_body as text, html_body as html, timestamp FROM emails WHERE mail_to = ? ORDER BY timestamp DESC LIMIT 50"
    ).bind(address).all();
    return Response.json({ emails: result.results || [] }, { headers });
  }

  // POST /api/admin/login
  if (url.pathname === "/api/admin/login" && request.method === "POST") {
    const raw = await request.text();
    const body = JSON.parse(raw) as { password: string };
    if (body.password === env.ADMIN_PASSWORD) {
      return Response.json({ ok: true, token: env.ADMIN_PASSWORD }, { headers });
    }
    return Response.json({ error: "密码错误" }, { status: 401, headers });
  }

  // Admin endpoints (auth required)
  if (url.pathname.startsWith("/api/admin/")) {
    if (!checkAuth(request, env)) {
      return Response.json({ error: "unauthorized" }, { status: 401, headers });
    }

    // GET /api/admin/config
    if (url.pathname === "/api/admin/config" && request.method === "GET") {
      const domains = await getDomains(env.DB);
      const forwardRules = await getForwardRules(env.DB);
      const siteName = await getConfig(env.DB, "site_name");
      const autoDeleteHours = await getConfig(env.DB, "auto_delete_hours");
      const linkFilter = await getConfig(env.DB, "link_filter");
      const hasSitePassword = (await getConfig(env.DB, "site_password_hash")) !== "";
      return Response.json({
        domains, forwardRules,
        siteName: siteName || "云端接码",
        autoDeleteHours: parseInt(autoDeleteHours) || 24,
        linkFilter: linkFilter || "",
        hasSitePassword,
      }, { headers });
    }

    // POST /api/admin/config
    if (url.pathname === "/api/admin/config" && request.method === "POST") {
      const raw = await request.text();
      const body = JSON.parse(raw) as {
        domains?: string[];
        forwardRules?: ForwardRule[];
        siteName?: string;
        autoDeleteHours?: number;
        linkFilter?: string;
        sitePassword?: string;   // plain text, will be hashed
        clearSitePassword?: boolean;
      };
      if (body.domains !== undefined) await setConfig(env.DB, "domains", JSON.stringify(body.domains));
      if (body.forwardRules !== undefined) await setConfig(env.DB, "forward_rules", JSON.stringify(body.forwardRules));
      if (body.siteName !== undefined) await setConfig(env.DB, "site_name", body.siteName);
      if (body.autoDeleteHours !== undefined) await setConfig(env.DB, "auto_delete_hours", String(body.autoDeleteHours));
      if (body.linkFilter !== undefined) await setConfig(env.DB, "link_filter", body.linkFilter);
      if (body.clearSitePassword) await setConfig(env.DB, "site_password_hash", "");
      if (body.sitePassword) {
        const encoder = new TextEncoder();
        const data = encoder.encode(body.sitePassword);
        const hashBuffer = await crypto.subtle.digest("SHA-256", data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        const hashHex = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
        await setConfig(env.DB, "site_password_hash", hashHex);
      }
      return Response.json({ ok: true }, { headers });
    }

    // GET /api/admin/stats
    if (url.pathname === "/api/admin/stats" && request.method === "GET") {
      const total = await env.DB.prepare("SELECT COUNT(*) as count FROM emails").first() as { count: number } | null;
      const today = await env.DB.prepare(
        "SELECT COUNT(*) as count FROM emails WHERE timestamp > ?"
      ).bind(Date.now() - 86400000).first() as { count: number } | null;
      return Response.json({
        totalEmails: total?.count || 0,
        todayEmails: today?.count || 0,
      }, { headers });
    }

    // DELETE /api/admin/emails
    if (url.pathname === "/api/admin/emails" && request.method === "DELETE") {
      await env.DB.prepare("DELETE FROM emails").run();
      return Response.json({ ok: true }, { headers });
    }
  }

  // Cleanup
  if (url.pathname === "/api/cleanup") {
    const hoursStr = await getConfig(env.DB, "auto_delete_hours");
    const hours = parseInt(hoursStr) || 24;
    await env.DB.prepare("DELETE FROM emails WHERE timestamp < ?")
      .bind(Date.now() - hours * 3600000).run();
    return Response.json({ ok: true }, { headers });
  }

  return Response.json({ error: "not found" }, { status: 404, headers });
}

// ========== Main Export ==========

export default {
  async email(message: ForwardableEmailMessage, env: Env): Promise<void> {
    const to = message.to.toLowerCase();
    const domain = to.split("@")[1];
    const domains = await getDomains(env.DB);
    const forwardRules = await getForwardRules(env.DB);

    const rule = forwardRules.find((r) => r.subdomain.toLowerCase() === domain);
    if (rule) await message.forward(rule.target);

    const allDomains = [
      ...domains.map((d) => d.toLowerCase()),
      ...forwardRules.map((r) => r.subdomain.toLowerCase()),
    ];
    if (!allDomains.includes(domain)) {
      message.setReject("Unknown domain");
      return;
    }

    const rawEmail = await streamToText(message.raw);
    const { subject, textBody, htmlBody } = parseEmailContent(rawEmail);

    await env.DB.prepare(
      "INSERT INTO emails (id, mail_to, mail_from, subject, text_body, html_body, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).bind(generateId(), to, message.from, subject, textBody, htmlBody, Date.now()).run();
  },

  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      return await handleFetch(request, env);
    } catch (err) {
      const headers = corsHeaders(request, env);
      return Response.json(
        { error: "internal error", detail: String(err) },
        { status: 500, headers }
      );
    }
  },

  async scheduled(_event: ScheduledEvent, env: Env): Promise<void> {
    const hoursStr = await getConfig(env.DB, "auto_delete_hours");
    const hours = parseInt(hoursStr) || 24;
    await env.DB.prepare("DELETE FROM emails WHERE timestamp < ?")
      .bind(Date.now() - hours * 3600000).run();
  },
};
