/**
 * Capital.com base-URL normalisation.
 *
 * The bot failed to connect to the demo account because the stored/env base URL
 * pointed at a host that does not serve the REST API (e.g. the legacy
 * `demo-api-capital.backend.gb.capital.com`, a bare host with no scheme, or a
 * URL that already included `/api/v1`). The session POST then failed and the
 * bot could never log in.
 *
 * The only correct hosts are:
 *   demo → https://demo-api-capital.backend-capital.com
 *   live → https://api-capital.backend-capital.com
 */
export const CAPITAL_DEMO_URL = "https://demo-api-capital.backend-capital.com";
export const CAPITAL_LIVE_URL = "https://api-capital.backend-capital.com";

/**
 * Clean up any Capital.com base URL:
 *  - adds the missing https:// scheme
 *  - strips trailing slashes and any accidental /api/v1 suffix
 *  - rewrites known-bad / legacy hosts to the official ones
 *  - falls back to the demo/live URL implied by `isDemo` when the value is
 *    empty or unusable
 */
export function normalizeCapitalUrl(raw: string | null | undefined, isDemo = true): string {
  const fallback = isDemo ? CAPITAL_DEMO_URL : CAPITAL_LIVE_URL;

  let url = (raw ?? "").trim();
  if (!url) return fallback;

  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  // remove trailing slash(es) and a duplicated API path
  url = url.replace(/\/+$/, "").replace(/\/api\/v\d+$/i, "");

  let host: string;
  try {
    host = new URL(url).host.toLowerCase();
  } catch {
    return fallback;
  }

  // Legacy / incorrect hosts that never serve the REST API
  const legacyDemo = [
    "demo-api-capital.backend.gb.capital.com",
    "demo-api-capital.backend.capital.com",
    "demo-api.capital.com",
  ];
  const legacyLive = [
    "api-capital.backend.gb.capital.com",
    "api-capital.backend.capital.com",
    "api.capital.com",
  ];

  if (legacyDemo.includes(host)) return CAPITAL_DEMO_URL;
  if (legacyLive.includes(host)) return CAPITAL_LIVE_URL;

  // Anything that isn't one of the two official hosts is not usable
  if (host === "demo-api-capital.backend-capital.com") return CAPITAL_DEMO_URL;
  if (host === "api-capital.backend-capital.com") return CAPITAL_LIVE_URL;

  return fallback;
}

/** True when the (normalised) URL is the demo endpoint. */
export function isDemoUrl(url: string): boolean {
  return normalizeCapitalUrl(url).startsWith(CAPITAL_DEMO_URL);
}
