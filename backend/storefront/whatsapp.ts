import { z } from "zod";
import { assert } from "../core/errors";

export function normalizePhone(value: string) {
  assert(value && typeof value === "string", 400, "Enter a valid mobile number");
  let digits = value
    .trim()
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)))
    .replace(/[\s()\-./]/g, "");

  if (digits.startsWith("00")) {
    digits = "+" + digits.slice(2);
  }
  if (digits.startsWith("+96605")) {
    digits = "+9665" + digits.slice(6);
  } else if (digits.startsWith("96605")) {
    digits = "+9665" + digits.slice(5);
  } else if (digits.startsWith("05")) {
    digits = "+9665" + digits.slice(2);
  } else if (/^5\d{8}$/.test(digits)) {
    digits = "+966" + digits;
  } else if (digits.startsWith("9665")) {
    digits = "+" + digits;
  }

  const phone = digits.startsWith("+") ? digits : `+${digits}`;
  assert(
    /^\+[1-9]\d{7,14}$/.test(phone),
    400,
    "Enter a valid mobile number with country code",
  );
  return phone;
}

export function getStoreUrl() {
  const base = process.env.APP_ORIGIN || process.env.PUBLIC_URL || "https://softwaresolver.online";
  return `${base.replace(/\/$/, "")}/amt_price_list/store`;
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
      signal: AbortSignal.timeout(path === "status" ? 8000 : 25000),
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
    return whatsapp("test", { destination: normalizePhone(mobile), storeUrl: getStoreUrl() });
  }
  if (action === "status") {
    if (!process.env.WHATSAPP_SERVICE_URL || !process.env.WHATSAPP_SERVICE_TOKEN) {
      return {
        status: "NOT_CONFIGURED",
        diagnostic: "WhatsApp service is not configured. Contact the store administrator.",
        qr: null,
        number: null,
      };
    }
    try {
      return await whatsapp("status");
    } catch (e: any) {
      return {
        status: "UNREACHABLE",
        diagnostic: e.message || "WhatsApp service is unreachable or restarting.",
        qr: null,
        number: null,
      };
    }
  }
  return whatsapp(action, {});
}
