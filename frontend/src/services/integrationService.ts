// src/services/integrationService.ts
// Calls the ScribeAI backend integration endpoints for Slack and Notion

const API_BASE = import.meta.env.VITE_API_URL ?? "http://localhost:3003";

export interface IntegrationResult {
  ok: boolean;
  pageUrl?: string;
  error?: string;
}

export async function pushToSlack(
  meeting: any,
  webhookUrl: string
): Promise<IntegrationResult> {
  try {
    const resp = await fetch(`${API_BASE}/api/integrations/slack/push`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ webhookUrl, meeting }),
    });
    const data = await resp.json();
    if (!resp.ok) return { ok: false, error: data?.error || "Slack push failed" };
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message || "Network error" };
  }
}

export async function pushToNotion(
  meeting: any,
  notionToken: string,
  databaseId: string
): Promise<IntegrationResult> {
  try {
    const resp = await fetch(`${API_BASE}/api/integrations/notion/push`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notionToken, databaseId, meeting }),
    });
    const data = await resp.json();
    if (!resp.ok) return { ok: false, error: data?.error || "Notion push failed" };
    return { ok: true, pageUrl: data.pageUrl };
  } catch (e: any) {
    return { ok: false, error: e?.message || "Network error" };
  }
}
