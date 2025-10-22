const API_BASE_URL =
  process.env.API_BASE_URL ||
  process.env.NEXT_PUBLIC_API_BASE_URL ||
  "http://localhost:3000";

export async function POST(request: Request) {
  try {
    const { packageName } = await request.json();

    if (!packageName || typeof packageName !== "string") {
    return Response.json(
    { error: "Missing `packageName` in request body." },
    { status: 400 },
    );
    }

    // Proxy the request to the backend for actual indexing
    console.log(`📦 UI API: Requesting indexing for package: ${packageName} via ${API_BASE_URL}/index`);

    const backendResponse = await fetch(`${API_BASE_URL}/index`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ packageName }),
    });

    console.log(`📦 UI API: Backend response status: ${backendResponse.status}`);

    const responseText = await backendResponse.text();
    console.log(`📦 UI API: Backend response:`, responseText);

    return new Response(responseText, {
      status: backendResponse.status,
      headers: {
        'Content-Type': backendResponse.headers.get('content-type') ?? 'application/json',
      },
    });
  } catch (error) {
    console.error("Index request error:", error);
    return Response.json(
      { error: "Indexing request failed." },
      { status: 500 },
    );
  }
}
