// Slack / Microsoft Teams incoming-webhook delivery for schema-drift
// notifications. `notifyDrift` is the one entry point: it picks a payload
// format by provider and posts it, never throwing — sync itself must never
// fail or block because a chat notification didn't go out (see
// NotifyResult below, which the caller surfaces as a small UI warning).
//
// ── CORS reality check (researched, not assumed) ──────────────────────────
// Both Slack and Microsoft Teams incoming webhooks are plain HTTPS POST
// endpoints with NO `Access-Control-Allow-Origin` response header, so a
// same-origin browser `fetch` in "cors" mode is rejected by the browser
// before the response body (or even status code) is visible to JS:
//   - Teams: confirmed broken from a browser. Multiple reports (Microsoft
//     Q&A, Microsoft Tech Community, MicrosoftDocs/msteams-docs#1305 and
//     #1276) show `fetch`/axios/XHR POSTs to a Teams webhook URL failing
//     with a CORS network error; curl/Postman/server-side works fine. There
//     is no documented content-type trick that avoids this — Teams expects
//     `application/json`, which is itself a "to-be-preflighted" content type,
//     and even simple-request-shaped calls have been reported to fail.
//   - Slack: incoming webhooks also send no CORS headers, so a normal
//     `fetch(..., { mode: "cors" })` with a JSON body fails the same way.
//     However, Slack's webhook endpoint accepts the payload as a single
//     `application/x-www-form-urlencoded` field... in practice the more
//     robust option (and the one used here) is a `no-cors` POST: the
//     browser is allowed to *send* a simple (non-preflighted) cross-origin
//     request in no-cors mode, Slack receives and processes it, but the
//     response is "opaque" — JS cannot read the status code or body, so
//     success can only be assumed, never confirmed.
//
// Net effect: direct browser delivery to Slack is possible but unverifiable
// (fire-and-forget, opaque response), and direct browser delivery to Teams
// is NOT reliable at all (no known no-cors-compatible content type Teams
// accepts). Both cases are handled here without lying to the caller:
//   - Slack: POST with mode: "no-cors"; treated as "sent" (we cannot know
//     otherwise) — see the `delivered: "unverifiable"` status.
//   - Teams: attempted with a normal fetch (so a same-origin proxy or a
//     browser extension relaxing CORS would still work), but any network/
//     CORS failure is caught and surfaced as a clear warning rather than
//     silently swallowed.
// A real deployment that needs *confirmed* delivery (especially for Teams)
// would need a small server-side/edge relay (e.g. a Supabase Edge Function)
// that forwards the POST — see the report for details. This module's
// function signature (webhook, summary) is designed so swapping the fetch
// call for a call to such a relay is a one-line change, not a redesign.

import type { DriftSummary } from "./driftSummary";
import { formatDriftItemLine } from "./driftSummary";

export type NotificationProvider = "slack" | "teams";

export interface WebhookConfig {
  provider: NotificationProvider;
  url: string;
  enabled: boolean;
}

export interface NotifyResult {
  ok: boolean;
  // "confirmed"  — got a readable 2xx response (not currently reachable for
  //                either provider from a plain browser POST, kept for a
  //                future server-side relay).
  // "unverifiable" — request was sent (no-cors) but the response is opaque;
  //                treated as best-effort success.
  // "failed"    — network error or (when readable) a non-2xx response.
  delivered: "confirmed" | "unverifiable" | "failed";
  message: string;
}

// ── Slack ───────────────────────────────────────────────────────────────
// Slack's Block Kit format: a header block with the headline, plus a
// section with the itemized list (Slack renders markdown-ish mrkdwn text).
export function formatSlackPayload(summary: DriftSummary): Record<string, unknown> {
  const lines = summary.items.map(formatDriftItemLine);
  const body = lines.length ? lines.join("\n") : "_(no itemized changes)_";
  const truncatedNote = summary.truncated ? "\n_…list truncated_" : "";

  return {
    text: summary.headline, // fallback for notifications/screen readers
    blocks: [
      {
        type: "header",
        text: { type: "plain_text", text: "Schema drift detected", emoji: true },
      },
      {
        type: "section",
        text: { type: "mrkdwn", text: `*${summary.headline}*` },
      },
      {
        type: "section",
        text: { type: "mrkdwn", text: `${body}${truncatedNote}` },
      },
    ],
  };
}

// ── Microsoft Teams ─────────────────────────────────────────────────────
// Legacy "MessageCard" format — still the format Teams incoming webhooks
// (Office 365 Connectors) accept; Teams' newer Adaptive Card / Workflows
// webhook flow is a separate setup the user would opt into explicitly, so
// this stays on the format that matches a plain "Incoming Webhook" connector
// URL, matching Slack's "just paste a URL" UX.
export function formatTeamsPayload(summary: DriftSummary): Record<string, unknown> {
  const lines = summary.items.map(formatDriftItemLine);
  const itemsText = lines.length ? lines.join("\n\n") : "_(no itemized changes)_";
  const truncatedNote = summary.truncated ? "\n\n_…list truncated_" : "";

  return {
    "@type": "MessageCard",
    "@context": "http://schema.org/extensions",
    summary: "Schema drift detected",
    themeColor: "0076D7",
    title: "Schema drift detected",
    text: `**${summary.headline}**\n\n${itemsText}${truncatedNote}`,
  };
}

export function formatPayload(
  provider: NotificationProvider,
  summary: DriftSummary
): Record<string, unknown> {
  return provider === "slack" ? formatSlackPayload(summary) : formatTeamsPayload(summary);
}

// Post a drift summary to a configured webhook. Never throws — every failure
// path (missing config, disabled, network error, non-2xx) resolves to a
// NotifyResult the caller can show as a small inline warning.
export async function notifyDrift(
  webhook: WebhookConfig | null | undefined,
  summary: DriftSummary
): Promise<NotifyResult> {
  if (!webhook || !webhook.enabled || !webhook.url.trim()) {
    return { ok: false, delivered: "failed", message: "Notifications are not configured." };
  }
  if (!summary.hasDrift) {
    return { ok: true, delivered: "confirmed", message: "No drift — nothing to send." };
  }

  const payload = formatPayload(webhook.provider, summary);

  try {
    if (webhook.provider === "slack") {
      // no-cors: browser is allowed to send this cross-origin POST, but the
      // response is opaque (status/body unreadable) — see the module header
      // for why. We optimistically report success since a thrown exception
      // here would mean the request never left the browser.
      await fetch(webhook.url, {
        method: "POST",
        mode: "no-cors",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      return {
        ok: true,
        delivered: "unverifiable",
        message: "Sent to Slack (delivery can't be confirmed from the browser).",
      };
    }

    // Teams: attempt a normal CORS fetch. Per the researched CORS reality
    // above, this is expected to fail from a plain browser in most setups —
    // caught below and surfaced honestly rather than pretended away.
    const res = await fetch(webhook.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      return { ok: true, delivered: "confirmed", message: "Sent to Microsoft Teams." };
    }
    return {
      ok: false,
      delivered: "failed",
      message: `Microsoft Teams webhook returned HTTP ${res.status}.`,
    };
  } catch (err) {
    const hint =
      webhook.provider === "teams"
        ? " Microsoft Teams webhooks typically block direct browser POSTs (CORS) — " +
          "a small server-side relay is needed for reliable delivery; see project notes."
        : "";
    const detail = err instanceof Error ? err.message : String(err);
    return { ok: false, delivered: "failed", message: `Failed to reach webhook: ${detail}.${hint}` };
  }
}
