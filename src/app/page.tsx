"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { generatePrefix, generateNamePrefix, generatePrefixOptions, randomDomain, extractLinks, extractCodes, formatTime } from "@/lib/utils";
import type { Email, ExtractedLink } from "@/lib/types";

const WORKER_URL = process.env.NEXT_PUBLIC_WORKER_URL || "http://localhost:8787";
const POLL_INTERVAL = 5000;
const SLEEP_AFTER_MS = 30_000; // 30 seconds
const STORAGE_KEY = "site_authed";

export default function Home() {
  const [domains, setDomains] = useState<string[]>([]);
  const [siteName, setSiteName] = useState("云端接码");
  const [linkFilter, setLinkFilter] = useState("");

  // Random domain pool – user can toggle which domains are included
  const [activeDomains, setActiveDomains] = useState<string[]>([]);
  const [showDomainPicker, setShowDomainPicker] = useState(false);

  const [domain, setDomain] = useState("");
  const [prefix, setPrefix] = useState("");
  const [prefixOptions, setPrefixOptions] = useState<{ label: string; value: string }[]>([]);
  const [showPrefixPicker, setShowPrefixPicker] = useState(false);
  const [emails, setEmails] = useState<Email[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [configLoaded, setConfigLoaded] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  // Sleep state
  const [sleeping, setSleeping] = useState(false);
  const sleepTimerRef = useRef<NodeJS.Timeout | null>(null);
  const pollTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Password
  const [hasPassword, setHasPassword] = useState(false);
  const [authed, setAuthed] = useState(false);
  const [pwInput, setPwInput] = useState("");
  const [pwError, setPwError] = useState("");
  const [pwLoading, setPwLoading] = useState(false);

  // ── Activity tracker: reset sleep timer on any user interaction ──
  const resetSleepTimer = useCallback(() => {
    if (sleepTimerRef.current) clearTimeout(sleepTimerRef.current);
    if (sleeping) return; // don't auto-reset if already sleeping
    sleepTimerRef.current = setTimeout(() => {
      setSleeping(true);
    }, SLEEP_AFTER_MS);
  }, [sleeping]);

  // Track mouse / key / touch activity
  useEffect(() => {
    if (!authed || !configLoaded) return;
    const events = ["mousemove", "mousedown", "keydown", "touchstart", "scroll"];
    const handler = () => resetSleepTimer();
    events.forEach((e) => window.addEventListener(e, handler, { passive: true }));
    resetSleepTimer(); // kick off initial timer
    return () => events.forEach((e) => window.removeEventListener(e, handler));
  }, [authed, configLoaded, resetSleepTimer]);

  // Pause polling when tab is hidden (Page Visibility API)
  const [tabVisible, setTabVisible] = useState(true);
  useEffect(() => {
    const handler = () => setTabVisible(!document.hidden);
    document.addEventListener("visibilitychange", handler);
    return () => document.removeEventListener("visibilitychange", handler);
  }, []);

  // Load config
  useEffect(() => {
    const loadConfig = async () => {
      try {
        const res = await fetch(`${WORKER_URL}/api/config`);
        if (res.ok) {
          const data = await res.json();
          const all = [...(data.domains || []), ...(data.forwardDomains || [])];
          setDomains(all);
          setActiveDomains(all); // default: all domains in pool
          setSiteName(data.siteName || "云端接码");
          setLinkFilter(data.linkFilter || "");
          setHasPassword(!!data.hasPassword);
          if (all.length > 0) setDomain(randomDomain(all));
          setAuthed(data.hasPassword ? sessionStorage.getItem(STORAGE_KEY) === "1" : true);
        }
      } catch {
        setAuthed(true);
      }
      setPrefix(generateNamePrefix());
      setPrefixOptions(generatePrefixOptions());
      setConfigLoaded(true);
    };
    loadConfig();
  }, []);

  const address = domain ? `${prefix}@${domain}` : "";

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2000);
  };

  const copyToClipboard = async (text: string, label = "已复制") => {
    try {
      await navigator.clipboard.writeText(text);
      showToast(`✅ ${label}`);
    } catch {
      showToast("❌ 复制失败");
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwLoading(true);
    setPwError("");
    try {
      const res = await fetch(`${WORKER_URL}/api/site-login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: pwInput }),
      });
      if (res.ok) { sessionStorage.setItem(STORAGE_KEY, "1"); setAuthed(true); }
      else setPwError("密码错误，请重试");
    } catch { setPwError("连接失败，请稍后重试"); }
    finally { setPwLoading(false); }
  };

  const wakeUp = () => {
    setSleeping(false);
    resetSleepTimer();
  };

  const fetchEmails = useCallback(async () => {
    if (!prefix || !domain) return;
    setLoading(true);
    try {
      const res = await fetch(`${WORKER_URL}/api/emails?address=${encodeURIComponent(address)}`);
      if (res.ok) {
        const incoming: Email[] = (await res.json()).emails || [];
        setEmails((prev) => {
          // Auto-expand the latest email when a new one arrives
          if (incoming.length > 0 && (prev.length === 0 || incoming[0].id !== prev[0]?.id)) {
            setExpandedId(incoming[0].id);
          }
          return incoming;
        });
      }
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, [address, prefix, domain]);

  // Polling: stop when sleeping or tab is hidden
  useEffect(() => {
    if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    if (!sleeping && tabVisible && prefix && domain && authed) {
      fetchEmails();
      pollTimerRef.current = setInterval(fetchEmails, POLL_INTERVAL);
    }
    return () => { if (pollTimerRef.current) clearInterval(pollTimerRef.current); };
  }, [sleeping, tabVisible, fetchEmails, prefix, domain, authed]);

  const refreshAddress = () => {
    const pool = activeDomains.length > 0 ? activeDomains : domains;
    setPrefix(generateNamePrefix());
    setPrefixOptions(generatePrefixOptions());
    if (pool.length > 0) setDomain(randomDomain(pool));
    setEmails([]);
    setExpandedId(null);
    setShowPrefixPicker(false);
    resetSleepTimer();
  };

  const toggleActiveDomain = (d: string) => {
    setActiveDomains((prev) => {
      if (prev.includes(d)) {
        if (prev.length === 1) return prev; // keep at least one
        return prev.filter((x) => x !== d);
      }
      return [...prev, d];
    });
  };

  const getLinksForEmail = (email: Email): ExtractedLink[] => {
    const all = extractLinks(email.html || "");
    return linkFilter ? all.filter((l) => l.url.includes(linkFilter)) : all;
  };

  const getCodesForEmail = (email: Email): string[] =>
    extractCodes(email.text || email.html?.replace(/<[^>]*>/g, "") || "");

  // ── Loading ──
  if (!configLoaded) return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: "var(--bg)" }}>
      <div className="text-center text-gray-400">
        <div className="text-4xl mb-4 animate-spin">⏳</div><p>加载中...</p>
      </div>
    </div>
  );

  // ── Password gate ──
  if (hasPassword && !authed) return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: "var(--bg)" }}>
      <div className="card w-full max-w-sm mx-4">
        <h1 className="text-xl font-bold mb-2 text-center" style={{ color: "var(--primary)" }}>☁️ {siteName}</h1>
        <p className="text-sm text-gray-500 text-center mb-6">请输入访问密码</p>
        <form onSubmit={handleLogin}>
          <input type="password" value={pwInput} onChange={(e) => setPwInput(e.target.value)}
            placeholder="访问密码" className="email-input mb-3" autoFocus />
          {pwError && <p className="text-red-500 text-sm mb-3 text-center">{pwError}</p>}
          <button type="submit" className="btn-primary" disabled={pwLoading}>
            {pwLoading ? "验证中..." : "进入"}
          </button>
        </form>
      </div>
    </div>
  );

  // ── No domains ──
  if (domains.length === 0) return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: "var(--bg)" }}>
      <div className="card text-center max-w-md">
        <div className="text-4xl mb-4">⚠️</div>
        <h2 className="text-lg font-bold text-gray-700 mb-2">尚未配置域名</h2>
        <p className="text-sm text-gray-500 mb-4">请先到管理后台添加至少一个域名</p>
        <a href="/admin" className="btn-primary inline-block text-center">进入管理后台</a>
      </div>
    </div>
  );

  // ── Sleep screen ──
  if (sleeping) return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: "var(--bg)" }}>
      <div className="text-center">
        <div className="text-6xl mb-6">😴</div>
        <h2 className="text-xl font-semibold text-gray-500 mb-2">已进入休眠</h2>
        <p className="text-sm text-gray-400 mb-8">超过 1 分钟无操作，轮询已暂停</p>
        <button
          onClick={wakeUp}
          className="btn-primary"
          style={{ width: "200px" }}
        >
          ⚡ 一键唤醒
        </button>
        <p className="text-xs text-gray-400 mt-4">当前邮箱：{address}</p>
      </div>
    </div>
  );

  // ── Main UI ──
  return (
    <div className="min-h-screen" style={{ background: "var(--bg)" }}>
      {toast && <div className="toast">{toast}</div>}

      <div className="max-w-2xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-2xl font-bold" style={{ color: "var(--primary)" }}>☁️ {siteName}</h1>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <span className="inline-block w-2 h-2 rounded-full bg-green-500 pulse" />
              实时监听中
            </div>
            <a href="/admin" className="text-gray-400 hover:text-gray-600 text-lg" title="管理后台">⚙️</a>
          </div>
        </div>

        {/* Domain pool selector */}
        <div className="flex items-center gap-3 mb-4 flex-wrap">
          <div className="relative">
            <button
              onClick={() => setShowDomainPicker((v) => !v)}
              className="card px-4 py-2 text-sm font-medium cursor-pointer flex items-center gap-2"
              style={{ borderColor: "var(--primary)", color: "var(--primary)" }}
            >
              <span>🎲 随机域名池</span>
              <span className="badge" style={{ fontSize: "11px" }}>
                {activeDomains.length}/{domains.length}
              </span>
              <span>{showDomainPicker ? "▲" : "▼"}</span>
            </button>

            {showDomainPicker && (
              <div className="absolute top-full left-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-lg z-10 min-w-48 p-2">
                <p className="text-xs text-gray-400 px-2 pb-2">勾选参与随机的域名</p>
                {domains.map((d) => (
                  <label key={d} className="flex items-center gap-2 px-2 py-2 hover:bg-gray-50 rounded-lg cursor-pointer">
                    <input
                      type="checkbox"
                      checked={activeDomains.includes(d)}
                      onChange={() => toggleActiveDomain(d)}
                      className="accent-green-600"
                    />
                    <span className="font-mono text-sm">{d}</span>
                  </label>
                ))}
              </div>
            )}
          </div>

          <button
            onClick={() => copyToClipboard(address, "邮箱已复制")}
            className="card px-4 py-2 text-sm font-medium cursor-pointer hover:opacity-80"
            style={{ background: "var(--primary-light)", borderColor: "#c8e6c9", color: "var(--primary-dark)" }}
          >
            📋 全量粘贴
          </button>
        </div>

        {/* Email Address */}
        <div className="mb-4">
          <div className="flex items-center gap-2 mb-2">
            {/* Prefix input */}
            <div className="relative flex-1">
              <input
                type="text"
                className="email-input"
                value={prefix}
                onChange={(e) => { setPrefix(e.target.value); setEmails([]); }}
                onFocus={() => setShowPrefixPicker(true)}
                onBlur={() => setTimeout(() => setShowPrefixPicker(false), 150)}
                placeholder="输入或选择前缀"
                style={{ textAlign: "left", paddingRight: "40px" }}
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm pointer-events-none">
                @{domain}
              </span>

              {/* Quick-pick dropdown */}
              {showPrefixPicker && prefixOptions.length > 0 && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-lg z-20 overflow-hidden">
                  <div className="px-3 py-2 text-xs text-gray-400 border-b border-gray-100">快速选择</div>
                  {prefixOptions.map((opt) => (
                    <button
                      key={opt.value}
                      className="w-full text-left px-3 py-2 hover:bg-green-50 text-sm font-mono flex items-center justify-between"
                      onMouseDown={() => {
                        setPrefix(opt.value);
                        setEmails([]);
                        setShowPrefixPicker(false);
                      }}
                    >
                      <span>{opt.value}</span>
                      <span className="text-xs text-gray-400">@{domain}</span>
                    </button>
                  ))}
                  <div className="border-t border-gray-100">
                    <button
                      className="w-full text-left px-3 py-2 hover:bg-gray-50 text-sm text-gray-500"
                      onMouseDown={() => {
                        setPrefixOptions(generatePrefixOptions());
                      }}
                    >
                      🔄 换一批
                    </button>
                  </div>
                </div>
              )}
            </div>

            <button className="icon-btn" onClick={() => copyToClipboard(address, "邮箱已复制")} title="复制">📋</button>
            <button className="icon-btn" onClick={refreshAddress} title="换一个">🔄</button>
          </div>

          {/* Full address display + copy */}
          <div
            className="text-center text-sm text-gray-500 cursor-pointer hover:text-green-700 py-1"
            onClick={() => copyToClipboard(address, "邮箱已复制")}
            title="点击复制完整地址"
          >
            {address} <span className="text-xs text-gray-400">点击复制</span>
          </div>
        </div>

        {/* Fetch Button */}
        <button className="btn-primary mb-4 flex items-center justify-center gap-2" onClick={() => { fetchEmails(); resetSleepTimer(); }} disabled={loading}>
          {loading ? <><span className="inline-block animate-spin">⏳</span> 正在查询...</> : <>🚀 极速拉取验证码</>}
        </button>

        {/* Link filter hint + sleep countdown hint */}
        <div className="flex items-center justify-between mb-6">
          {linkFilter ? (
            <div className="text-xs text-gray-400">
              🔍 只显示包含 <code className="bg-gray-100 px-1 rounded">{linkFilter}</code> 的链接
            </div>
          ) : <div />}
          <div className="text-xs text-gray-400">💤 30 秒无操作自动休眠</div>
        </div>

        {/* Email List */}
        <div>
          {emails.length === 0 ? (
            <div className="text-center py-16 text-gray-400">
              <div className="text-4xl mb-4">📭</div>
              <p>暂无邮件</p>
              <p className="text-sm mt-2">将 <strong>{address}</strong> 用于注册，邮件会自动出现在这里</p>
            </div>
          ) : (
            emails.map((email) => {
              const links = getLinksForEmail(email);
              const codes = getCodesForEmail(email);
              const isExpanded = expandedId === email.id;

              return (
                <div key={email.id} className="email-card">
                  {/* Header row - click to toggle raw email */}
                  <div className="flex items-start justify-between gap-2 mb-3">
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-gray-800 truncate">{email.subject || "(无主题)"}</div>
                      <div className="text-xs text-gray-400 mt-0.5">{email.from} · {formatTime(email.timestamp)}</div>
                    </div>
                    <button
                      onClick={() => setExpandedId(isExpanded ? null : email.id)}
                      className="text-xs text-gray-400 hover:text-gray-600 shrink-0 mt-1"
                    >
                      {isExpanded ? "▲ 收起" : "▼ 原文"}
                    </button>
                  </div>

                  {/* Verification codes - shown directly */}
                  {codes.length > 0 && (
                    <div className="mb-3">
                      {codes.map((code, i) => (
                        <div key={i} className="link-item">
                          <span className="font-mono text-xl font-bold text-green-800 tracking-widest">{code}</span>
                          <button className="copy-link-btn" onClick={() => copyToClipboard(code, "验证码已复制")}>
                            复制验证码
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Links - shown directly, prominently */}
                  {links.length > 0 && (
                    <div>
                      {links.map((link, i) => (
                        <div key={i} style={{
                          background: "linear-gradient(135deg, #e8f5e9, #f1f8e9)",
                          border: "1px solid #a5d6a7",
                          borderRadius: "10px",
                          padding: "12px 16px",
                          marginBottom: "8px",
                        }}>
                          {link.text && link.text !== link.url && (
                            <div className="text-sm font-semibold text-green-900 mb-1">{link.text}</div>
                          )}
                          <div className="text-xs text-green-700 break-all mb-2 opacity-70">{link.url}</div>
                          <button
                            className="copy-link-btn w-full"
                            style={{ padding: "8px", borderRadius: "8px", fontSize: "14px" }}
                            onClick={() => copyToClipboard(link.url, "链接已复制")}
                          >
                            📋 一键复制链接
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* No matching links hint */}
                  {links.length === 0 && codes.length === 0 && linkFilter && (
                    <div className="text-sm text-gray-400 py-2">
                      此邮件中没有包含 <code className="bg-gray-100 px-1 rounded">{linkFilter}</code> 的链接
                    </div>
                  )}

                  {/* Raw email (collapsed by default) */}
                  {isExpanded && (
                    <div className="mt-3 pt-3 border-t border-gray-100">
                      <div
                        className="p-3 bg-gray-50 rounded-lg text-sm text-gray-700 max-h-60 overflow-auto"
                        dangerouslySetInnerHTML={{ __html: email.html || email.text || "" }}
                      />
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        <div className="text-center text-xs text-gray-400 mt-12 pb-8">
          临时邮箱 · 邮件到期自动删除 · 请勿用于重要账户
        </div>
      </div>
    </div>
  );
}
