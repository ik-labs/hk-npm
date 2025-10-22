import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const USERNAME = process.env.BASIC_AUTH_USERNAME;
const PASSWORD = process.env.BASIC_AUTH_PASSWORD;

function credentialsConfigured(): boolean {
  return Boolean(USERNAME && PASSWORD);
}

export function middleware(request: NextRequest) {
  if (!credentialsConfigured()) {
    return NextResponse.next();
  }

  const authHeader = request.headers.get("authorization");
  if (!authHeader || !authHeader.startsWith("Basic ")) {
    return unauthorizedResponse();
  }

  const base64Credentials = authHeader.slice("Basic ".length).trim();
  let decoded: string;
  try {
    decoded = Buffer.from(base64Credentials, "base64").toString("utf-8");
  } catch {
    return unauthorizedResponse();
  }

  const separatorIndex = decoded.indexOf(":");
  if (separatorIndex === -1) {
    return unauthorizedResponse();
  }

  const username = decoded.slice(0, separatorIndex);
  const password = decoded.slice(separatorIndex + 1);

  if (username === USERNAME && password === PASSWORD) {
    return NextResponse.next();
  }

  return unauthorizedResponse();
}

function unauthorizedResponse(): NextResponse {
  return new NextResponse("Authentication required", {
    status: 401,
    headers: {
      "WWW-Authenticate": "Basic realm=\"NPM Intel\"",
    },
  });
}

export const config = {
  matcher: ["/((?!api/).*)"],
};
