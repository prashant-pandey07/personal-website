
const WORKER_URL =
  "https://temp-inbox.prashantexperimentiqw.workers.dev";

const ALLOWED_RECIPIENTS = new Set([
  "public@prashant-pandey.com.np",
  "temp@prashant-pandey.com.np",
  "use@prashant-pandey.com.np",
  "test@prashant-pandey.com.np",
  "free@prashant-pandey.com.np",
  "prash@prashant-pandey.com.np",
]);

export default async function handler(request) {
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  };

  if (request.method !== "GET") {
    return Response.json(
      { error: "Method not allowed" },
      { status: 405, headers: { ...headers, Allow: "GET" } }
    );
  }

  const token = process.env.INBOX_API_TOKEN;

  if (!token) {
    return Response.json(
      { error: "Server configuration missing" },
      { status: 500, headers }
    );
  }

  const url = new URL(request.url);
  const hasRecipient = url.searchParams.has("recipient");
  const recipient = (url.searchParams.get("recipient") || "")
    .trim()
    .toLowerCase();

  if (hasRecipient && !ALLOWED_RECIPIENTS.has(recipient)) {
    return Response.json(
      { error: "Unknown recipient address" },
      { status: 400, headers }
    );
  }

  const workerUrl = new URL(`${WORKER_URL}/api/messages`);
  workerUrl.searchParams.set("limit", "50");

  if (recipient) {
    workerUrl.searchParams.set("recipient", recipient);
  }

  try {
    const response = await fetch(workerUrl, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      console.error("Worker status:", response.status);

      return Response.json(
        { error: "Inbox service unavailable" },
        { status: 502, headers }
      );
    }

    const data = await response.json();

    const result = (data.messages || []).map((message) => ({
      id: message.id,
      sender: message.sender,
      recipient: message.recipient,
      subject: message.subject,
      verification_code: message.verification_code,
      received_at: message.received_at,
    }));

    return Response.json({ messages: result }, { headers });
  } catch (error) {
    console.error("Inbox proxy error:", error.message);

    return Response.json(
      { error: "Could not load inbox" },
      { status: 502, headers }
    );
  }
}
