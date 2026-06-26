import React, { useState } from "react";
import { 
  Download, Edit2, Check, Trash2, Plus, Search, HelpCircle, 
  Settings, Columns, RefreshCw, FileDown, CheckCircle2, Database
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { ExtractedTableData } from "../types";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { doc, setDoc, getDoc, getDocs, collection, serverTimestamp } from "firebase/firestore";
import { db } from "../lib/firebase";

// Helper to convert dynamic date to YYYY-MM-DD for date input
const formatDateForInput = (dateStr: string): string => {
  if (!dateStr) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) {
    // Try custom parsing for "D Month YYYY" or "D MMM YYYY"
    const match = dateStr.trim().match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/);
    if (match) {
      const [_, day, monthStr, year] = match;
      const monthNames = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
      const fullMonthNames = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
      let mIdx = monthNames.indexOf(monthStr.toLowerCase().slice(0, 3));
      if (mIdx === -1) {
        mIdx = fullMonthNames.indexOf(monthStr.toLowerCase());
      }
      if (mIdx !== -1) {
        const mm = String(mIdx + 1).padStart(2, '0');
        const dd = String(parseInt(day)).padStart(2, '0');
        return `${year}-${mm}-${dd}`;
      }
    }
    return "";
  }
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};

// Helper to convert YYYY-MM-DD from date input back to "D Month YYYY" format (e.g., "9 May 2026")
const formatDateForDb = (dateStr: string): string => {
  if (!dateStr) return "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return dateStr;
  }
  const d = new Date(dateStr + "T00:00:00"); // avoid timezone shifting
  if (isNaN(d.getTime())) return dateStr;
  const day = d.getDate();
  const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const month = months[d.getMonth()];
  const year = d.getFullYear();
  return `${day} ${month} ${year}`;
};

// Helper to convert dynamic date to YYYY-MM-DD for comparison
const parseDateString = (dateStr: string): Date | null => {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (!isNaN(d.getTime())) return d;
  
  // Custom parsing for formats like "Saturday, August 1, 2026"
  let cleanStr = dateStr.replace(/^(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday),\s*/i, "");
  const d2 = new Date(cleanStr);
  if (!isNaN(d2.getTime())) return d2;

  // Custom parsing for "1 Aug 2026"
  const match = cleanStr.trim().match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/);
  if (match) {
    const [_, day, monthStr, year] = match;
    const monthNames = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
    const fullMonthNames = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
    let mIdx = monthNames.indexOf(monthStr.toLowerCase().slice(0, 3));
    if (mIdx === -1) {
      mIdx = fullMonthNames.indexOf(monthStr.toLowerCase());
    }
    if (mIdx !== -1) {
      return new Date(parseInt(year), mIdx, parseInt(day));
    }
  }
  return null;
};

// Check if event date is in the past compared to system date 2026-06-25 (or current date if later)
const isDateInPast = (dateStr: string): boolean => {
  const d = parseDateString(dateStr);
  if (!d) return false;
  
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  const baseline = new Date("2026-06-25");
  baseline.setHours(0, 0, 0, 0);
  
  const comparisonDate = today > baseline ? today : baseline;
  
  d.setHours(0, 0, 0, 0);
  return d < comparisonDate;
};

interface TablePreviewProps {
  data: ExtractedTableData;
  onDataUpdated: (newData: ExtractedTableData) => void;
  onReset: () => void;
  sheetPreset: string;
}

export default function TablePreview({ data, onDataUpdated, onReset, sheetPreset }: TablePreviewProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [editingCell, setEditingCell] = useState<{ rIndex: number; cIndex: number } | null>(null);
  const [editingHeader, setEditingHeader] = useState<number | null>(null);
  const [tempValue, setTempValue] = useState("");
  
  // PDF Styling configuration state
  const [pdfTheme, setPdfTheme] = useState<"navy" | "charcoal" | "emerald" | "amber" | "slate">("navy");
  const [pdfDensity, setPdfDensity] = useState<"compact" | "normal" | "spacious">("normal");
  const [pageOrientation, setPageOrientation] = useState<"p" | "l">("p");
  const [includeSummary, setIncludeSummary] = useState(true);
  const [includeTitle, setIncludeTitle] = useState(true);

  const { title, columns, rows, summary } = data;

  const [isSavingDb, setIsSavingDb] = useState(false);
  const [saveStatus, setSaveStatus] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const handleSaveToDatabase = async () => {
    setIsSavingDb(true);
    setSaveStatus(null);

    try {
      // 1. Fetch current crm_never_rules from Firestore
      const neverRulesSnapshot = await getDocs(collection(db, "crm_never_rules"));
      const neverRules = neverRulesSnapshot.docs.map(docSnap => docSnap.data());
      
      // Helper to check if a rule says never to overwrite a contact/field
      const isNeverRule = (contactId: string, fieldName: string) => {
        return neverRules.some(rule => 
          rule.contactId === contactId && 
          (rule.field === "ALL" || rule.field === fieldName)
        );
      };

      // 2. Fetch existing crm_contacts
      const contactsSnapshot = await getDocs(collection(db, "crm_contacts"));
      const existingContacts: Record<string, any> = {};
      contactsSnapshot.forEach(docSnap => {
        existingContacts[docSnap.id] = { id: docSnap.id, ...docSnap.data() };
      });

      // Fetch existing events if template is event_schedule
      const existingEvents: Record<string, any> = {};
      if (sheetPreset === "event_schedule") {
        const eventsSnapshot = await getDocs(collection(db, "events"));
        eventsSnapshot.forEach(docSnap => {
          existingEvents[docSnap.id] = { id: docSnap.id, ...docSnap.data() };
        });
      }

      // 3. Find column indices in columns array with smart multi-criteria matching
      const getColumnIndexSmart = (includeAll: string[], includeAny?: string[], excludeAny?: string[]) => {
        return columns.findIndex(col => {
          const c = col.toLowerCase().trim();
          // Check if all in includeAll are present
          const hasAll = includeAll.every(kw => c.includes(kw.toLowerCase()));
          if (!hasAll) return false;
          // Check if at least one in includeAny is present (if specified)
          if (includeAny && includeAny.length > 0) {
            const hasAny = includeAny.some(kw => c.includes(kw.toLowerCase()));
            if (!hasAny) return false;
          }
          // Check if any in excludeAny are present (if specified)
          if (excludeAny && excludeAny.length > 0) {
            const hasExclude = excludeAny.some(kw => c.includes(kw.toLowerCase()));
            if (hasExclude) return false;
          }
          return true;
        });
      };

      const workerNameColIdx = getColumnIndexSmart(["worker"]) !== -1 ? getColumnIndexSmart(["worker"]) : getColumnIndexSmart(["name"]);
      const householdPhoneColIdx = getColumnIndexSmart(["household"]);
      const personalPhoneColIdx = getColumnIndexSmart(["personal"]);
      const emailColIdx = getColumnIndexSmart(["email"]);
      const labelsColIdx = getColumnIndexSmart(["label"]) !== -1 ? getColumnIndexSmart(["label"]) : getColumnIndexSmart(["tag"]);
      const preferredPhoneColIdx = getColumnIndexSmart(["preferred"]);

      // History columns (Smarter matching for CSG / LSG dates & totals)
      const csgDateColIdx = getColumnIndexSmart(["csg"], ["date", "served", "last", "log"], ["total", "times", "count"]);
      const lsgDateColIdx = getColumnIndexSmart(["lsg"], ["date", "served", "last", "log"], ["total", "times", "count"]);
      const csgTotalColIdx = getColumnIndexSmart(["csg"], ["total", "times", "count", "number"]);
      const lsgTotalColIdx = getColumnIndexSmart(["lsg"], ["total", "times", "count", "number"]);

      console.log("Column Mapping Info:", {
        workerNameColIdx,
        householdPhoneColIdx,
        personalPhoneColIdx,
        emailColIdx,
        labelsColIdx,
        preferredPhoneColIdx,
        csgDateColIdx,
        lsgDateColIdx,
        csgTotalColIdx,
        lsgTotalColIdx
      });

      let savedCount = 0;
      let conflictsCount = 0;
      let appliedCount = 0;
      const allIncomingDocIds = new Set<string>();

      // Iterate and compare each row
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        if (row.every(cell => !cell)) continue; // skip empty rows

        if (sheetPreset === "event_schedule") {
          const dateIdx = columns.findIndex(col => col.toLowerCase().includes("date"));
          const timeIdx = columns.findIndex(col => col.toLowerCase().includes("time"));
          const roomIdx = columns.findIndex(col => col.toLowerCase().includes("room"));
          const typeIdx = columns.findIndex(col => col.toLowerCase().includes("type"));
          const guestsIdx = columns.findIndex(col => col.toLowerCase().includes("guest") || col.toLowerCase().includes("names"));

          const dateVal = dateIdx !== -1 ? (row[dateIdx] || "").trim() : "";
          const timeVal = timeIdx !== -1 ? (row[timeIdx] || "").trim() : "";
          const roomVal = roomIdx !== -1 ? (row[roomIdx] || "").trim() : "";
          const typeVal = typeIdx !== -1 ? (row[typeIdx] || "").trim() : "";
          const guestsVal = guestsIdx !== -1 ? (row[guestsIdx] || "").trim() : "";

          if (!guestsVal) continue;

          const eventId = "event_" + guestsVal.replace(/[^a-zA-Z0-9]/g, "_").toLowerCase();
          allIncomingDocIds.add(eventId);

          const existingEvent = existingEvents[eventId];
          const eventRef = doc(db, "events", eventId);

          if (!existingEvent) {
            await setDoc(eventRef, {
              id: eventId,
              date: dateVal,
              time: timeVal,
              room: roomVal,
              type: typeVal,
              guests: guestsVal,
              assignedLsgId: "",
              assignedGroomLsgId: "",
              assignedCsgId: "",
              status: "unassigned",
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp()
            });
            savedCount++;
          } else {
            const isChanged = 
              (existingEvent.date !== dateVal) || 
              (existingEvent.time !== timeVal) || 
              (existingEvent.room !== roomVal) || 
              (existingEvent.type !== typeVal);

            if (isChanged) {
              await setDoc(eventRef, {
                date: dateVal,
                time: timeVal,
                room: roomVal,
                type: typeVal,
                status: "changed",
                updatedAt: serverTimestamp()
              }, { merge: true });
              savedCount++;
            } else if (existingEvent.status === "deleted") {
              const restoredStatus = existingEvent.assignedLsgId ? "assigned" : "unassigned";
              await setDoc(eventRef, {
                status: restoredStatus,
                updatedAt: serverTimestamp()
              }, { merge: true });
              savedCount++;
            }
          }
          continue;
        }

        let workerName = "";
        if (workerNameColIdx !== -1 && row[workerNameColIdx]) {
          workerName = row[workerNameColIdx].trim();
        }

        if (!workerName) continue;

        // Create docId key slug
        const docId = workerName.replace(/[^a-zA-Z0-9]/g, "_").toLowerCase();
        allIncomingDocIds.add(docId);

        // Check global never rule for this worker
        if (isNeverRule(docId, "ALL")) {
          console.log(`Skipping contact ${workerName} due to global NEVER rule.`);
          continue;
        }

        const existingData = existingContacts[docId] || null;
        const docRef = doc(db, "crm_contacts", docId);

        // A. NEW CONTACT CASE
        if (!existingData) {
          // If we are saving a new contact
          const contactData: Record<string, any> = {
            "Worker Name": workerName,
            updatedAt: serverTimestamp()
          };

          if (sheetPreset === "crm_contacts") {
            contactData["Household Phone"] = householdPhoneColIdx !== -1 ? (row[householdPhoneColIdx] || "").trim() : "";
            contactData["Personal Phone"] = personalPhoneColIdx !== -1 ? (row[personalPhoneColIdx] || "").trim() : "";
            contactData["Email"] = emailColIdx !== -1 ? (row[emailColIdx] || "").trim() : "";
            
            let prefVal = preferredPhoneColIdx !== -1 ? (row[preferredPhoneColIdx] || "").trim() : "";
            if (!prefVal && (contactData["Personal Phone"] || contactData["Household Phone"])) {
              prefVal = contactData["Personal Phone"] ? "Personal" : "Household";
            }
            contactData["Preferred Phone Type"] = prefVal;

            let labelsList: string[] = [];
            if (labelsColIdx !== -1 && row[labelsColIdx]) {
              labelsList = row[labelsColIdx].split(",").map((s: string) => s.trim()).filter(Boolean);
            }
            contactData["Labels"] = labelsList.join(", ");
          } else {
            // worker history
            contactData["Last CSG"] = csgDateColIdx !== -1 ? (row[csgDateColIdx] || "").trim() : "";
            contactData["Last LSG"] = lsgDateColIdx !== -1 ? (row[lsgDateColIdx] || "").trim() : "";
            contactData["Total CSG"] = csgTotalColIdx !== -1 ? (row[csgTotalColIdx] || "").trim() : "";
            contactData["Total LSG"] = lsgTotalColIdx !== -1 ? (row[lsgTotalColIdx] || "").trim() : "";

            const labelsList: string[] = [];
            if (contactData["Last CSG"]) labelsList.push("CSG");
            if (contactData["Last LSG"]) labelsList.push("LSG");
            contactData["Labels"] = labelsList.join(", ");
          }

          // Save new contact
          await setDoc(docRef, contactData);
          savedCount++;

          // Log added contact in conflicts / history log
          const logId = `log_add_${docId}`;
          await setDoc(doc(db, "crm_sync_conflicts", logId), {
            id: logId,
            contactId: docId,
            workerName,
            field: "Presence",
            existingValue: "(None - Not in CRM)",
            incomingValue: `Created New Contact from ${sheetPreset === "crm_contacts" ? "Worker Search" : "History Report"}`,
            status: "applied",
            sheetType: sheetPreset,
            updatedAt: serverTimestamp()
          });

          continue;
        }

        // B. EXISTING CONTACT CASE (SMART INTEGRATION/COMPARE)
        if (sheetPreset === "crm_contacts") {
          // Compare contact info fields
          const fieldsToCompare = [
            { key: "Household Phone", idx: householdPhoneColIdx },
            { key: "Personal Phone", idx: personalPhoneColIdx },
            { key: "Email", idx: emailColIdx },
            { key: "Preferred Phone Type", idx: preferredPhoneColIdx }
          ];

          let rowHasChanges = false;

          for (const f of fieldsToCompare) {
            if (f.idx === -1) continue;
            let incomingVal = (row[f.idx] || "").trim();
            const existingVal = (existingData[f.key] || "").trim();

            if (f.key === "Preferred Phone Type" && !incomingVal && (row[personalPhoneColIdx] || row[householdPhoneColIdx])) {
              // deduce fallback preference if undefined
              incomingVal = row[personalPhoneColIdx] ? "Personal" : "Household";
            }

            if (incomingVal && incomingVal !== existingVal) {
              rowHasChanges = true;
              // Check if a never rule exists for this field
              if (isNeverRule(docId, f.key)) {
                console.log(`Skipping overwrite for ${workerName} - ${f.key} due to NEVER rule.`);
                continue;
              }

              // Create conflict
              const conflictId = `conflict_${docId}_${f.key.toLowerCase().replace(/\s+/g, "_")}`;
              await setDoc(doc(db, "crm_sync_conflicts", conflictId), {
                id: conflictId,
                contactId: docId,
                workerName,
                field: f.key,
                existingValue: existingVal,
                incomingValue: incomingVal,
                status: "pending",
                sheetType: "worker_search_results",
                updatedAt: serverTimestamp()
              });
              conflictsCount++;
            }
          }

          // Labels merge comparison
          if (labelsColIdx !== -1 && row[labelsColIdx]) {
            const incomingLabels = row[labelsColIdx].split(",").map((s: string) => s.trim()).filter(Boolean);
            const existingLabels = (existingData["Labels"] || "").split(",").map((s: string) => s.trim()).filter(Boolean);
            
            const newLabels = incomingLabels.filter(label => 
              !existingLabels.some(l => l.toLowerCase() === label.toLowerCase())
            );

            if (newLabels.length > 0) {
              rowHasChanges = true;
              if (!isNeverRule(docId, "Labels")) {
                const conflictId = `conflict_${docId}_labels`;
                await setDoc(doc(db, "crm_sync_conflicts", conflictId), {
                  id: conflictId,
                  contactId: docId,
                  workerName,
                  field: "Labels",
                  existingValue: existingData["Labels"] || "",
                  incomingValue: [...existingLabels, ...newLabels].join(", "),
                  status: "pending",
                  sheetType: "worker_search_results",
                  updatedAt: serverTimestamp()
                });
                conflictsCount++;
              }
            }
          }

          if (rowHasChanges) {
            savedCount++;
          }

        } else if (sheetPreset === "worker_history") {
          // Compare dates & totals and write immediately if newer, keeping manual edits safe
          const updatesToApply: Record<string, any> = {};
          let historyChanged = false;

          // Last CSG
          const incomingCsgDate = csgDateColIdx !== -1 ? (row[csgDateColIdx] || "").trim() : "";
          const existingCsgDate = existingData["Last CSG"] || "";
          let updateCsgDate = false;

          if (incomingCsgDate) {
            if (!existingCsgDate) {
              updateCsgDate = true;
            } else {
              const existingTime = new Date(existingCsgDate).getTime();
              const newTime = new Date(incomingCsgDate).getTime();
              if (!isNaN(newTime) && (isNaN(existingTime) || newTime > existingTime)) {
                updateCsgDate = true;
              }
            }
          }

          if (updateCsgDate) {
            updatesToApply["Last CSG"] = incomingCsgDate;
            historyChanged = true;
            
            // Log this auto-apply
            const logId = `log_${docId}_last_csg_${Date.now()}`;
            await setDoc(doc(db, "crm_sync_conflicts", logId), {
              id: logId,
              contactId: docId,
              workerName,
              field: "Last CSG",
              existingValue: existingCsgDate,
              incomingValue: incomingCsgDate,
              status: "applied",
              sheetType: "worker_history_report",
              updatedAt: serverTimestamp()
            });
            appliedCount++;
          }

          // Last LSG
          const incomingLsgDate = lsgDateColIdx !== -1 ? (row[lsgDateColIdx] || "").trim() : "";
          const existingLsgDate = existingData["Last LSG"] || "";
          let updateLsgDate = false;

          if (incomingLsgDate) {
            if (!existingLsgDate) {
              updateLsgDate = true;
            } else {
              const existingTime = new Date(existingLsgDate).getTime();
              const newTime = new Date(incomingLsgDate).getTime();
              if (!isNaN(newTime) && (isNaN(existingTime) || newTime > existingTime)) {
                updateLsgDate = true;
              }
            }
          }

          if (updateLsgDate) {
            updatesToApply["Last LSG"] = incomingLsgDate;
            historyChanged = true;

            const logId = `log_${docId}_last_lsg_${Date.now()}`;
            await setDoc(doc(db, "crm_sync_conflicts", logId), {
              id: logId,
              contactId: docId,
              workerName,
              field: "Last LSG",
              existingValue: existingLsgDate,
              incomingValue: incomingLsgDate,
              status: "applied",
              sheetType: "worker_history_report",
              updatedAt: serverTimestamp()
            });
            appliedCount++;
          }

          // Total CSG
          const incomingCsgTotal = csgTotalColIdx !== -1 ? (row[csgTotalColIdx] || "").trim() : "";
          const existingCsgTotal = existingData["Total CSG"] || "";
          if (incomingCsgTotal !== "" && incomingCsgTotal !== existingCsgTotal) {
            updatesToApply["Total CSG"] = incomingCsgTotal;
            historyChanged = true;

            const logId = `log_${docId}_total_csg_${Date.now()}`;
            await setDoc(doc(db, "crm_sync_conflicts", logId), {
              id: logId,
              contactId: docId,
              workerName,
              field: "Total CSG",
              existingValue: existingCsgTotal,
              incomingValue: incomingCsgTotal,
              status: "applied",
              sheetType: "worker_history_report",
              updatedAt: serverTimestamp()
            });
            appliedCount++;
          }

          // Total LSG
          const incomingLsgTotal = lsgTotalColIdx !== -1 ? (row[lsgTotalColIdx] || "").trim() : "";
          const existingLsgTotal = existingData["Total LSG"] || "";
          if (incomingLsgTotal !== "" && incomingLsgTotal !== existingLsgTotal) {
            updatesToApply["Total LSG"] = incomingLsgTotal;
            historyChanged = true;

            const logId = `log_${docId}_total_lsg_${Date.now()}`;
            await setDoc(doc(db, "crm_sync_conflicts", logId), {
              id: logId,
              contactId: docId,
              workerName,
              field: "Total LSG",
              existingValue: existingLsgTotal,
              incomingValue: incomingLsgTotal,
              status: "applied",
              sheetType: "worker_history_report",
              updatedAt: serverTimestamp()
            });
            appliedCount++;
          }

          // Add CSG/LSG Labels if needed (robust detection on either date or non-zero counts)
          const currentLabels = (existingData["Labels"] || "").split(",").map((s: string) => s.trim()).filter(Boolean);
          let labelListChanged = false;

          const hasCsgActivity = updatesToApply["Last CSG"] || existingCsgDate || (updatesToApply["Total CSG"] && updatesToApply["Total CSG"] !== "0") || (existingCsgTotal && existingCsgTotal !== "0");
          if (hasCsgActivity && !currentLabels.some(l => l.toLowerCase() === "csg")) {
            currentLabels.push("CSG");
            labelListChanged = true;
          }

          const hasLsgActivity = updatesToApply["Last LSG"] || existingLsgDate || (updatesToApply["Total LSG"] && updatesToApply["Total LSG"] !== "0") || (existingLsgTotal && existingLsgTotal !== "0");
          if (hasLsgActivity && !currentLabels.some(l => l.toLowerCase() === "lsg")) {
            currentLabels.push("LSG");
            labelListChanged = true;
          }

          if (labelListChanged) {
            updatesToApply["Labels"] = currentLabels.join(", ");
            historyChanged = true;
          }

          if (historyChanged) {
            updatesToApply["updatedAt"] = serverTimestamp();
            await setDoc(docRef, updatesToApply, { merge: true });
            savedCount++;
          }
        }
      }

      // 5. MISSING VOLUNTEER & EVENTS DETECTION
      if (sheetPreset === "crm_contacts") {
        for (const id in existingContacts) {
          if (!allIncomingDocIds.has(id)) {
            // Check if there's a never rule for this missing check
            if (isNeverRule(id, "Presence")) continue;

            const conflictId = `conflict_${id}_presence`;
            await setDoc(doc(db, "crm_sync_conflicts", conflictId), {
              id: conflictId,
              contactId: id,
              workerName: existingContacts[id]["Worker Name"] || id,
              field: "Presence",
              existingValue: "Active in CRM",
              incomingValue: "Missing from uploaded Worker Search Results (may no longer be a volunteer)",
              status: "pending",
              sheetType: "worker_search_results",
              updatedAt: serverTimestamp()
            });
            conflictsCount++;
          }
        }
      } else if (sheetPreset === "event_schedule") {
        for (const id in existingEvents) {
          if (!allIncomingDocIds.has(id)) {
            const eventObj = existingEvents[id];
            const isPast = isDateInPast(eventObj.date);
            if (!isPast && eventObj.status !== "deleted") {
              // Mark upcoming missing events as deleted (Red indicator)
              await setDoc(doc(db, "events", id), {
                status: "deleted",
                updatedAt: serverTimestamp()
              }, { merge: true });
              conflictsCount++;
            }
          }
        }
      }

      // Render success message
      let statusMsg = "";
      if (sheetPreset === "crm_contacts") {
        statusMsg = `Successfully processed uploaded sheet. Added new contacts. Identified ${conflictsCount} differences or missing volunteers. Please review these decisions in the "Review Center" tab!`;
      } else if (sheetPreset === "worker_history") {
        statusMsg = `Worker History Report analyzed! Saved new contacts. Automatically applied ${appliedCount} newer served dates or totals, and generated activity logs. Review logs in the "Review Center" tab!`;
      } else if (sheetPreset === "event_schedule") {
        statusMsg = `Successfully imported daily schedule of ordinances! Synchronized all event details. Identified and flagged ${conflictsCount} upcoming events as cancelled/deleted. You can coordinate assignments in the "Event Matcher" tab!`;
      }

      setSaveStatus({
        type: "success",
        message: statusMsg
      });

      setTimeout(() => {
        setSaveStatus(null);
      }, 8000);

    } catch (err: any) {
      console.error("Error saving to Firestore:", err);
      setSaveStatus({
        type: "error",
        message: "Failed to store records: " + (err.message || "Unknown error")
      });
    } finally {
      setIsSavingDb(false);
    }
  };


  // Handle cell edit save
  const saveCellEdit = () => {
    if (!editingCell) return;
    const { rIndex, cIndex } = editingCell;
    const updatedRows = [...rows];
    updatedRows[rIndex] = [...updatedRows[rIndex]];
    updatedRows[rIndex][cIndex] = tempValue;
    
    onDataUpdated({
      ...data,
      rows: updatedRows,
    });
    setEditingCell(null);
  };

  // Handle header rename save
  const saveHeaderEdit = () => {
    if (editingHeader === null) return;
    const updatedColumns = [...columns];
    updatedColumns[editingHeader] = tempValue;

    onDataUpdated({
      ...data,
      columns: updatedColumns,
    });
    setEditingHeader(null);
  };

  // Keyboard controls for edits
  const handleKeyDown = (e: React.KeyboardEvent, type: "cell" | "header") => {
    if (e.key === "Enter") {
      type === "cell" ? saveCellEdit() : saveHeaderEdit();
    } else if (e.key === "Escape") {
      setEditingCell(null);
      setEditingHeader(null);
    }
  };

  // Delete a row
  const deleteRow = (indexToDelete: number) => {
    const updatedRows = rows.filter((_, idx) => idx !== indexToDelete);
    onDataUpdated({
      ...data,
      rows: updatedRows,
    });
  };

  // Add a new empty row
  const addNewRow = () => {
    const newRow = Array(columns.length).fill("");
    onDataUpdated({
      ...data,
      rows: [...rows, newRow],
    });
  };

  // Delete a column
  const deleteColumn = (colIndex: number) => {
    if (columns.length <= 1) return; // Prevent deleting the last column
    const updatedColumns = columns.filter((_, idx) => idx !== colIndex);
    const updatedRows = rows.map(row => row.filter((_, idx) => idx !== colIndex));
    onDataUpdated({
      ...data,
      columns: updatedColumns,
      rows: updatedRows,
    });
  };

  // Add an empty column
  const addNewColumn = () => {
    const colName = `New Column ${columns.length + 1}`;
    const updatedColumns = [...columns, colName];
    const updatedRows = rows.map(row => [...row, ""]);
    onDataUpdated({
      ...data,
      columns: updatedColumns,
      rows: updatedRows,
    });
  };

  // Filter rows based on search term
  const filteredRowsWithOriginalIndices = rows
    .map((row, index) => ({ row, originalIndex: index }))
    .filter(({ row }) => 
      searchTerm === "" || 
      row.some(cell => cell.toLowerCase().includes(searchTerm.toLowerCase()))
    );

  // Generate and Download PDF
  const handleDownloadPDF = () => {
    const doc = new jsPDF({
      orientation: pageOrientation,
      unit: "mm",
      format: "a4"
    });

    // Theme color palettes
    const palettes = {
      navy: { primary: [30, 58, 138], secondary: [59, 130, 246], rowAlt: [243, 248, 255] },
      charcoal: { primary: [38, 38, 38], secondary: [115, 115, 115], rowAlt: [250, 250, 250] },
      emerald: { primary: [6, 95, 70], secondary: [16, 185, 129], rowAlt: [240, 253, 250] },
      amber: { primary: [146, 64, 14], secondary: [245, 158, 11], rowAlt: [254, 251, 236] },
      slate: { primary: [51, 65, 85], secondary: [100, 116, 139], rowAlt: [248, 250, 252] }
    };

    const activeTheme = palettes[pdfTheme];
    const pageWidth = doc.internal.pageSize.getWidth();
    let currentY = 15;

    // Header Metadata (Clean, optional)
    if (includeTitle && title) {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(18);
      doc.setTextColor(activeTheme.primary[0], activeTheme.primary[1], activeTheme.primary[2]);
      
      const titleLines = doc.splitTextToSize(title, pageWidth - 30);
      doc.text(titleLines, 15, currentY);
      currentY += (titleLines.length * 7) + 3;
    }

    if (includeSummary && summary) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      doc.setTextColor(80, 80, 80);
      
      const summaryLines = doc.splitTextToSize(summary, pageWidth - 30);
      doc.text(summaryLines, 15, currentY);
      currentY += (summaryLines.length * 5) + 5;
    }

    // Density padding translation
    const paddingMap = {
      compact: { top: 2, bottom: 2, left: 3, right: 3 },
      normal: { top: 3.5, bottom: 3.5, left: 4, right: 4 },
      spacious: { top: 5, bottom: 5, left: 5, right: 5 }
    };

    // AutoTable library call
    autoTable(doc, {
      startY: currentY,
      head: [columns],
      body: rows,
      theme: "striped",
      styles: {
        fontSize: pdfDensity === "compact" ? 8 : pdfDensity === "normal" ? 9 : 10,
        cellPadding: paddingMap[pdfDensity],
        lineColor: [229, 229, 229],
        lineWidth: 0.1,
        textColor: [50, 50, 50],
      },
      headStyles: {
        fillColor: activeTheme.primary as [number, number, number],
        textColor: [255, 255, 255],
        fontStyle: "bold",
      },
      alternateRowStyles: {
        fillColor: activeTheme.rowAlt as [number, number, number],
      },
      margin: { left: 15, right: 15, top: 15, bottom: 15 },
      didDrawPage: (data) => {
        // Simple page number footer, clean and minimalist
        const pageCount = doc.internal.pages.length - 1;
        doc.setFont("helvetica", "normal");
        doc.setFontSize(8);
        doc.setTextColor(150, 150, 150);
        doc.text(
          `Page ${data.pageNumber} of ${pageCount}`,
          pageWidth - 15,
          doc.internal.pageSize.getHeight() - 10,
          { align: "right" }
        );
      }
    });

    // Create a pristine filename
    const cleanFileName = (title || "extracted_table")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .substring(0, 50);

    doc.save(`${cleanFileName}_clean.pdf`);
  };

  return (
    <div className="w-full space-y-6">
      {/* Overview Block */}
      <div className="glass-card rounded-xl p-5 shadow-lg">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="flex h-2.5 w-2.5 rounded-full bg-indigo-400 animate-pulse" />
              <h2 className="text-lg font-bold text-white">
                {title || "Extracted Columns & Table Data"}
              </h2>
            </div>
            {summary && (
              <p className="text-sm text-slate-300 mt-1 max-w-3xl leading-relaxed">
                {summary}
              </p>
            )}
          </div>
          <button
            id="reset-extractor"
            onClick={onReset}
            className="flex items-center gap-2 px-3.5 py-1.5 text-xs font-semibold text-slate-300 hover:text-white border border-white/10 hover:border-white/25 bg-white/5 hover:bg-white/10 rounded-lg transition-all shadow-md cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Clear & Upload New
          </button>
        </div>
      </div>

      {/* Primary Layout Grid */}
      <div className="grid grid-cols-1 xl:grid-cols-4 gap-6 items-start">
        {/* PDF Styling Controls (1/4 columns on desktop) */}
        <div className="xl:col-span-1 glass-card rounded-xl p-5 shadow-lg space-y-6">
          <div className="flex items-center gap-2 pb-3 border-b border-white/10">
            <Settings className="w-4.5 h-4.5 text-slate-400" />
            <h3 className="font-bold text-sm text-slate-200">Export Settings</h3>
          </div>

          {/* Color Palette Choice */}
          <div className="space-y-2.5">
            <label className="text-xs font-semibold text-slate-400 block uppercase tracking-wider">
              Theme Palette
            </label>
            <div className="grid grid-cols-5 gap-2">
              {(["navy", "charcoal", "emerald", "amber", "slate"] as const).map((theme) => {
                const colors = {
                  navy: "bg-blue-900 hover:bg-blue-800",
                  charcoal: "bg-neutral-800 hover:bg-neutral-700",
                  emerald: "bg-emerald-800 hover:bg-emerald-700",
                  amber: "bg-amber-700 hover:bg-amber-600",
                  slate: "bg-slate-700 hover:bg-slate-600"
                };
                return (
                  <button
                    key={theme}
                    onClick={() => setPdfTheme(theme)}
                    className={`h-8 w-full rounded-md relative ${colors[theme]} transition-all cursor-pointer`}
                    title={`${theme.toUpperCase()} Theme`}
                  >
                    {pdfTheme === theme && (
                      <div className="absolute inset-0 flex items-center justify-center text-white">
                        <Check className="w-4 h-4" />
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Density selection */}
          <div className="space-y-2">
            <label className="text-xs font-semibold text-slate-400 block uppercase tracking-wider">
              Table Density
            </label>
            <div className="grid grid-cols-3 gap-1 p-1 bg-black/30 border border-white/10 rounded-lg">
              {(["compact", "normal", "spacious"] as const).map((density) => (
                <button
                  key={density}
                  onClick={() => setPdfDensity(density)}
                  className={`py-1.5 text-xs font-medium capitalize rounded-md transition-all cursor-pointer ${
                    pdfDensity === density 
                      ? "bg-indigo-600 text-white shadow-md" 
                      : "text-slate-400 hover:text-slate-200"
                  }`}
                >
                  {density}
                </button>
              ))}
            </div>
          </div>

          {/* Page orientation */}
          <div className="space-y-2">
            <label className="text-xs font-semibold text-slate-400 block uppercase tracking-wider">
              Page Orientation
            </label>
            <div className="grid grid-cols-2 gap-1 p-1 bg-black/30 border border-white/10 rounded-lg">
              <button
                onClick={() => setPageOrientation("p")}
                className={`py-1.5 text-xs font-medium rounded-md transition-all cursor-pointer ${
                  pageOrientation === "p" 
                    ? "bg-indigo-600 text-white shadow-md" 
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                Portrait
              </button>
              <button
                onClick={() => setPageOrientation("l")}
                className={`py-1.5 text-xs font-medium rounded-md transition-all cursor-pointer ${
                  pageOrientation === "l" 
                    ? "bg-indigo-600 text-white shadow-md" 
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                Landscape
              </button>
            </div>
          </div>

          {/* Document Header Options */}
          <div className="space-y-3 pt-2">
            <label className="text-xs font-semibold text-slate-400 block uppercase tracking-wider">
              Include Headers
            </label>
            <div className="space-y-2">
              <label className="flex items-center gap-2.5 cursor-pointer text-sm text-slate-300">
                <input
                  type="checkbox"
                  checked={includeTitle}
                  onChange={(e) => setIncludeTitle(e.target.checked)}
                  className="rounded border-white/10 text-indigo-600 focus:ring-indigo-500 h-4 w-4 cursor-pointer bg-black/20"
                />
                <span>Document Title</span>
              </label>
              <label className="flex items-center gap-2.5 cursor-pointer text-sm text-slate-300">
                <input
                  type="checkbox"
                  checked={includeSummary}
                  onChange={(e) => setIncludeSummary(e.target.checked)}
                  className="rounded border-white/10 text-indigo-600 focus:ring-indigo-500 h-4 w-4 cursor-pointer bg-black/20"
                />
                <span>Summary Description</span>
              </label>
            </div>
          </div>

          {/* Compilation CTA */}
          <div className="space-y-2 pt-2">
            <button
              id="download-clean-pdf"
              onClick={handleDownloadPDF}
              className="w-full flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white py-3 px-4 rounded-xl font-semibold text-sm shadow-sm transition-all hover:shadow-md cursor-pointer"
            >
              <FileDown className="w-4.5 h-4.5" />
              Download Clean PDF
            </button>

            <button
              id="store-firebase-db"
              onClick={handleSaveToDatabase}
              disabled={isSavingDb}
              className={`w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl font-bold text-sm shadow-sm transition-all hover:shadow-md cursor-pointer ${
                isSavingDb
                  ? "bg-indigo-500/10 text-slate-400 border border-white/10 cursor-wait"
                  : "bg-white/5 hover:bg-white/10 text-white border border-white/10"
              }`}
            >
              {isSavingDb ? (
                <>
                  <div className="w-4 h-4 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />
                  Saving to CRM...
                </>
              ) : (
                <>
                  <Database className="w-4.5 h-4.5 text-indigo-400" />
                  Store in CRM Database
                </>
              )}
            </button>

            {/* Save Status Notification */}
            <AnimatePresence>
              {saveStatus && (
                <motion.div
                  initial={{ opacity: 0, y: 5 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 5 }}
                  className={`p-3 rounded-lg text-xs font-medium border mt-2 ${
                    saveStatus.type === "success"
                      ? "bg-emerald-500/10 border-emerald-500/35 text-emerald-300"
                      : "bg-red-500/10 border-red-500/35 text-red-300"
                  }`}
                >
                  <p className="flex items-center gap-1.5">
                    {saveStatus.type === "success" ? "✔" : "⚠"}
                    {saveStatus.message}
                  </p>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* Core Table Grid (3/4 columns on desktop) */}
        <div className="xl:col-span-3 space-y-4">
          {/* Table utility bar */}
          <div className="flex flex-col sm:flex-row justify-between gap-3 items-stretch sm:items-center">
            {/* Search */}
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                id="table-search"
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search extracted columns..."
                className="w-full pl-9 pr-4 py-2 border border-white/10 glass-input text-sm focus:outline-hidden focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400"
              />
            </div>

            {/* Quick columns modification / addition actions */}
            <div className="flex items-center gap-2">
              <button
                id="add-column"
                onClick={addNewColumn}
                className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-300 hover:text-white bg-white/5 border border-white/10 hover:border-white/20 hover:bg-white/10 rounded-xl transition-all cursor-pointer shadow-sm"
              >
                <Plus className="w-3.5 h-3.5" />
                Add Column
              </button>
              <button
                id="add-row"
                onClick={addNewRow}
                className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-300 hover:text-white bg-white/5 border border-white/10 hover:border-white/20 hover:bg-white/10 rounded-xl transition-all cursor-pointer shadow-sm"
              >
                <Plus className="w-3.5 h-3.5" />
                Add Row
              </button>
            </div>
          </div>

          {/* Main Scroller Wrapper */}
          <div className="overflow-x-auto glass-card border border-white/10 rounded-xl shadow-lg">
            <table className="w-full min-w-max border-collapse">
              <thead>
                <tr className="bg-black/20 border-b border-white/10">
                  {columns.map((col, cIdx) => (
                    <th 
                      key={cIdx} 
                      className="px-4 py-3 text-left text-xs font-bold text-slate-200 tracking-wider relative group"
                    >
                      {editingHeader === cIdx ? (
                        <div className="flex items-center gap-1">
                          <input
                            type="text"
                            value={tempValue}
                            onChange={(e) => setTempValue(e.target.value)}
                            onBlur={saveHeaderEdit}
                            onKeyDown={(e) => handleKeyDown(e, "header")}
                            autoFocus
                            className="px-2 py-1 text-xs border border-white/15 rounded-md glass-input text-white font-medium focus:outline-hidden"
                          />
                          <button
                            onClick={saveHeaderEdit}
                            className="p-1 bg-white/10 hover:bg-white/20 rounded-md text-slate-200"
                          >
                            <Check className="w-3 h-3" />
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center justify-between gap-2">
                          <span 
                            className="cursor-pointer hover:underline flex items-center gap-1.5"
                            onClick={() => {
                              setEditingHeader(cIdx);
                              setTempValue(col);
                            }}
                            title="Click to rename column"
                          >
                            {col}
                            <Edit2 className="w-3 h-3 text-slate-400 opacity-0 group-hover:opacity-100 transition-opacity" />
                          </span>

                          <button
                            onClick={() => deleteColumn(cIdx)}
                            className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-red-400 transition-all p-1 hover:bg-white/10 rounded-md"
                            title={`Delete column "${col}"`}
                            disabled={columns.length <= 1}
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      )}
                    </th>
                  ))}
                  <th className="w-16 px-4 py-3 bg-black/10 text-right text-xs font-bold text-slate-300">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {filteredRowsWithOriginalIndices.length === 0 ? (
                  <tr>
                    <td colSpan={columns.length + 1} className="px-6 py-12 text-center text-sm text-slate-400">
                      No matching records found. Try modifying your search filter or add a row!
                    </td>
                  </tr>
                ) : (
                  filteredRowsWithOriginalIndices.map(({ row, originalIndex }) => (
                    <tr 
                      key={originalIndex} 
                      className="hover:bg-white/5 transition-colors group"
                    >
                      {columns.map((_, cIdx) => {
                        const cellValue = row[cIdx] !== undefined ? row[cIdx] : "";
                        const isEditing = editingCell?.rIndex === originalIndex && editingCell?.cIndex === cIdx;

                        return (
                          <td 
                            key={cIdx} 
                            className="px-4 py-2.5 text-sm text-slate-300 relative hover:bg-white/5 cursor-pointer min-w-[120px]"
                            onClick={() => {
                              if (!isEditing) {
                                setEditingCell({ rIndex: originalIndex, cIndex: cIdx });
                                setTempValue(cellValue);
                              }
                            }}
                          >
                            {isEditing ? (
                              <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                                {(() => {
                                  const colName = (columns[cIdx] || "").trim();
                                  const isDateCol = colName === "Last CSG" || colName === "Last LSG" || 
                                    ((colName.toLowerCase().includes("csg") || colName.toLowerCase().includes("lsg")) && 
                                     (colName.toLowerCase().includes("date") || colName.toLowerCase().includes("last")));

                                  return (
                                    <input
                                      type={isDateCol ? "date" : "text"}
                                      value={isDateCol ? formatDateForInput(tempValue) : tempValue}
                                      onChange={(e) => {
                                        const val = e.target.value;
                                        setTempValue(isDateCol ? formatDateForDb(val) : val);
                                      }}
                                      onBlur={saveCellEdit}
                                      onKeyDown={(e) => handleKeyDown(e, "cell")}
                                      autoFocus
                                      className="w-full px-2 py-1 text-sm border border-white/15 rounded-md glass-input focus:outline-hidden [color-scheme:dark]"
                                    />
                                  );
                                })()}
                                <button
                                  onClick={saveCellEdit}
                                  className="p-1 bg-white/10 hover:bg-white/20 rounded-md text-slate-200 shrink-0"
                                >
                                  <Check className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            ) : (
                              <div className="flex items-center justify-between gap-1 group/cell">
                                <span className="truncate max-w-[280px]" title={cellValue}>
                                  {cellValue === "" ? (
                                    <span className="text-slate-500 italic">empty</span>
                                  ) : (
                                    cellValue
                                  )}
                                </span>
                                <Edit2 className="w-3 h-3 text-slate-400 opacity-0 group-hover/cell:opacity-100 shrink-0" />
                              </div>
                            )}
                          </td>
                        );
                      })}
                      <td className="px-4 py-2.5 text-right whitespace-nowrap">
                        <button
                          onClick={() => deleteRow(originalIndex)}
                          className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-red-400 hover:bg-red-500/10 p-1.5 rounded-lg transition-all cursor-pointer"
                          title="Delete row"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="flex justify-between items-center text-xs text-slate-400 px-1 pt-1">
            <div className="flex items-center gap-1">
              <HelpCircle className="w-3.5 h-3.5" />
              <span>Double click or click any header or cell to edit inline. Hover on headers to delete columns.</span>
            </div>
            <div>
              Total Records: <strong className="text-slate-200">{rows.length} rows</strong> • Columns: <strong className="text-slate-200">{columns.length} columns</strong>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
