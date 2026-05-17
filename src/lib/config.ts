// Worker URL is the only static config needed.
// All other config (domains, site name, etc.) is loaded dynamically from Worker.
//
// NEXT_PUBLIC_WORKER_URL is a build-time variable in Next.js — changing it on
// Vercel requires a redeploy. In development we fall back to a local Worker;
// in production a missing value is left empty so requests fail fast and
// visibly instead of silently calling localhost.
function resolveWorkerUrl(): string {
  const configured = process.env.NEXT_PUBLIC_WORKER_URL;
  if (configured) return configured;
  if (process.env.NODE_ENV === "development") return "http://localhost:8787";
  console.error(
    "[config] NEXT_PUBLIC_WORKER_URL is not set — API requests will fail. " +
    "Set it in the Vercel project environment and redeploy."
  );
  return "";
}

export const WORKER_URL = resolveWorkerUrl();
