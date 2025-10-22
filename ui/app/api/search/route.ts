const API_BASE_URL =
  process.env.API_BASE_URL ||
  process.env.NEXT_PUBLIC_API_BASE_URL ||
  "http://localhost:3000";

export async function POST(request: Request) {
  try {
    const { query, limit } = await request.json();

    if (!query || typeof query !== "string") {
      return Response.json(
        { error: "Missing `query` in request body." },
        { status: 400 },
      );
    }

    const params = new URLSearchParams({ q: query });
    if (limit) params.set("limit", String(limit));

    const upstream = await fetch(`${API_BASE_URL}/search?${params.toString()}`, {
      headers: {
        Accept: "application/json",
      },
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
    console.error("Search proxy error:", error);
    return Response.json(
      { error: "Search proxy failed." },
      { status: 500 },
    );
  }
}
