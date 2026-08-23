/**
 * Minimal server-only wrapper around the Lovable AI Gateway chat endpoint.
 * Used for the AI walkthrough preview (image refinement + narration).
 */

const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";

export class AiGatewayError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "AiGatewayError";
  }
}

interface ChatMessage {
  role: "system" | "user";
  content: unknown;
}

export async function callGateway(body: {
  model: string;
  messages: ChatMessage[];
  modalities?: string[];
  response_format?: unknown;
}) {
  const key = process.env["LOVABLE_API_KEY"];
  if (!key) throw new AiGatewayError(401, "AI is not configured for this project.");

  const response = await fetch(GATEWAY_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Lovable-API-Key": key,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    let message = text;
    try {
      const parsed = JSON.parse(text) as { error?: { message?: string }; message?: string };
      message = parsed.error?.message ?? parsed.message ?? text;
    } catch {
      /* keep raw text */
    }
    if (response.status === 402) {
      throw new AiGatewayError(402, message || "AI credits are exhausted for this workspace.");
    }
    if (response.status === 403) {
      throw new AiGatewayError(403, message || "AI access is blocked by workspace policy.");
    }
    if (response.status === 429) {
      throw new AiGatewayError(429, "AI is rate limited right now. Try again in a moment.");
    }
    throw new AiGatewayError(response.status, message || "The AI request failed.");
  }

  return (await response.json()) as {
    choices: {
      message: {
        content?: string | null;
        images?: { image_url?: { url?: string } }[];
      };
    }[];
  };
}

export function extractImage(payload: Awaited<ReturnType<typeof callGateway>>) {
  const url = payload.choices?.[0]?.message?.images?.[0]?.image_url?.url;
  if (!url) throw new AiGatewayError(502, "The AI returned no image for this panorama.");
  return url;
}

export function extractText(payload: Awaited<ReturnType<typeof callGateway>>) {
  return payload.choices?.[0]?.message?.content ?? "";
}
