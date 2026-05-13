/**
 * Landing Worker — serves a lightweight landing page for root domains.
 *
 * Env vars (set via wrangler.toml [vars]):
 *   SITE_NAME     Default display name shown in the page title and heading.
 *   MAIL_APP_URL  Full URL of the temp-mail frontend (e.g. https://your-app.vercel.app).
 *   TAGLINE       Default one-line description shown under the heading (optional).
 *   HOST_PROFILES JSON mapping hostname → { siteName?, tagline? } for per-domain customization.
 *                 Example: {"example.com":{"siteName":"ExMail","tagline":"Fast disposable mail"}}
 *                 Unrecognized hosts fall back to SITE_NAME / TAGLINE.
 */

export interface Env {
  SITE_NAME: string;
  MAIL_APP_URL: string;
  TAGLINE?: string;
  HOST_PROFILES?: string;
}

interface HostProfile {
  siteName?: string;
  tagline?: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Redirect /mail or /inbox to the frontend app
    if (url.pathname.startsWith('/mail') || url.pathname.startsWith('/inbox')) {
      return Response.redirect(env.MAIL_APP_URL, 302);
    }

    let siteName = env.SITE_NAME || '云端接码';
    let tagline = env.TAGLINE || '免费、自托管的临时邮箱服务';
    const mailUrl = env.MAIL_APP_URL || '#';

    if (env.HOST_PROFILES) {
      try {
        const profiles: Record<string, HostProfile> = JSON.parse(env.HOST_PROFILES);
        const profile = profiles[url.hostname];
        if (profile) {
          if (profile.siteName) siteName = profile.siteName;
          if (profile.tagline) tagline = profile.tagline;
        }
      } catch {
        // malformed JSON — fall through to defaults
      }
    }

    const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${siteName}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #f5f5f5;
      color: #1a1a1a;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 2rem;
    }
    .card {
      background: #fff;
      border-radius: 1rem;
      box-shadow: 0 4px 24px rgba(0,0,0,.08);
      padding: 3rem 2.5rem;
      max-width: 480px;
      width: 100%;
      text-align: center;
    }
    .icon { font-size: 3rem; margin-bottom: 1rem; }
    h1 { font-size: 1.75rem; font-weight: 700; margin-bottom: .5rem; }
    .tagline { color: #555; margin-bottom: 2rem; line-height: 1.5; }
    .btn {
      display: inline-block;
      background: #2563eb;
      color: #fff;
      text-decoration: none;
      padding: .75rem 2rem;
      border-radius: .5rem;
      font-size: 1rem;
      font-weight: 600;
      transition: background .15s;
    }
    .btn:hover { background: #1d4ed8; }
    footer { margin-top: 2.5rem; font-size: .8rem; color: #aaa; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">📬</div>
    <h1>${siteName}</h1>
    <p class="tagline">${tagline}</p>
    <a class="btn" href="${mailUrl}">获取临时邮箱</a>
    <footer>自托管 · 开源 · 无需注册</footer>
  </div>
</body>
</html>`;

    return new Response(html, {
      headers: {
        'Content-Type': 'text/html; charset=UTF-8',
        'Cache-Control': 'public, max-age=3600',
      },
    });
  },
};
