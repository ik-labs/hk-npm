const API_BASE_URL =
  process.env.API_BASE_URL ||
  process.env.NEXT_PUBLIC_API_BASE_URL ||
  "http://localhost:3000";

export async function POST(request: Request) {
  try {
    const payload = await request.json();

    if (
      !payload ||
      typeof payload.intent !== "string" ||
      typeof payload.packageName !== "string"
    ) {
      return Response.json(
        { error: "Request must include `intent` and `packageName`." },
        { status: 400 },
      );
    }

    const upstream = await fetch(`${API_BASE_URL}/answer`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(payload),
    });

    const text = await upstream.text();

    return new Response(text, {
      status: upstream.status,
      headers: {
        "Content-Type":
          upstream.headers.get("content-type") ?? "application/json",
      },
    });
  } catch (error) {
    console.error("Answer proxy error:", error);
    return Response.json(
      { error: "Answer proxy failed." },
      { status: 500 },
    );
  }
}
