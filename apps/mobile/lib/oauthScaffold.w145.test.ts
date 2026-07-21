/** W145: Moy nalog OAuth scaffold + Sentry init wiring */
import { readFileSync } from "fs";
import { join } from "path";

const mobile = join(__dirname);
const backend = join(__dirname, "../../../backend");
const must = (c: boolean, m: string) => { if (!c) throw new Error(m); };

const oauth = readFileSync(join(backend, "app/services/moy_nalog_oauth.py"), "utf8");
must(oauth.includes("build_authorize_url"), "oauth has authorize url builder");
must(oauth.includes("exchange_code_for_tokens"), "oauth has token exchange");

const fns = readFileSync(join(backend, "app/api/v1/fns.py"), "utf8");
must(fns.includes("/moy-nalog/oauth/start"), "fns oauth start");
must(fns.includes("demo_complete"), "fns demo_complete gate");
must(fns.includes("status=\"connected\""), "connected only after tokens");

const sentry = readFileSync(join(mobile, "sentryInit.ts"), "utf8");
must(sentry.includes("EXPO_PUBLIC_SENTRY_DSN"), "sentryInit gated by DSN");
must(sentry.includes("beforeSend") || sentry.includes("sanitizeSentryEvent"), "sentryInit sanitizes events");
must(sentry.includes("debug: false") || sentry.includes("debug:false"), "no verbose debug flag in prod path");

const layout = readFileSync(join(mobile, "../app/_layout.tsx"), "utf8");
must(layout.includes("initSentry()"), "layout calls initSentry");

const report = readFileSync(join(mobile, "reportError.ts"), "utf8");
must(report.includes("export function reportCatch"), "reportCatch helper");

console.log("oauthScaffold.w145.test OK");
