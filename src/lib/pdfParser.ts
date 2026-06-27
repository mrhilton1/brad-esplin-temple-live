import * as pdfjs from "pdfjs-dist";
import pdfWorker from "pdfjs-dist/build/pdf.worker.mjs?url";
import { ExtractedTableData } from "../types";

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorker;

type Preset = "crm_contacts" | "worker_history" | "event_schedule" | string;

type TextItem = {
  text: string;
  x: number;
  y: number;
};

export async function parsePdfLocally(pdfData: string, preset: Preset): Promise<ExtractedTableData> {
  const bytes = base64ToBytes(pdfData);
  const document = await pdfjs.getDocument({ data: bytes }).promise;
  const lines: string[] = [];

  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    const items = content.items
      .map((item: any): TextItem => ({
        text: String(item.str || "").trim(),
        x: item.transform?.[4] || 0,
        y: item.transform?.[5] || 0,
      }))
      .filter((item) => item.text);

    lines.push(...itemsToLines(items));
  }

  const cleanLines = lines
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .filter((line) => !isDocumentNoise(line));

  if (preset === "event_schedule") {
    return parseEventSchedule(cleanLines);
  }

  if (preset === "worker_history") {
    return parseWorkerHistory(cleanLines);
  }

  return parseCrmContacts(cleanLines);
}

function parseCrmContacts(lines: string[]): ExtractedTableData {
  const columns = ["Worker Name", "Household Phone", "Personal Phone", "Email", "Labels", "Preferred Phone Type"];
  const rows = lines
    .filter((line) => !looksLikeHeader(line, ["worker", "household", "personal", "email"]))
    .map((line) => {
      const email = line.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] || "";
      const phones = Array.from(line.matchAll(/(?:\+?1[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}/g)).map((match) => match[0]);
      let name = line;
      if (email) name = name.replace(email, " ");
      for (const phone of phones) name = name.replace(phone, " ");
      name = name.replace(/\b(textable|csg|lsg|personal|household|preferred)\b/gi, " ").replace(/\s+/g, " ").trim();

      if (!name || name.length < 2 || /^\d/.test(name)) return null;

      const labels: string[] = [];
      if (/textable/i.test(line)) labels.push("Textable");
      if (/\bcsg\b/i.test(line)) labels.push("CSG");
      if (/\blsg\b/i.test(line)) labels.push("LSG");

      const preferred = /household/i.test(line)
        ? "Household"
        : /personal|cell|mobile/i.test(line)
          ? "Personal"
          : phones[1]
            ? "Personal"
            : phones[0]
              ? "Household"
              : "";

      return [
        name,
        phones[0] || "",
        phones[1] || "",
        email,
        labels.join(", "),
        preferred,
      ];
    })
    .filter((row): row is string[] => !!row);

  return {
    title: "CRM Contacts",
    columns,
    rows: dedupeRows(rows),
    summary: "Contacts extracted locally from selectable PDF text.",
  };
}

function parseWorkerHistory(lines: string[]): ExtractedTableData {
  const columns = ["Worker Name", "Date Last Served - CSG", "Date Last Served - LSG", "Total Times Served - CSG", "Total Times Served - LSG"];
  const rows = lines
    .filter((line) => !looksLikeHeader(line, ["worker", "served", "total"]))
    .map((line) => {
      const dates = Array.from(line.matchAll(/\b(?:\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{4}-\d{2}-\d{2}|\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4})\b/g)).map((match) => match[0]);
      const numbers = Array.from(line.matchAll(/\b\d+\b/g)).map((match) => match[0]).filter((value) => !dates.some((date) => date.includes(value)));
      let name = line;
      for (const date of dates) name = name.replace(date, " ");
      for (const number of numbers.slice(-2)) name = name.replace(new RegExp(`\\b${escapeRegExp(number)}\\b`), " ");
      name = name.replace(/\b(csg|lsg|total|served|last|times|date)\b/gi, " ").replace(/\s+/g, " ").trim();

      if (!name || name.length < 2 || /^\d/.test(name)) return null;

      return [
        name,
        dates[0] || "",
        dates[1] || "",
        numbers[numbers.length - 2] || "",
        numbers[numbers.length - 1] || "",
      ];
    })
    .filter((row): row is string[] => !!row);

  return {
    title: "Worker Activity History",
    columns,
    rows: dedupeRows(rows),
    summary: "Worker history extracted locally from selectable PDF text.",
  };
}

function parseEventSchedule(lines: string[]): ExtractedTableData {
  const columns = ["Date of event", "Time of event", "Room of event", "Type of event", "Names of the guests"];
  const rows: string[][] = [];
  let currentDate = "";

  for (const line of lines) {
    const dateHeader = line.match(/\b(?:Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday),?\s+[A-Za-z]+\s+\d{1,2},?\s+\d{4}\b/i)
      || line.match(/\b[A-Za-z]+\s+\d{1,2},?\s+\d{4}\b/i);
    if (dateHeader && !/\b(?:AM|PM)\b/i.test(line)) {
      currentDate = dateHeader[0];
      continue;
    }

    const time = line.match(/\b\d{1,2}:\d{2}\s*(?:AM|PM)\b/i)?.[0] || "";
    if (!time) continue;

    const room = line.match(/\bRoom\s+[A-Z0-9-]+\b/i)?.[0] || "";
    const type = line.match(/\b(?:LICENSED MARRIAGE|SEALING AFTER CIVIL MARRIAGE|CHILD-TO-PARENT SEALING|SEALING)\b/i)?.[0] || "";
    let guests = line.replace(time, " ");
    if (room) guests = guests.replace(room, " ");
    if (type) guests = guests.replace(type, " ");
    guests = guests.replace(/\s+/g, " ").trim();

    rows.push([currentDate, time, room, type, guests]);
  }

  return {
    title: "Ordinance Event Schedule",
    columns,
    rows: dedupeRows(rows),
    summary: "Event schedule extracted locally from selectable PDF text.",
  };
}

function itemsToLines(items: TextItem[]): string[] {
  const sorted = [...items].sort((a, b) => Math.abs(b.y - a.y) > 3 ? b.y - a.y : a.x - b.x);
  const lines: TextItem[][] = [];

  for (const item of sorted) {
    const line = lines.find((candidate) => Math.abs(candidate[0].y - item.y) <= 3);
    if (line) {
      line.push(item);
    } else {
      lines.push([item]);
    }
  }

  return lines.map((line) => line.sort((a, b) => a.x - b.x).map((item) => item.text).join(" "));
}

function base64ToBytes(pdfData: string): Uint8Array {
  const base64 = pdfData.replace(/^data:application\/pdf;base64,/, "");
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function isDocumentNoise(line: string): boolean {
  return /^(page \d+|run date|copyright|http|www\.|generated|report)$/i.test(line);
}

function looksLikeHeader(line: string, words: string[]): boolean {
  const lower = line.toLowerCase();
  return words.filter((word) => lower.includes(word)).length >= Math.min(2, words.length);
}

function dedupeRows(rows: string[][]): string[][] {
  const seen = new Set<string>();
  return rows.filter((row) => {
    const key = row.join("|").toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
