import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type ControlAction = "pause" | "resume" | "exit" | "rotate";

function resolveControlBaseUrl(): string | null {
  const explicit = process.env.BOT_CONTROL_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, "");

  const stateUrl = process.env.BOT_STATE_URL?.trim();
  if (!stateUrl) return null;
  return stateUrl.replace(/\/state\/?$/i, "");
}

function authHeaders(): Record<string, string> {
  const token = process.env.BOT_STATE_AUTH_TOKEN?.trim();
  if (!token) return {};
  return {
    "x-bot-status-token": token
  };
}

export async function GET(): Promise<Response> {
  const baseUrl = resolveControlBaseUrl();
  if (!baseUrl) {
    return NextResponse.json(
      {
        error: "BOT_CONTROL_URL/BOT_STATE_URL not configured."
      },
      { status: 501 }
    );
  }

  try {
    const response = await fetch(`${baseUrl}/controls`, {
      method: "GET",
      headers: {
        ...authHeaders()
      },
      cache: "no-store"
    });
    const payload = await response.json();
    return NextResponse.json(payload, {
      status: response.status,
      headers: {
        "Cache-Control": "no-store, max-age=0"
      }
    });
  } catch {
    return NextResponse.json(
      {
        error: "Failed to reach bot control endpoint."
      },
      { status: 502 }
    );
  }
}

export async function POST(request: Request): Promise<Response> {
  const baseUrl = resolveControlBaseUrl();
  if (!baseUrl) {
    return NextResponse.json(
      {
        error: "BOT_CONTROL_URL/BOT_STATE_URL not configured."
      },
      { status: 501 }
    );
  }

  const body = (await request.json().catch(() => ({}))) as {
    action?: ControlAction;
    poolId?: string;
  };
  const action = body.action;

  if (!action || !["pause", "resume", "exit", "rotate"].includes(action)) {
    return NextResponse.json(
      {
        error: "action must be one of pause|resume|exit|rotate"
      },
      { status: 400 }
    );
  }

  const targetPathByAction: Record<ControlAction, string> = {
    pause: "/controls/pause",
    resume: "/controls/resume",
    exit: "/controls/exit",
    rotate: "/controls/rotate"
  };
  const targetUrl = `${baseUrl}${targetPathByAction[action]}`;
  const forwardBody =
    action === "rotate"
      ? {
          poolId: body.poolId ?? ""
        }
      : undefined;

  try {
    const response = await fetch(targetUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...authHeaders()
      },
      body: forwardBody ? JSON.stringify(forwardBody) : undefined,
      cache: "no-store"
    });
    const payload = await response.json();
    return NextResponse.json(payload, {
      status: response.status,
      headers: {
        "Cache-Control": "no-store, max-age=0"
      }
    });
  } catch {
    return NextResponse.json(
      {
        error: "Failed to send control command."
      },
      { status: 502 }
    );
  }
}
