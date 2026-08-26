import { getDB } from "@/backend/core/db";
import { handle } from "@/backend/api/router";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function dispatch(request: Request) {
  try {
    return await handle(request, await getDB());
  } catch (error) {
    console.error("Database unavailable", error);
    return Response.json(
      { error: "Database unavailable. Check deployment configuration." },
      { status: 503 },
    );
  }
}
export {
  dispatch as GET,
  dispatch as POST,
  dispatch as PUT,
  dispatch as DELETE,
};
