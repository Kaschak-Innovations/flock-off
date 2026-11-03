/**
 * Secrets live outside wrangler.jsonc, so `wrangler types` cannot see them.
 * Declared here instead; this merges into the generated global `Env` interface.
 */
interface Env {
  /**
   * Shared signing key, set with `wrangler secret put REPORT_KEY` (or in .dev.vars locally).
   * When present every POST must carry a valid X-Flock-Ts / X-Flock-Sig pair.
   * When absent the worker accepts unsigned requests and /health reports `signing: false`.
   */
  REPORT_KEY?: string;
}
