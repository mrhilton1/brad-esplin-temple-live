import { GoogleGenAI, Type } from "@google/genai";
import { parsePhoneNumberFromString } from "libphonenumber-js/max";

interface Env {
  ASSETS: {
    fetch(request: Request): Promise<Response>;
  };
  GEMINI_API_KEY?: string;
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
}

const jsonHeaders = {
  "Content-Type": "application/json",
};

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

    if (request.method === "OPTIONS" && url.pathname.startsWith("/api/")) {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        },
      });
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

      return handleApplyAllConflicts(env);
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
  },
};

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
      await supabaseDelete(env, config.table, id);
      return json({ ok: true });
    }

    return json({ error: "Method not allowed" }, 405);
  } catch (error: any) {
    return json({ error: error?.message || "Database request failed." }, 500);
  }
}

async function handleApplyAllConflicts(env: Env): Promise<Response> {
  try {
    const pendingRows = await supabaseRequest(
      env,
      collections.crm_sync_conflicts.table,
      "?status=eq.pending&select=*",
    );

    const pendingConflicts = pendingRows.map(conflictFromRow);
    const now = new Date().toISOString();
    const presenceConflicts = pendingConflicts.filter((conflict: any) => conflict.field === "Presence");
    const fieldConflicts = pendingConflicts.filter((conflict: any) => conflict.field !== "Presence");

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
    });
  } catch (error: any) {
    return json({ error: error?.message || "Failed to apply all pending conflicts." }, 500);
  }
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
