import { GoogleGenAI, Type } from "@google/genai";
import { parsePhoneNumberFromString } from "libphonenumber-js/max";

interface Env {
  ASSETS: {
    fetch(request: Request): Promise<Response>;
  };
  GEMINI_API_KEY?: string;
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  GUIDE_SIGNUP_TOKEN?: string;
  SIGNUP_TOKEN?: string;
  PUBLIC_SIGNUP_TOKEN?: string;
  ADMIN_ACCESS_TOKEN?: string;
}

const jsonHeaders = {
  "Content-Type": "application/json",
};

const SCHEDULE_HOST = "schedule.stgtp.com";
const COORD_HOST = "coord.stgtp.com";
const APEX_HOSTS = new Set(["stgtp.com", "www.stgtp.com"]);
const MANAGED_CUSTOM_HOSTS = new Set([SCHEDULE_HOST, COORD_HOST, ...APEX_HOSTS]);

const systemInstruction = `You are an expert data extraction assistant specializing in document cleaning and structure recovery.
Your absolute goal is to extract only the main columns and tables of information from the provided PDF document.
Return exactly the requested schema as JSON. Every row must align exactly with the columns array.
You MUST ignore all background noise:
- Page headers, titles, branding, and logos.
- Page footers, page numbers, run dates, copyright messages, contact links, and address text in margins.
- Extraneous text blocks, sidebars, or decorative margins.
- Session summary rows, arrival times, notes, sealer lines, guest-count lines, and page-total lines unless the user's requested columns explicitly ask for them.

Strictly focus on the main columns of tabular data or structural list-columns.
Combine any fragmented rows or multi-page table flows into a single unified table structure.
Ensure the extracted column headers are clean and descriptive.`;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const response = await handleRequest(request, env, url);
    return addNoIndexHeaders(response, url);
  },
};

async function handleRequest(request: Request, env: Env, url: URL): Promise<Response> {
    if (request.method === "OPTIONS" && url.pathname.startsWith("/api/")) {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        },
      });
    }

    if (url.pathname === "/robots.txt") {
      return new Response("User-agent: *\nDisallow: /\n", {
        status: 200,
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "no-store",
        },
      });
    }

    if (isApexHost(url)) {
      return comingSoonPage();
    }

    if (url.pathname.startsWith("/admin-login/")) {
      return handleAdminLogin(request, env, url);
    }

    if (isScheduleHost(url) && url.pathname.startsWith("/api/") && !url.pathname.startsWith("/api/public/")) {
      return json({ error: "Not found." }, 404);
    }

    const requiresAdmin = !isCoordHost(url) && !isScheduleHost(url);
    if (requiresAdmin && !isPublicRoute(url) && !isAuthorizedAdmin(request, env)) {
      if (url.pathname.startsWith("/api/")) {
        return json({ error: "Admin access required." }, 401);
      }

      return adminLockedPage();
    }

    if (url.pathname === "/api/extract") {
      if (request.method !== "POST") {
        return json({ error: "Method not allowed" }, 405);
      }

      return handleExtract(request, env);
    }

    if (url.pathname === "/api/validate-phone") {
      if (request.method !== "GET") {
        return json({ error: "Method not allowed" }, 405);
      }

      return handleValidatePhone(url);
    }

    if (url.pathname === "/api/conflicts/apply-all") {
      if (request.method !== "POST") {
        return json({ error: "Method not allowed" }, 405);
      }

      return handleApplyAllConflicts(request, env);
    }

    if (url.pathname === "/api/public/signup-slots") {
      if (request.method !== "GET") {
        return json({ error: "Method not allowed" }, 405);
      }

      return handleSignupSlots(request, env, url);
    }

    if (url.pathname === "/api/public/signup") {
      if (request.method !== "POST") {
        return json({ error: "Method not allowed" }, 405);
      }

      return handleGuideSignup(request, env);
    }

    if (url.pathname === "/api/maintenance/clean-emails") {
      if (request.method !== "POST") {
        return json({ error: "Method not allowed" }, 405);
      }

      return handleCleanEmails(env);
    }

    if (url.pathname.startsWith("/api/db/")) {
      return handleDatabaseRequest(request, env, url);
    }

    return env.ASSETS.fetch(request);
}

function getHost(url: URL): string {
  return url.hostname.toLowerCase();
}

function isScheduleHost(url: URL): boolean {
  return getHost(url) === SCHEDULE_HOST;
}

function isCoordHost(url: URL): boolean {
  return getHost(url) === COORD_HOST;
}

function isApexHost(url: URL): boolean {
  return APEX_HOSTS.has(getHost(url));
}

function isManagedCustomHost(url: URL): boolean {
  return MANAGED_CUSTOM_HOSTS.has(getHost(url));
}

function addNoIndexHeaders(response: Response, url: URL): Response {
  if (!isManagedCustomHost(url)) return response;

  const headers = new Headers(response.headers);
  headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
  if ((headers.get("Content-Type") || "").includes("text/html")) {
    headers.set("Cache-Control", "no-store");
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function isPublicRoute(url: URL): boolean {
  return url.pathname.startsWith("/guide-signup") ||
    url.pathname.startsWith("/api/public/") ||
    url.pathname.startsWith("/assets/") ||
    url.pathname === "/favicon.ico" ||
    url.pathname === "/robots.txt";
}

function handleAdminLogin(_request: Request, env: Env, url: URL): Response {
  const expectedToken = env.ADMIN_ACCESS_TOKEN;
  const providedToken = decodeURIComponent(url.pathname.replace(/^\/admin-login\//, "").split("/")[0] || "");

  if (!expectedToken || providedToken !== expectedToken) {
    return adminLockedPage();
  }

  return new Response(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Opening CRM</title>
    <style>
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #f8fafc; color: #0f172a; font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      main { width: min(420px, calc(100vw - 32px)); border: 1px solid #e2e8f0; border-radius: 18px; background: white; padding: 28px; box-shadow: 0 18px 45px rgba(15, 23, 42, 0.08); }
      h1 { margin: 0 0 10px; font-size: 24px; }
      p { margin: 0; color: #475569; line-height: 1.55; font-weight: 600; }
    </style>
  </head>
  <body>
    <main>
      <h1>Opening CRM</h1>
      <p>Refreshing your secure session...</p>
    </main>
    <script>
      localStorage.setItem("temple_admin_token", ${JSON.stringify(expectedToken)});
      setTimeout(() => location.replace("/contacts?auth=" + Date.now()), 50);
    </script>
  </body>
</html>`, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Set-Cookie": [
        `temple_admin=${encodeURIComponent(expectedToken)}`,
        "Path=/",
        "HttpOnly",
        "Secure",
        "SameSite=Lax",
        "Max-Age=2592000",
      ].join("; "),
      "Cache-Control": "no-store",
      "Clear-Site-Data": '"cache"',
    },
  });
}

function isAuthorizedAdmin(request: Request, env: Env): boolean {
  const expectedToken = env.ADMIN_ACCESS_TOKEN;
  if (!expectedToken) return false;
  const headerToken = request.headers.get("X-Admin-Token") || request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "") || "";
  if (headerToken === expectedToken) return true;

  const cookieHeader = request.headers.get("Cookie") || "";
  const cookies = Object.fromEntries(cookieHeader.split(";").map(part => {
    const [key, ...rest] = part.trim().split("=");
    return [key, decodeURIComponent(rest.join("=") || "")];
  }));
  return cookies.temple_admin === expectedToken;
}

function adminLockedPage(): Response {
  return new Response(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Access Required</title>
    <style>
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #f8fafc; color: #0f172a; font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      main { width: min(420px, calc(100vw - 32px)); border: 1px solid #e2e8f0; border-radius: 18px; background: white; padding: 28px; box-shadow: 0 18px 45px rgba(15, 23, 42, 0.08); }
      h1 { margin: 0 0 10px; font-size: 24px; }
      p { margin: 0; color: #475569; line-height: 1.55; font-weight: 600; }
    </style>
  </head>
  <body>
    <main>
      <h1>Access Required</h1>
      <p>This CRM is private. Use the admin login link to continue.</p>
    </main>
  </body>
</html>`, {
    status: 404,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function comingSoonPage(): Response {
  return new Response(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex,nofollow,noarchive" />
    <title>Coming Soon</title>
    <style>
      :root { color-scheme: light; }
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #f8fafc; color: #111827; font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      main { width: min(520px, calc(100vw - 32px)); text-align: center; padding: 40px 24px; }
      h1 { margin: 0 0 12px; font-size: clamp(32px, 8vw, 56px); line-height: 1; letter-spacing: 0; }
      p { margin: 0 auto; max-width: 34rem; color: #475569; font-size: 17px; line-height: 1.6; font-weight: 650; }
    </style>
  </head>
  <body>
    <main>
      <h1>Coming Soon</h1>
      <p>This site is not open to the public yet.</p>
    </main>
  </body>
</html>`, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

const collections = {
  crm_contacts: {
    table: "temple_contacts",
    fromRow: contactFromRow,
    toRow: contactToRow,
  },
  events: {
    table: "temple_events",
    fromRow: eventFromRow,
    toRow: eventToRow,
  },
  crm_sync_conflicts: {
    table: "temple_sync_conflicts",
    fromRow: conflictFromRow,
    toRow: conflictToRow,
  },
  crm_never_rules: {
    table: "temple_never_rules",
    fromRow: neverRuleFromRow,
    toRow: neverRuleToRow,
  },
  text_templates: {
    table: "temple_text_templates",
    fromRow: templateFromRow,
    toRow: templateToRow,
  },
  import_batches: {
    table: "temple_import_batches",
    fromRow: (row: any) => row,
    toRow: (data: any, id: string) => ({ id, ...data }),
  },
} as const;

type CollectionName = keyof typeof collections;

async function handleExtract(request: Request, env: Env): Promise<Response> {
  try {
    if (!env.GEMINI_API_KEY) {
      return json({ error: "Missing GEMINI_API_KEY secret on Cloudflare Workers." }, 500);
    }

    const { pdfData, customInstruction } = await request.json() as {
      pdfData?: string;
      customInstruction?: string;
    };

    if (!pdfData) {
      return json({ error: "Missing pdfData. Please upload a valid PDF file." }, 400);
    }

    const base64Data = pdfData.replace(/^data:application\/pdf;base64,/, "");
    const pdfBytes = decodeBase64(base64Data);
    const pdfHeader = new TextDecoder().decode(pdfBytes.slice(0, 5));
    if (pdfBytes.length === 0 || pdfHeader !== "%PDF-") {
      return json({
        error: "The uploaded file is not a readable PDF. If you are on iPad, open the downloaded file first and confirm it has pages, then save/share the actual PDF to Files before uploading.",
      }, 400);
    }

    const userPrompt = customInstruction
      ? `Extract the requested structured data from this PDF document. Follow this extraction rule exactly: ${customInstruction}`
      : "Extract all columns and rows of tabular data from the PDF document, ignoring headers, footers, margins, and non-table noise.";

    const ai = new GoogleGenAI({
      apiKey: env.GEMINI_API_KEY,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        },
      },
    });

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [
        {
          inlineData: {
            mimeType: "application/pdf",
            data: base64Data,
          },
        },
        {
          text: userPrompt,
        },
      ],
      config: {
        systemInstruction,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            title: {
              type: Type.STRING,
              description: "A descriptive, concise title for the extracted table or data set.",
            },
            columns: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: "The clean column header names extracted from the table columns in the document.",
            },
            rows: {
              type: Type.ARRAY,
              items: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: "The cell values for this row, aligned in order with the columns list.",
              },
              description: "All rows of tabular data extracted from the document.",
            },
            summary: {
              type: Type.STRING,
              description: "A brief 1-2 sentence summary of what this table represents.",
            },
          },
          required: ["columns", "rows", "title"],
        },
      },
    });

    const text = response.text;
    if (!text) {
      throw new Error("No response received from the Gemini model.");
    }

    return new Response(text.trim(), {
      status: 200,
      headers: jsonHeaders,
    });
  } catch (error: any) {
    const message = error?.message || "";
    if (/no pages|invalid argument/i.test(message)) {
      return json({
        error: "Gemini could not find readable pages in this PDF. On iPad, this often means the saved file is empty, a download placeholder, or not the real PDF. Open the PDF in Files first to confirm pages are visible, then upload that file again.",
      }, 400);
    }

    return json({
      error: message || "An unexpected error occurred during PDF processing.",
    }, 500);
  }
}

async function handleSignupSlots(request: Request, env: Env, url: URL): Promise<Response> {
  try {
    const tokenCheck = validateSignupToken(request, env, url.searchParams.get("token"));
    if (tokenCheck) return tokenCheck;

    const [eventRows, contactRows, conflictRows] = await Promise.all([
      supabaseRows(env, collections.events.table),
      supabaseRows(env, collections.crm_contacts.table),
      supabaseRequest(
        env,
        collections.crm_sync_conflicts.table,
        "?status=eq.pending&sheet_type=eq.guide_signup&select=*",
      ),
    ]);

    const contactNames = new Map<string, string>();
    for (const row of contactRows) {
      contactNames.set(row.id, row.worker_name || row.id);
    }

    const pendingByEventRole = new Map<string, string>();
    for (const row of conflictRows) {
      const conflict = conflictFromRow(row);
      const incoming = parseConflictJson(conflict.incomingValue);
      if (incoming?.action !== "guide_signup" || !incoming.eventId || !incoming.role) continue;
      const key = `${incoming.eventId}:${incoming.role}`;
      if (!pendingByEventRole.has(key)) {
        pendingByEventRole.set(key, incoming.submittedName || `${incoming.lastName || ""}, ${incoming.firstName || ""}`.trim());
      }
    }

    const slots = eventRows
      .map(eventFromRow)
      .filter((event: any) => {
        const date = parseFlexibleDate(event.date);
        if (!date) return false;
        const day = date.getDay();
        return (day === 5 || day === 6) && !event.completed && event.status !== "deleted";
      })
      .sort(comparePublicEvents)
      .map((event: any) => {
        const roleStatus = (role: "bride" | "groom" | "company", contactId: string, confirmed: boolean) => {
          const pendingName = pendingByEventRole.get(`${event.id}:${role}`) || "";
          const assignedName = contactId ? contactNames.get(contactId) || "Assigned" : "";
          return {
            filled: !!contactId || !!pendingName,
            name: assignedName || pendingName,
            pending: (!!contactId && !confirmed) || !!pendingName,
            confirmed: !!contactId && confirmed,
          };
        };

        return {
          id: event.id,
          date: event.date,
          time: event.time,
          room: event.room,
          title: publicEventTitle(event.guests),
          roles: {
            bride: roleStatus("bride", event.assignedLsgId || "", !!event.lsgConfirmed),
            groom: roleStatus("groom", event.assignedGroomLsgId || "", !!event.groomLsgConfirmed),
            company: roleStatus("company", event.assignedCsgId || "", !!event.csgConfirmed),
          },
        };
      })
      .filter((slot: any) => Object.values(slot.roles).some((role: any) => !role.confirmed));

    return json({ slots });
  } catch (error: any) {
    return json({ error: error?.message || "Failed to load signup slots." }, 500);
  }
}

async function handleGuideSignup(request: Request, env: Env): Promise<Response> {
  try {
    const body = await request.json().catch(() => ({})) as Record<string, any>;
    const tokenCheck = validateSignupToken(request, env, body.token);
    if (tokenCheck) return tokenCheck;

    const eventId = String(body.eventId || "").trim();
    const role = String(body.role || "").trim().toLowerCase();
    const firstName = cleanNamePart(body.firstName);
    const lastName = cleanNamePart(body.lastName);

    if (!eventId || !["bride", "groom", "company"].includes(role)) {
      return json({ error: "Choose a valid date, time, and guide role." }, 400);
    }
    if (!firstName || !lastName) {
      return json({ error: "First name and last name are required." }, 400);
    }

    const eventRow = await supabaseRow(env, collections.events.table, eventId);
    if (!eventRow) {
      return json({ error: "This event is no longer available." }, 404);
    }

    const event = eventFromRow(eventRow);
    const roleField = role === "bride" ? "assignedLsgId" : role === "groom" ? "assignedGroomLsgId" : "assignedCsgId";
    if (event[roleField]) {
      return json({ error: "That guide role has already been filled." }, 409);
    }

    const pendingRows = await supabaseRequest(
      env,
      collections.crm_sync_conflicts.table,
      `?status=eq.pending&sheet_type=eq.guide_signup&contact_id=eq.${encodeURIComponent(eventId)}&select=*`,
    );
    const alreadyPending = pendingRows.some((row: any) => {
      const incoming = parseConflictJson(conflictFromRow(row).incomingValue);
      return incoming?.action === "guide_signup" && incoming.role === role;
    });
    if (alreadyPending) {
      return json({ error: "Someone has already submitted for that guide role. Please choose another opening." }, 409);
    }

    const contacts = (await supabaseRows(env, collections.crm_contacts.table)).map(contactFromRow);
    const matchedContact = findContactBySubmittedName(contacts, firstName, lastName);
    const submittedName = `${lastName}, ${firstName}`;
    const roleLabel = role === "bride" ? "Bride Guide" : role === "groom" ? "Groom Guide" : "Company Guide";
    const now = new Date().toISOString();
    const conflictId = `guide_signup_${eventId}_${role}_${crypto.randomUUID()}`;

    await supabaseUpsert(env, collections.crm_sync_conflicts.table, conflictToRow({
      id: conflictId,
      contactId: eventId,
      workerName: `${submittedName} for ${publicEventTitle(event.guests)}`,
      field: "Guide Signup",
      existingValue: JSON.stringify({
        date: event.date || "",
        time: event.time || "",
        room: event.room || "",
        guests: event.guests || "",
        role,
        roleLabel,
      }),
      incomingValue: JSON.stringify({
        action: "guide_signup",
        eventId,
        role,
        roleLabel,
        firstName,
        lastName,
        submittedName,
        matchedContactId: matchedContact?.id || "",
        matchedContactName: matchedContact?.["Worker Name"] || "",
        eventDate: event.date || "",
        eventTime: event.time || "",
        eventRoom: event.room || "",
        eventGuests: event.guests || "",
      }),
      status: "pending",
      sheetType: "guide_signup",
      updatedAt: now,
    }, conflictId));

    return json({
      ok: true,
      submittedName,
      roleLabel,
      matched: !!matchedContact,
    });
  } catch (error: any) {
    return json({ error: error?.message || "Failed to submit guide signup." }, 500);
  }
}

async function handleDatabaseRequest(request: Request, env: Env, url: URL): Promise<Response> {
  try {
    const parts = url.pathname.replace(/^\/api\/db\//, "").split("/").filter(Boolean);
    const collectionName = parts[0] as CollectionName | undefined;
    const id = parts[1] ? decodeURIComponent(parts[1]) : undefined;

    if (!collectionName || !(collectionName in collections)) {
      return json({ error: "Unknown collection." }, 404);
    }

    const config = collections[collectionName];

    if (request.method === "GET" && !id) {
      const rows = await supabaseRows(env, config.table);
      const filters = Array.from(url.searchParams.entries());
      const docs = rows.map(config.fromRow).filter((doc) => {
        return filters.every(([field, value]) => String(doc[field] ?? "") === value);
      });
      return json(docs);
    }

    if (request.method === "GET" && id) {
      const row = await supabaseRow(env, config.table, id);
      return json(row ? config.fromRow(row) : null);
    }

    if ((request.method === "PUT" || request.method === "PATCH") && id) {
      const incoming = await request.json() as Record<string, any>;
      const existingRow = request.method === "PATCH" ? await supabaseRow(env, config.table, id) : null;
      const existingDoc = existingRow ? config.fromRow(existingRow) : {};
      const mergedDoc = request.method === "PATCH" ? { ...existingDoc, ...incoming, id } : { ...incoming, id };
      const row = config.toRow(mergedDoc, id);
      const saved = await supabaseUpsert(env, config.table, row);
      return json(config.fromRow(saved));
    }

    if (request.method === "DELETE" && id) {
      if (collectionName === "events") {
        const existingRow = await supabaseRow(env, config.table, id);
        if (!existingRow) {
          return json({ ok: true });
        }
        if (existingRow?.status !== "deleted") {
          const now = new Date().toISOString();
          const saved = await supabaseUpsert(env, config.table, {
            ...existingRow,
            id,
            status: "deleted",
            updated_at: now,
          });
          return json({ ok: true, softDeleted: true, record: config.fromRow(saved) });
        }
      }

      await supabaseDelete(env, config.table, id);
      return json({ ok: true });
    }

    return json({ error: "Method not allowed" }, 405);
  } catch (error: any) {
    return json({ error: error?.message || "Database request failed." }, 500);
  }
}

async function handleApplyAllConflicts(request: Request, env: Env): Promise<Response> {
  try {
    const body = await request.json().catch(() => ({})) as { ids?: unknown };
    const requestedIds = Array.isArray(body.ids)
      ? new Set(body.ids.map(id => String(id)).filter(Boolean))
      : null;
    const pendingRows = await supabaseRequest(
      env,
      collections.crm_sync_conflicts.table,
      "?status=eq.pending&select=*",
    );

    const pendingConflicts = pendingRows
      .map(conflictFromRow)
      .filter((conflict: any) => conflict.sheetType !== "guide_signup")
      .filter((conflict: any) => !requestedIds || requestedIds.has(String(conflict.id || "")));
    const now = new Date().toISOString();
    const eventConflicts = pendingConflicts.filter((conflict: any) => conflict.sheetType === "event_schedule");
    const contactConflicts = pendingConflicts.filter((conflict: any) => conflict.sheetType !== "event_schedule" && conflict.sheetType !== "guide_signup");
    const presenceConflicts = contactConflicts.filter((conflict: any) => conflict.field === "Presence");
    const fieldConflicts = contactConflicts.filter((conflict: any) => conflict.field !== "Presence");

    const contactIdsToDelete = uniqueValues(presenceConflicts.map((conflict: any) => conflict.contactId));
    for (const chunk of chunks(contactIdsToDelete, 100)) {
      await supabaseDeleteMany(env, collections.crm_contacts.table, chunk);
    }

    const contactIdsToUpdate = uniqueValues(fieldConflicts.map((conflict: any) => conflict.contactId));
    const existingContactRows: any[] = [];
    for (const chunk of chunks(contactIdsToUpdate, 100)) {
      existingContactRows.push(...await supabaseRowsByIds(env, collections.crm_contacts.table, chunk));
    }

    const contactsById = new Map<string, Record<string, any>>();
    for (const row of existingContactRows) {
      contactsById.set(row.id, contactFromRow(row));
    }

    for (const conflict of fieldConflicts as any[]) {
      const currentContact = contactsById.get(conflict.contactId) || {
        id: conflict.contactId,
        "Worker Name": conflict.workerName || conflict.contactId,
      };
      contactsById.set(conflict.contactId, {
        ...currentContact,
        [conflict.field]: conflict.incomingValue,
        updatedAt: now,
      });
    }

    const contactRowsToUpsert = Array.from(contactsById.entries()).map(([id, contact]) => contactToRow(contact, id));
    for (const chunk of chunks(contactRowsToUpsert, 100)) {
      await supabaseUpsertMany(env, collections.crm_contacts.table, chunk);
    }

    const eventIdsToUpdate = uniqueValues(eventConflicts.map((conflict: any) => conflict.contactId));
    const existingEventRows: any[] = [];
    for (const chunk of chunks(eventIdsToUpdate, 100)) {
      existingEventRows.push(...await supabaseRowsByIds(env, collections.events.table, chunk));
    }

    const eventsById = new Map<string, Record<string, any>>();
    for (const row of existingEventRows) {
      eventsById.set(row.id, eventFromRow(row));
    }

    for (const conflict of eventConflicts as any[]) {
      const currentEvent = eventsById.get(conflict.contactId) || { id: conflict.contactId };
      if (conflict.field === "Event Details") {
        const incomingEvent = parseConflictJson(conflict.incomingValue);
        if (!incomingEvent) continue;
        eventsById.set(conflict.contactId, {
          ...currentEvent,
          date: incomingEvent.date || "",
          time: incomingEvent.time || "",
          room: incomingEvent.room || "",
          type: incomingEvent.type || "",
          guests: incomingEvent.guests || currentEvent.guests || "",
          status: "changed",
          updatedAt: now,
        });
      } else if (conflict.field === "Event Deletion") {
        eventsById.set(conflict.contactId, {
          ...currentEvent,
          status: "deleted",
          updatedAt: now,
        });
      }
    }

    const eventRowsToUpsert = Array.from(eventsById.entries()).map(([id, event]) => eventToRow(event, id));
    for (const chunk of chunks(eventRowsToUpsert, 100)) {
      await supabaseUpsertMany(env, collections.events.table, chunk);
    }

    const conflictIds: string[] = pendingConflicts.map((conflict: any) => String(conflict.id || "")).filter(Boolean);
    for (const chunk of chunks(conflictIds, 100)) {
      await supabasePatchMany(env, collections.crm_sync_conflicts.table, chunk, {
        status: "applied",
        updated_at: now,
      });
    }

    return json({
      ok: true,
      applied: pendingConflicts.length,
      contactsUpdated: contactRowsToUpsert.length,
      contactsDeleted: contactIdsToDelete.length,
      eventsUpdated: eventRowsToUpsert.length,
    });
  } catch (error: any) {
    return json({ error: error?.message || "Failed to apply all pending conflicts." }, 500);
  }
}

function validateSignupToken(request: Request, env: Env, providedToken: unknown): Response | null {
  const url = new URL(request.url);
  if (isScheduleHost(url)) {
    return null;
  }

  const expectedToken = env.GUIDE_SIGNUP_TOKEN || env.SIGNUP_TOKEN || env.PUBLIC_SIGNUP_TOKEN;
  if (!expectedToken) {
    return json({ error: "Guide signup is not configured yet." }, 404);
  }

  const pathToken = decodeURIComponent(url.pathname.split("/").filter(Boolean).pop() || "");
  const token = String(providedToken || url.searchParams.get("token") || pathToken || "").trim();
  if (token !== expectedToken) {
    return json({ error: "This signup link is not valid." }, 404);
  }

  return null;
}

function cleanNamePart(value: unknown): string {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeName(value: unknown): string {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9,\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function findContactBySubmittedName(contacts: Record<string, any>[], firstName: string, lastName: string): Record<string, any> | null {
  const targetFirst = normalizeName(firstName).split(" ")[0] || "";
  const targetLast = normalizeName(lastName);
  if (!targetFirst || !targetLast) return null;

  return contacts.find((contact) => {
    const name = normalizeName(contact["Worker Name"] || "");
    const [contactLast = "", rest = ""] = name.split(",").map(part => part.trim());
    const contactFirst = rest.split(" ")[0] || "";
    return contactLast === targetLast && contactFirst === targetFirst;
  }) || null;
}

function parseFlexibleDate(value: unknown): Date | null {
  const text = String(value || "").trim();
  if (!text) return null;
  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime())) return parsed;

  const clean = text.replace(/^(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday),\s*/i, "");
  const parsedClean = new Date(clean);
  if (!Number.isNaN(parsedClean.getTime())) return parsedClean;
  return null;
}

function publicTimeMinutes(value: unknown): number {
  const match = String(value || "").trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!match) return Number.MAX_SAFE_INTEGER;
  let hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  const period = match[3].toUpperCase();
  if (period === "PM" && hours < 12) hours += 12;
  if (period === "AM" && hours === 12) hours = 0;
  return hours * 60 + minutes;
}

function comparePublicEvents(a: Record<string, any>, b: Record<string, any>): number {
  const dateA = parseFlexibleDate(a.date)?.getTime() || 0;
  const dateB = parseFlexibleDate(b.date)?.getTime() || 0;
  if (dateA !== dateB) return dateA - dateB;
  return publicTimeMinutes(a.time) - publicTimeMinutes(b.time);
}

function publicEventTitle(guests: unknown): string {
  const names = String(guests || "")
    .split(";")
    .map(name => name.trim())
    .filter(Boolean)
    .map(name => name.split(",")[0]?.trim())
    .filter(Boolean);
  if (names.length >= 2) return `${names[0]} & ${names[1]}`;
  return names[0] || "Temple Assignment";
}

async function handleCleanEmails(env: Env): Promise<Response> {
  try {
    const contactRows = await supabaseRows(env, collections.crm_contacts.table);
    const cleanedRows = contactRows
      .map((row) => {
        const cleanedEmail = cleanEmailValue(row.email);
        return cleanedEmail !== (row.email || "") ? { ...row, email: cleanedEmail } : null;
      })
      .filter(Boolean) as Record<string, any>[];

    for (const chunk of chunks(cleanedRows, 100)) {
      await supabaseUpsertMany(env, collections.crm_contacts.table, chunk);
    }

    return json({
      ok: true,
      scanned: contactRows.length,
      cleaned: cleanedRows.length,
    });
  } catch (error: any) {
    return json({ error: error?.message || "Failed to clean email values." }, 500);
  }
}

async function supabaseRows(env: Env, table: string): Promise<any[]> {
  return supabaseRequest(env, table, "?select=*");
}

async function supabaseRowsByIds(env: Env, table: string, ids: string[]): Promise<any[]> {
  if (ids.length === 0) {
    return [];
  }

  return supabaseRequest(env, table, `?id=in.(${ids.map(encodePostgrestValue).join(",")})&select=*`);
}

async function supabaseRow(env: Env, table: string, id: string): Promise<any | null> {
  const rows = await supabaseRequest(env, table, `?id=eq.${encodeURIComponent(id)}&select=*&limit=1`);
  return rows[0] || null;
}

async function supabaseUpsert(env: Env, table: string, row: Record<string, any>): Promise<any> {
  const rows = await supabaseRequest(env, table, "?on_conflict=id", {
    method: "POST",
    headers: {
      Prefer: "resolution=merge-duplicates,return=representation",
    },
    body: JSON.stringify(row),
  });
  return rows[0] || row;
}

async function supabaseUpsertMany(env: Env, table: string, rows: Record<string, any>[]): Promise<void> {
  if (rows.length === 0) {
    return;
  }

  await supabaseRequest(env, table, "?on_conflict=id", {
    method: "POST",
    headers: {
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify(rows),
  });
}

async function supabaseDelete(env: Env, table: string, id: string): Promise<void> {
  await supabaseRequest(env, table, `?id=eq.${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: {
      Prefer: "return=minimal",
    },
  });
}

async function supabaseDeleteMany(env: Env, table: string, ids: string[]): Promise<void> {
  if (ids.length === 0) {
    return;
  }

  await supabaseRequest(env, table, `?id=in.(${ids.map(encodePostgrestValue).join(",")})`, {
    method: "DELETE",
    headers: {
      Prefer: "return=minimal",
    },
  });
}

async function supabasePatchMany(env: Env, table: string, ids: string[], data: Record<string, any>): Promise<void> {
  if (ids.length === 0) {
    return;
  }

  await supabaseRequest(env, table, `?id=in.(${ids.map(encodePostgrestValue).join(",")})`, {
    method: "PATCH",
    headers: {
      Prefer: "return=minimal",
    },
    body: JSON.stringify(data),
  });
}

async function supabaseRequest(env: Env, table: string, query = "", init: RequestInit = {}): Promise<any> {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY on Cloudflare Workers.");
  }

  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}${query}`, {
    ...init,
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Supabase ${response.status}: ${text}`);
  }

  const text = await response.text();
  if (response.status === 204 || !text.trim()) {
    return null;
  }

  return JSON.parse(text);
}

function contactFromRow(row: any): Record<string, any> {
  return {
    ...(row.extra || {}),
    id: row.id,
    "Worker Name": row.worker_name || "",
    "Household Phone": row.household_phone || "",
    "Personal Phone": row.personal_phone || "",
    Email: cleanEmailValue(row.email),
    Labels: Array.isArray(row.labels) ? row.labels.join(", ") : "",
    "Preferred Phone Type": row.preferred_phone_type || "",
    "Last CSG": row.last_csg || "",
    "Last LSG": row.last_lsg || "",
    "Total CSG": String(row.total_csg ?? 0),
    "Total LSG": String(row.total_lsg ?? 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function contactToRow(data: Record<string, any>, id: string): Record<string, any> {
  const known = new Set([
    "id",
    "Worker Name",
    "Household Phone",
    "Personal Phone",
    "Email",
    "Labels",
    "Preferred Phone Type",
    "Last CSG",
    "Last LSG",
    "Total CSG",
    "Total LSG",
    "createdAt",
    "updatedAt",
  ]);

  const extra = Object.fromEntries(Object.entries(data).filter(([key]) => !known.has(key)));
  return {
    id,
    worker_name: data["Worker Name"] || data.Name || id,
    household_phone: data["Household Phone"] || "",
    personal_phone: data["Personal Phone"] || "",
    email: cleanEmailValue(data.Email),
    labels: splitLabels(data.Labels),
    preferred_phone_type: data["Preferred Phone Type"] || "",
    last_csg: data["Last CSG"] || "",
    last_lsg: data["Last LSG"] || "",
    total_csg: parseInteger(data["Total CSG"]),
    total_lsg: parseInteger(data["Total LSG"]),
    extra,
    updated_at: data.updatedAt || new Date().toISOString(),
  };
}

function eventFromRow(row: any): Record<string, any> {
  return {
    ...(row.extra || {}),
    id: row.id,
    date: row.event_date || "",
    time: row.event_time || "",
    room: row.room || "",
    type: row.event_type || "",
    guests: row.guests || "",
    assignedLsgId: row.assigned_lsg_id || "",
    assignedGroomLsgId: row.assigned_groom_lsg_id || "",
    assignedCsgId: row.assigned_csg_id || "",
    lsgConfirmed: !!row.lsg_confirmed,
    groomLsgConfirmed: !!row.groom_lsg_confirmed,
    csgConfirmed: !!row.csg_confirmed,
    lsgReminded: !!row.lsg_reminded,
    groomLsgReminded: !!row.groom_lsg_reminded,
    csgReminded: !!row.csg_reminded,
    status: row.status || "unassigned",
    completed: !!row.completed,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function eventToRow(data: Record<string, any>, id: string): Record<string, any> {
  const known = new Set([
    "id",
    "date",
    "time",
    "room",
    "type",
    "guests",
    "assignedLsgId",
    "assignedGroomLsgId",
    "assignedCsgId",
    "lsgConfirmed",
    "groomLsgConfirmed",
    "csgConfirmed",
    "lsgReminded",
    "groomLsgReminded",
    "csgReminded",
    "status",
    "completed",
    "completedAt",
    "createdAt",
    "updatedAt",
  ]);

  const extra = Object.fromEntries(Object.entries(data).filter(([key]) => !known.has(key)));
  return {
    id,
    event_date: data.date || "",
    event_time: data.time || "",
    room: data.room || "",
    event_type: data.type || "",
    guests: data.guests || "",
    assigned_lsg_id: nullableText(data.assignedLsgId),
    assigned_groom_lsg_id: nullableText(data.assignedGroomLsgId),
    assigned_csg_id: nullableText(data.assignedCsgId),
    lsg_confirmed: !!data.lsgConfirmed,
    groom_lsg_confirmed: !!data.groomLsgConfirmed,
    csg_confirmed: !!data.csgConfirmed,
    lsg_reminded: !!data.lsgReminded,
    groom_lsg_reminded: !!data.groomLsgReminded,
    csg_reminded: !!data.csgReminded,
    status: data.status || "unassigned",
    completed: !!data.completed,
    completed_at: data.completedAt || null,
    extra,
    updated_at: data.updatedAt || new Date().toISOString(),
  };
}

function conflictFromRow(row: any): Record<string, any> {
  return {
    ...(row.extra || {}),
    id: row.id,
    contactId: row.contact_id || "",
    workerName: row.worker_name || "",
    field: row.field || "",
    existingValue: row.existing_value || "",
    incomingValue: row.incoming_value || "",
    status: row.status || "pending",
    sheetType: row.sheet_type || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function conflictToRow(data: Record<string, any>, id: string): Record<string, any> {
  return {
    id,
    contact_id: nullableText(data.contactId),
    worker_name: data.workerName || "",
    field: data.field || "",
    existing_value: data.existingValue || "",
    incoming_value: data.incomingValue || "",
    status: data.status || "pending",
    sheet_type: data.sheetType || "",
    extra: {},
    updated_at: data.updatedAt || new Date().toISOString(),
  };
}

function neverRuleFromRow(row: any): Record<string, any> {
  return {
    id: row.id,
    contactId: row.contact_id || "",
    field: row.field || "",
    rule: row.rule || "NEVER",
    createdAt: row.created_at,
  };
}

function neverRuleToRow(data: Record<string, any>, id: string): Record<string, any> {
  return {
    id,
    contact_id: nullableText(data.contactId),
    field: data.field || "",
    rule: data.rule || "NEVER",
  };
}

function templateFromRow(row: any): Record<string, any> {
  return {
    id: row.id,
    title: row.title,
    content: row.content,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function templateToRow(data: Record<string, any>, id: string): Record<string, any> {
  return {
    id,
    title: data.title || "",
    content: data.content || "",
    updated_at: data.updatedAt || new Date().toISOString(),
  };
}

function splitLabels(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map(String).map((label) => label.trim()).filter(Boolean);
  }

  return String(value || "")
    .split(",")
    .map((label) => label.trim())
    .filter(Boolean);
}

function parseInteger(value: unknown): number {
  const parsed = parseInt(String(value || "0"), 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function nullableText(value: unknown): string | null {
  const text = String(value || "").trim();
  return text || null;
}

function cleanEmailValue(value: unknown): string {
  return String(value || "")
    .replace(/\s*\(preferred\)\s*/gi, "")
    .trim();
}

function parseConflictJson(value: unknown): Record<string, any> | null {
  try {
    const parsed = JSON.parse(String(value || ""));
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function chunks<T>(values: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < values.length; i += size) {
    result.push(values.slice(i, i + size));
  }
  return result;
}

function uniqueValues(values: unknown[]): string[] {
  return Array.from(new Set(values.map((value) => String(value || "").trim()).filter(Boolean)));
}

function encodePostgrestValue(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function handleValidatePhone(url: URL): Response {
  try {
    const number = url.searchParams.get("number");

    if (!number) {
      return json({ error: "Phone number is required" }, 400);
    }

    const cleanNumber = number.trim();
    const phone = parsePhoneNumberFromString(cleanNumber, "US");

    if (!phone) {
      return json({ isValid: false, type: "UNKNOWN", isLandline: false });
    }

    const isValid = phone.isValid();
    const type = phone.getType();

    return json({
      isValid,
      type,
      isLandline: type === "FIXED_LINE",
      formatted: phone.formatNational(),
    });
  } catch (error: any) {
    return json({ error: error?.message || "Failed to validate phone number." }, 500);
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: jsonHeaders,
  });
}
