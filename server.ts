import express from "express";
import path from "path";
import dotenv from "dotenv";
import fs from "fs";
import { initializeApp } from "firebase/app";
import { getFirestore, doc, getDoc, updateDoc, serverTimestamp } from "firebase/firestore";
import { GoogleGenAI, Type } from "@google/genai";
import { createServer as createViteServer } from "vite";
import { parsePhoneNumberFromString } from "libphonenumber-js/max";

dotenv.config();

const app = express();
const PORT = 3000;

// Set up large limits for base64 encoded PDF uploads
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

// Read firebase-applet-config.json and initialize Firestore for backend routes
let db: any = null;
try {
  const configPath = path.join(process.cwd(), "firebase-applet-config.json");
  if (fs.existsSync(configPath)) {
    const firebaseConfig = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    const firebaseApp = initializeApp(firebaseConfig);
    db = getFirestore(firebaseApp, firebaseConfig.firestoreDatabaseId || "(default)");
    console.log("Firebase initialized successfully on the server.");
  } else {
    console.warn("firebase-applet-config.json not found on the server.");
  }
} catch (err) {
  console.error("Failed to initialize Firebase on server:", err);
}

// Check for API key and log status (safely, no printing the key itself)
const hasApiKey = !!process.env.GEMINI_API_KEY;
console.log(`Gemini API Key loaded: ${hasApiKey}`);

// Lazy initialize the GenAI client to prevent startup crash if key is missing initially
let aiClient: GoogleGenAI | null = null;
function getAiClient(): GoogleGenAI {
  if (!aiClient) {
    const key = process.env.GEMINI_API_KEY;
    if (!key) {
      throw new Error("GEMINI_API_KEY environment variable is missing. Please configure it in Settings > Secrets.");
    }
    aiClient = new GoogleGenAI({
      apiKey: key,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        },
      },
    });
  }
  return aiClient;
}

// PDF Data Extraction API Route
app.post("/api/extract", async (req, res) => {
  try {
    const { pdfData, customInstruction } = req.body;

    if (!pdfData) {
      return res.status(400).json({ error: "Missing pdfData. Please upload a valid PDF file." });
    }

    // Extract the raw base64 data (strip prefix if present)
    const base64Data = pdfData.replace(/^data:application\/pdf;base64,/, "");

    const ai = getAiClient();

    const systemInstruction = `You are an expert data extraction assistant specializing in document cleaning and structure recovery.
Your absolute goal is to extract only the main columns and tables of information from the provided PDF document.
You MUST ignore all background noise:
- Page headers, titles, branding, and logos.
- Page footers, page numbers, run dates, copyright messages, contact links, and address text in margins.
- Extraneous text blocks, sidebars, or decorative margins.

Strictly focus on the main columns of tabular data or structural list-columns.
Combine any fragmented rows or multi-page table flows into a single unified table structure.
Ensure the extracted column headers are clean and descriptive.`;

    const userPrompt = customInstruction 
      ? `Extract the tabular columns from this PDF document. Pay special attention to this custom rule: "${customInstruction}"`
      : "Extract all columns and rows of tabular data from the PDF document, ignoring headers, footers, margins, and non-table noise.";

    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: [
        {
          inlineData: {
            mimeType: "application/pdf",
            data: base64Data,
          },
        },
        {
          text: userPrompt,
        }
      ],
      config: {
        systemInstruction,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            title: {
              type: Type.STRING,
              description: "A descriptive, concise title for the extracted table or data set."
            },
            columns: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: "The clean column header names extracted from the table columns in the document."
            },
            rows: {
              type: Type.ARRAY,
              items: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: "The cell values for this row, aligned in order with the columns list."
              },
              description: "All rows of tabular data extracted from the document."
            },
            summary: {
              type: Type.STRING,
              description: "A brief 1-2 sentence summary of what this table represents."
            }
          },
          required: ["columns", "rows", "title"]
        }
      }
    });

    const text = response.text;
    if (!text) {
      throw new Error("No response received from the Gemini model.");
    }

    // Parse the JSON returned by Gemini
    const parsedData = JSON.parse(text.trim());
    return res.json(parsedData);

  } catch (error: any) {
    console.error("Extraction error:", error);
    return res.status(500).json({
      error: error.message || "An unexpected error occurred during PDF processing.",
    });
  }
});

// Phone validation API Route
app.get("/api/validate-phone", (req, res) => {
  try {
    const { number } = req.query;
    if (!number || typeof number !== "string") {
      return res.status(400).json({ error: "Phone number is required" });
    }

    const cleanNumber = number.trim();
    // Parse using US as default country fallback
    const phone = parsePhoneNumberFromString(cleanNumber, "US");
    
    if (!phone) {
      return res.json({ isValid: false, type: "UNKNOWN", isLandline: false });
    }

    const isValid = phone.isValid();
    const type = phone.getType(); // e.g., 'FIXED_LINE', 'MOBILE'
    const isLandline = type === "FIXED_LINE";

    return res.json({
      isValid,
      type,
      isLandline,
      formatted: phone.formatNational()
    });
  } catch (error: any) {
    console.error("Phone validation error:", error);
    return res.status(500).json({ error: error.message || "Failed to validate phone number." });
  }
});

// Endpoint to increment LSG and CSG total numbers
app.post("/api/contacts/:id/increment", async (req, res) => {
  try {
    const { id } = req.params;
    const type = (req.body.type || req.query.type || "").toString().toLowerCase();
    const amountStr = req.body.amount || req.query.amount || "1";
    const amount = parseInt(amountStr, 10);

    if (!db) {
      return res.status(500).json({ error: "Firebase is not configured on the server." });
    }
    if (!id) {
      return res.status(400).json({ error: "Contact ID is required." });
    }
    if (isNaN(amount) || amount <= 0) {
      return res.status(400).json({ error: "Invalid increment amount." });
    }

    const contactRef = doc(db, "crm_contacts", id);
    const contactSnap = await getDoc(contactRef);

    if (!contactSnap.exists()) {
      return res.status(404).json({ error: "Contact not found." });
    }

    const currentData = contactSnap.data();
    const updates: Record<string, any> = {
      updatedAt: serverTimestamp()
    };

    if (type === "csg" || type === "both") {
      const currentCsg = parseInt(currentData["Total CSG"] || "0", 10) || 0;
      updates["Total CSG"] = (currentCsg + amount).toString();
    }
    if (type === "lsg" || type === "both") {
      const currentLsg = parseInt(currentData["Total LSG"] || "0", 10) || 0;
      updates["Total LSG"] = (currentLsg + amount).toString();
    }

    if (type !== "csg" && type !== "lsg" && type !== "both") {
      return res.status(400).json({ error: "Invalid type. Must be 'csg', 'lsg', or 'both'." });
    }

    await updateDoc(contactRef, updates);
    return res.json({ success: true, message: `Incremented ${type} by ${amount}`, updates });
  } catch (error: any) {
    console.error("Increment error:", error);
    return res.status(500).json({ error: error.message || "Failed to increment total count." });
  }
});

// Endpoint to update the LSG or CSG date
app.post("/api/contacts/:id/update-date", async (req, res) => {
  try {
    const { id } = req.params;
    const type = (req.body.type || req.query.type || "").toString().toLowerCase();
    const newDateStr = (req.body.date || req.query.date || "").toString().trim();

    if (!db) {
      return res.status(500).json({ error: "Firebase is not configured on the server." });
    }
    if (!id) {
      return res.status(400).json({ error: "Contact ID is required." });
    }
    if (type !== "csg" && type !== "lsg") {
      return res.status(400).json({ error: "Invalid type. Must be 'csg' or 'lsg'." });
    }
    if (!newDateStr) {
      return res.status(400).json({ error: "Date is required." });
    }

    // Parse and validate date
    const parsedDate = new Date(newDateStr);
    if (isNaN(parsedDate.getTime())) {
      return res.status(400).json({ error: "Invalid date format. Please use YYYY-MM-DD or similar valid date string." });
    }

    const contactRef = doc(db, "crm_contacts", id);
    const contactSnap = await getDoc(contactRef);

    if (!contactSnap.exists()) {
      return res.status(404).json({ error: "Contact not found." });
    }

    const currentData = contactSnap.data();
    const dateField = type === "csg" ? "Last CSG" : "Last LSG";
    const existingDateStr = currentData[dateField] || "";

    // Always allow pushing a future date / newer date
    let shouldUpdate = false;
    if (!existingDateStr) {
      shouldUpdate = true;
    } else {
      const existingTime = new Date(existingDateStr).getTime();
      const newTime = parsedDate.getTime();
      if (!isNaN(existingTime) && newTime > existingTime) {
        shouldUpdate = true;
      }
    }

    const updates: Record<string, any> = {
      updatedAt: serverTimestamp()
    };

    if (shouldUpdate) {
      updates[dateField] = newDateStr;

      // Also add label (e.g. "CSG" or "LSG") if not present
      const labelToAdd = type.toUpperCase(); // "CSG" or "LSG"
      const existingLabels = currentData["Labels"] || "";
      const labelsList = existingLabels.split(",").map((s: string) => s.trim()).filter(Boolean);
      if (!labelsList.some((l: string) => l.toLowerCase() === labelToAdd.toLowerCase())) {
        labelsList.push(labelToAdd);
        updates["Labels"] = labelsList.join(", ");
      }

      await updateDoc(contactRef, updates);
      return res.json({ 
        success: true, 
        updated: true, 
        message: `Updated ${dateField} date to ${newDateStr} and ensured label is applied.`, 
        updates 
      });
    } else {
      return res.json({ 
        success: true, 
        updated: false, 
        message: `Date was not updated because ${newDateStr} is not newer than existing date (${existingDateStr}).` 
      });
    }
  } catch (error: any) {
    console.error("Update date error:", error);
    return res.status(500).json({ error: error.message || "Failed to update date." });
  }
});

// Setup Vite Dev Server / Static Files Serving
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    console.log("Starting server in development mode with Vite middleware...");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    console.log("Starting server in production mode serving static dist files...");
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
