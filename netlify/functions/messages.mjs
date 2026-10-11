
const WORKER_URL =
  "https://temp-inbox.prashantexperimentiqw.workers.dev";

export default async function handler(request) {
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  };

  if (request.method !== "GET") {
    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      {
        status: 405,
        headers: { ...headers, Allow: "GET" },
      }
    );
  }

  const token = process.env.INBOX_API_TOKEN;

  if (!token) {
    return Response.json(
      { error: "Server configuration missing" },
      { status: 500, headers }
    );
  }

  try {
    const response = await fetch(
      `${WORKER_URL}/api/messages?limit=20`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(10000),
      }
    );

    if (!response.ok) {
      console.error("Inbox Worker returned status:", response.status);
      return Response.json(
        { error: "Inbox service unavailable" },
        { status: 502, headers }
      );
    }

    const data = await response.json();

    // Return only the fields needed by the public page.
    // This deliberately excludes the full email body.
    const messages = (data.messages || []).map((message) => ({
      id: message.id,
      sender: message.sender,
      recipient: message.recipient,
      subject: message.subject,
      verification_code: message.verification_code,
      received_at: message.received_at,
    }));

    return Response.json({ messages }, { headers });
  } catch (error) {
    console.error("Inbox proxy failed:", error.message);
    return Response.json(
      { error: "Could not load inbox" },
      { status: 502, headers }
    );
  }
}
