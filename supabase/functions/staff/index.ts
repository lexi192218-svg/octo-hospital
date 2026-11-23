const url = Deno.env.get("SUPABASE_URL")!;
const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const roles = ["cashier", "nurse", "doctor", "surgeon", "lab", "pharmacy"];
const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "apikey, authorization, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
};
const reply = (data: unknown, status = 200) => new Response(JSON.stringify(data), {status, headers});
function request(path: string, method: string, payload?: unknown, token = service) {
  return fetch(url + path, {method, headers: {
    apikey: service, Authorization: "Bearer " + token, "Content-Type": "application/json",
  }, body: payload === undefined ? undefined : JSON.stringify(payload)});
}
Deno.serve(async req => {
  if (req.method === "OPTIONS") return new Response(null, {status: 204, headers});
  if (req.method !== "POST") return reply({error: "Method not allowed"}, 405);
  try {
    const token = req.headers.get("Authorization")?.match(/^Bearer (.+)$/)?.[1];
    if (!token || token === service) return reply({error: "Sign in first"}, 401);
    const auth = await request("/auth/v1/user", "GET", undefined, token);
    if (!auth.ok) return reply({error: "Sign in again"}, 401);
    const user = await auth.json();
    const admin = await request("/rest/v1/staff?select=id&id=eq." + encodeURIComponent(user.id) + "&role=eq.admin&active=eq.true", "GET");
    if (!admin.ok || !(await admin.json()).length) return reply({error: "Administrator access required"}, 403);
    const body = await req.json();
    if (body.action === "access") {
      if (typeof body.active !== "boolean" || !/^[\da-f-]{36}$/i.test(body.id) || body.id === user.id)
        return reply({error: "Choose another staff account"}, 400);
      const result = await request("/rest/v1/staff?id=eq." + body.id + "&role=neq.admin", "PATCH", {active: body.active});
      return result.ok ? reply({ok: true}) : reply({error: "Could not update staff access"}, 502);
    }
    const email = String(body.email ?? "").trim().toLowerCase();
    const name = String(body.name ?? "").trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 254 || name.length < 2 || name.length > 120 || !roles.includes(body.role))
      return reply({error: "Enter a valid name, email and staff role"}, 400);
    // Supabase sends an invite. The staff member sets their own password.
    const web = Deno.env.get("OCTO_SITE_URL");
    const redirect = web ? "?redirect_to=" + encodeURIComponent(web + "/staff.html") : "";
    const invitation = await request("/auth/v1/invite" + redirect, "POST", {email});
    if (!invitation.ok) return reply({error: "Invitation failed. Check that the address is new and staff email delivery is configured."}, 409);
    const invited = await invitation.json();
    const id = invited.id ?? invited.user?.id;
    if (!id) return reply({error: "Invitation did not return a staff identifier"}, 502);
    const saved = await request("/rest/v1/staff", "POST", {id, name, email, role: body.role});
    if (!saved.ok) {
      await request("/auth/v1/admin/users/" + encodeURIComponent(id), "DELETE");
      return reply({error: "Could not save the staff account"}, 502);
    }
    return reply({ok: true}, 201);
  } catch {
    return reply({error: "Staff request could not be completed"}, 400);
  }
});
