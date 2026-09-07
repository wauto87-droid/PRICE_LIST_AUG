import { z } from "zod";
import { assert } from "../core/errors";

export function normalizePhone(value: string) {
  const digits = value
    .trim()
    .replace(/[\s()\-]/g, "")
    .replace(/^00/, "+")
    .replace(/^05/, "+9665");
  const phone = digits.startsWith("+") ? digits : `+${digits}`;
  assert(
    /^\+[1-9]\d{7,14}$/.test(phone),
    400,
    "Enter a valid mobile number with country code",
  );
  return phone;
}

export async function whatsapp(path: string, payload?: unknown) {
  const endpoint = process.env.WHATSAPP_SERVICE_URL;
  const token = process.env.WHATSAPP_SERVICE_TOKEN;
  assert(
    endpoint && token,
    503,
    "WhatsApp service is not configured. Contact the store administrator",
  );
  let response: Response;
  try {
    response = await fetch(`${endpoint.replace(/\/$/, "")}/${path}`, {
      method: payload === undefined ? "GET" : "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: payload === undefined ? undefined : JSON.stringify(payload),
      signal: AbortSignal.timeout(path === "status" ? 3000 : 20000),
      cache: "no-store",
    });
  } catch {
    assert(false, 503, "WhatsApp service is unreachable. Check that the WhatsApp service is running and its private URL is correct.");
  }
  assert(response!.status !== 401, 503, "WhatsApp service authentication failed. Configure the same service token in the application and WhatsApp service.");
  assert(
    response.ok,
    503,
    "WhatsApp is disconnected or delivery failed. Please retry later",
  );
  return response.json();
}

export async function whatsappAdmin(action: string, raw: unknown) {
  assert(
    ["status", "connect", "disconnect", "test"].includes(action),
    404,
    "Unknown WhatsApp action",
  );
  if (action === "test") {
    const { mobile } = z.object({ mobile: z.string().max(40) }).parse(raw);
    return whatsapp("test", { destination: normalizePhone(mobile) });
  }
  return whatsapp(action, action === "status" ? undefined : {});
}
