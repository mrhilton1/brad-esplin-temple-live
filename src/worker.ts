import { GoogleGenAI, Type } from "@google/genai";
import { parsePhoneNumberFromString } from "libphonenumber-js/max";

interface Env {
  ASSETS: {
    fetch(request: Request): Promise<Response>;
  };
  GEMINI_API_KEY?: string;
}

const jsonHeaders = {
  "Content-Type": "application/json",
};

const systemInstruction = `You are an expert data extraction assistant specializing in document cleaning and structure recovery.
Your absolute goal is to extract only the main columns and tables of information from the provided PDF document.
You MUST ignore all background noise:
- Page headers, titles, branding, and logos.
- Page footers, page numbers, run dates, copyright messages, contact links, and address text in margins.
- Extraneous text blocks, sidebars, or decorative margins.

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

    return env.ASSETS.fetch(request);
  },
};

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
    const userPrompt = customInstruction
      ? `Extract the tabular columns from this PDF document. Pay special attention to this custom rule: "${customInstruction}"`
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
    return json({
      error: error?.message || "An unexpected error occurred during PDF processing.",
    }, 500);
  }
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
