import React, { useEffect, useState, useRef } from "react";
import { 
  Search, Trash2, Plus, RefreshCw, Sliders, Database, 
  MessageSquare, Phone, Mail, User, ShieldAlert, Check, X,
  PlusCircle, Edit3, Star, Tag, CheckCircle, Info, Home, Calendar,
  Filter, ChevronDown, Save, Copy
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { 
  collection, getDocs, doc, setDoc, deleteDoc, updateDoc, 
  serverTimestamp, onSnapshot
} from "firebase/firestore";
import { db } from "../lib/firebase";

interface ContactRecord {
  id: string;
  [key: string]: any; // Allows flexible dynamic fields
}

interface TextTemplate {
  id: string;
  title: string;
  content: string;
  createdAt?: any;
  updatedAt?: any;
}

// Global Memory Cache for phone validation to optimize performance and prevent duplicate lookups
const validationCache: Record<string, { isLandline: boolean; isValid: boolean; type: string; formatted: string }> = {};
const pendingRequests: Record<string, Promise<any>> = {};

// Helper to determine colored tag badges
const getTagColors = (tag: string) => {
  const t = tag.trim().toLowerCase();
  if (t === "textable") {
    return "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20";
  }
  if (t === "vip" || t === "urgent") {
    return "bg-rose-500/10 text-rose-400 border border-rose-500/20";
  }
  if (t === "lead" || t === "contractor") {
    return "bg-amber-500/10 text-amber-400 border border-amber-500/20";
  }
  if (t === "active" || t === "staff") {
    return "bg-indigo-500/10 text-indigo-400 border border-indigo-500/20";
  }
  // Fallback to stable random cycle
  const hash = Array.from(t).reduce((acc, char) => acc + char.charCodeAt(0), 0);
  const colors = [
    "bg-sky-500/10 text-sky-400 border border-sky-500/20",
    "bg-purple-500/10 text-purple-400 border border-purple-500/20",
    "bg-fuchsia-500/10 text-fuchsia-400 border border-fuchsia-500/20",
    "bg-teal-500/10 text-teal-400 border border-teal-500/20"
  ];
  return colors[hash % colors.length];
};

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

// --- Custom PhoneCell Sub-component ---
function PhoneCell({ 
  number, 
  isPreferred, 
  onSetPreferred,
  onEditSubmit
}: { 
  number: string; 
  isPreferred: boolean; 
  onSetPreferred: () => void;
  onEditSubmit: (val: string) => void;
}) {
  const [valInfo, setValInfo] = useState<{ isLandline: boolean; type: string; formatted: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [tempVal, setTempVal] = useState(number);

  useEffect(() => {
    setTempVal(number);
    if (!number || number.trim() === "") {
      setValInfo(null);
      return;
    }

    const cleanNum = number.trim();
    if (validationCache[cleanNum]) {
      setValInfo(validationCache[cleanNum]);
      return;
    }

    // Fetch validation
    const fetchValidation = async () => {
      setLoading(true);
      try {
        if (!pendingRequests[cleanNum]) {
          pendingRequests[cleanNum] = fetch(`/api/validate-phone?number=${encodeURIComponent(cleanNum)}`)
            .then(res => res.json())
            .then(data => {
              const info = {
                isLandline: !!data.isLandline,
                isValid: !!data.isValid,
                type: data.type || "UNKNOWN",
                formatted: data.formatted || cleanNum
              };
              validationCache[cleanNum] = info;
              return info;
            })
            .catch(() => {
              return { isLandline: false, isValid: false, type: "UNKNOWN", formatted: cleanNum };
            });
        }

        const info = await pendingRequests[cleanNum];
        setValInfo(info);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };

    fetchValidation();
  }, [number]);

  if (isEditing) {
    return (
      <div className="flex items-center gap-1.5" onClick={e => e.stopPropagation()}>
        <input
          type="text"
          value={tempVal}
          onChange={(e) => setTempVal(e.target.value)}
          onBlur={() => {
            onEditSubmit(tempVal);
            setIsEditing(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              onEditSubmit(tempVal);
              setIsEditing(false);
            } else if (e.key === "Escape") {
              setIsEditing(false);
            }
          }}
          autoFocus
          className="w-full px-2 py-1 text-sm border border-white/15 rounded-md glass-input focus:outline-hidden"
        />
        <button
          onClick={() => {
            onEditSubmit(tempVal);
            setIsEditing(false);
          }}
          className="p-1 bg-indigo-600/30 hover:bg-indigo-600/50 rounded-md text-slate-200 shrink-0"
        >
          <Check className="w-3.5 h-3.5" />
        </button>
      </div>
    );
  }

  const displayText = valInfo ? valInfo.formatted : number;
  const isLandline = valInfo ? valInfo.isLandline : false;
  const phoneType = valInfo ? valInfo.type : "";

  return (
    <div 
      className="flex items-center gap-1.5 group/phone py-0.5 px-1 rounded-md hover:bg-white/5 transition-all w-full"
      title="Click to edit phone number"
    >
      {/* Interactive preferred Star on the left */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onSetPreferred();
        }}
        className={`p-0.5 rounded-md transition-all shrink-0 ${
          isPreferred 
            ? "text-amber-400 opacity-100" 
            : "text-slate-600 hover:text-amber-400 hover:bg-amber-500/10 opacity-0 group-hover/phone:opacity-100"
        }`}
        title={isPreferred ? "Preferred Phone Number" : "Mark as Preferred Phone"}
      >
        <Star className={`w-3.5 h-3.5 ${isPreferred ? "fill-amber-400 text-amber-400" : ""}`} />
      </button>

      <div 
        className="flex-1 min-w-0"
        onClick={(e) => {
          e.stopPropagation();
          setIsEditing(true);
        }}
      >
        <span 
          className={`transition-all flex items-center gap-1 ${
            isLandline 
              ? "text-red-400 font-semibold" 
              : "text-slate-300"
          } ${isPreferred ? "font-extrabold text-white underline decoration-indigo-500/50" : ""}`}
          title={isLandline ? "Landline number (Cannot receive SMS)" : phoneType ? `Phone type: ${phoneType}` : "Click to edit"}
        >
          {displayText || <span className="text-slate-600 italic text-xs">empty</span>}
          {isLandline && (
            <span className="text-[9px] bg-red-500/15 border border-red-500/30 text-red-400 px-1.5 py-0.5 rounded-sm font-bold tracking-wider ml-1 uppercase shrink-0">
              Landline
            </span>
          )}
        </span>
      </div>
    </div>
  );
}

// --- Custom LabelsCell Sub-component ---
function LabelsCell({
  labelsString,
  onUpdate
}: {
  labelsString: string;
  onUpdate: (newVal: string) => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [inputVal, setInputVal] = useState("");
  
  // Parse tags safely
  const tags = labelsString
    ? labelsString.split(",").map(t => t.trim()).filter(Boolean)
    : [];

  const handleRemoveTag = (tagToRemove: string) => {
    const updated = tags.filter(t => t.toLowerCase() !== tagToRemove.toLowerCase()).join(", ");
    onUpdate(updated);
  };

  const handleAddTag = (newTag: string) => {
    const clean = newTag.trim();
    if (!clean) return;
    if (tags.some(t => t.toLowerCase() === clean.toLowerCase())) {
      setInputVal("");
      return; // Already exists
    }
    const updated = [...tags, clean].join(", ");
    onUpdate(updated);
    setInputVal("");
  };

  const quickTags = ["Textable", "VIP", "Contractor", "Staff", "Lead", "Urgent", "Active"];

  if (isEditing) {
    return (
      <div 
        className="p-3 bg-slate-900 border border-white/10 rounded-xl space-y-2.5 max-w-xs shadow-2xl relative z-30" 
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-white/5 pb-1.5">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Manage Labels</span>
          <button 
            onClick={() => setIsEditing(false)}
            className="text-slate-400 hover:text-white"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Current badges inside editor */}
        <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto">
          {tags.length === 0 ? (
            <span className="text-xs text-slate-500 italic">No labels yet</span>
          ) : (
            tags.map(tag => (
              <span 
                key={tag}
                className="inline-flex items-center gap-1 bg-white/5 border border-white/10 px-2 py-0.5 rounded-full text-xs text-slate-300"
              >
                {tag}
                <button 
                  onClick={() => handleRemoveTag(tag)}
                  className="text-slate-400 hover:text-red-400 ml-0.5 font-bold"
                >
                  &times;
                </button>
              </span>
            ))
          )}
        </div>

        {/* Input to type new tag */}
        <div className="flex items-center gap-1.5">
          <input
            type="text"
            value={inputVal}
            onChange={e => setInputVal(e.target.value)}
            onKeyDown={e => {
              if (e.key === "Enter") {
                handleAddTag(inputVal);
              } else if (e.key === "Escape") {
                setIsEditing(false);
              }
            }}
            placeholder="Add label..."
            className="w-full px-2 py-1 text-xs border border-white/15 rounded-md glass-input focus:outline-hidden"
            autoFocus
          />
          <button
            onClick={() => handleAddTag(inputVal)}
            className="p-1 bg-indigo-600 hover:bg-indigo-500 rounded-md text-white shrink-0"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Quick select buttons */}
        <div className="space-y-1">
          <div className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Quick Add:</div>
          <div className="flex flex-wrap gap-1">
            {quickTags.map(qt => {
              const hasTag = tags.some(t => t.toLowerCase() === qt.toLowerCase());
              return (
                <button
                  key={qt}
                  type="button"
                  onClick={() => hasTag ? handleRemoveTag(qt) : handleAddTag(qt)}
                  className={`px-2 py-0.5 rounded-full text-[10px] font-semibold transition-all cursor-pointer ${
                    hasTag 
                      ? "bg-indigo-500/20 text-indigo-300 border border-indigo-500/40" 
                      : "bg-white/5 text-slate-400 border border-white/5 hover:bg-white/10 hover:text-slate-200"
                  }`}
                >
                  {hasTag ? "✓ " : "+ "}
                  {qt}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div 
      className="flex flex-wrap gap-1 min-h-[32px] items-center group/labels relative cursor-pointer hover:bg-white/5 p-1 rounded-md transition-all"
      onClick={(e) => {
        e.stopPropagation();
        setIsEditing(true);
      }}
      title="Click to manage labels"
    >
      {tags.length === 0 ? (
        <span className="text-slate-600 italic text-xs group-hover/labels:text-slate-400 transition-colors">
          click to add labels...
        </span>
      ) : (
        tags.map(tag => (
          <span 
            key={tag}
            className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold ${getTagColors(tag)}`}
          >
            {tag}
          </span>
        ))
      )}
      <Edit3 className="w-3 h-3 text-slate-500 opacity-0 group-hover/labels:opacity-100 ml-1 shrink-0 transition-all" />
    </div>
  );
}


interface ConflictRecord {
  id: string;
  contactId: string;
  workerName: string;
  field: string;
  existingValue: string;
  incomingValue: string;
  status: "pending" | "applied" | "rejected";
  sheetType: string;
  updatedAt: any;
}

interface CrmDatabaseProps {
  activeView?: "contacts" | "reviews";
}

// --- Main CrmDatabase Component ---
export default function CrmDatabase({ activeView = "contacts" }: CrmDatabaseProps) {
  const [contacts, setContacts] = useState<ContactRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedTagFilters, setSelectedTagFilters] = useState<string[]>([]);
  const [filterMode, setFilterMode] = useState<"and" | "or">("and");
  const [showLabelDropdown, setShowLabelDropdown] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [conflicts, setConflicts] = useState<ConflictRecord[]>([]);
  const [conflictsLoading, setConflictsLoading] = useState(false);

  // Core clean dynamic columns list
  const [columns, setColumns] = useState<string[]>([
    "Worker Name", 
    "Household Phone", 
    "Personal Phone", 
    "Email", 
    "Labels",
    "Last CSG",
    "Last LSG",
    "Total CSG",
    "Total LSG"
  ]);

  // Inline editing state for general cells
  const [editingCell, setEditingCell] = useState<{ contactId: string; field: string } | null>(null);
  const [tempValue, setTempValue] = useState("");

  // New custom column input
  const [newColName, setNewColName] = useState("");
  const [showAddCol, setShowAddCol] = useState(false);

  // New manual contact row form
  const [showAddRow, setShowAddRow] = useState(false);
  const [newContact, setNewContact] = useState<Record<string, string>>({});

  // --- SMS Reminder Templates states ---
  const [templates, setTemplates] = useState<TextTemplate[]>([]);
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null);
  const [newTemplateTitle, setNewTemplateTitle] = useState<string>("");
  const [newTemplateContent, setNewTemplateContent] = useState<string>("");
  const [showAddTemplateForm, setShowAddTemplateForm] = useState<boolean>(false);

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const handleInsertTextAtCursor = (textToInsert: string) => {
    const textarea = textareaRef.current;
    if (!textarea) {
      setNewTemplateContent(prev => prev + textToInsert);
      return;
    }

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const text = textarea.value;
    const before = text.substring(0, start);
    const after = text.substring(end, text.length);

    setNewTemplateContent(before + textToInsert + after);

    setTimeout(() => {
      textarea.focus();
      const newCursorPos = start + textToInsert.length;
      textarea.setSelectionRange(newCursorPos, newCursorPos);
    }, 10);
  };

  // Load and migrate contacts from Firebase
  const fetchContacts = async () => {
    setLoading(true);
    setError(null);
    try {
      const querySnapshot = await getDocs(collection(db, "crm_contacts"));
      const records: ContactRecord[] = [];
      const foundFields = new Set<string>();

      // Always display core columns first in ordered structure
      foundFields.add("Worker Name");
      foundFields.add("Household Phone");
      foundFields.add("Personal Phone");
      foundFields.add("Email");
      foundFields.add("Labels");
      foundFields.add("Last CSG");
      foundFields.add("Last LSG");
      foundFields.add("Total CSG");
      foundFields.add("Total LSG");

      querySnapshot.forEach((docSnap) => {
        const rawData = docSnap.data();
        const data = { ...rawData };

        // --- AUTOMATIC INTELLIGENT DATA MIGRATION ---
        
        // 1. Migrate "Is Textable?" -> Labels tag "Textable"
        const labels = (data["Labels"] || "").split(",").map((s: string) => s.trim()).filter(Boolean);
        const isTextableVal = data["Is Textable?"] || data["Is Textable"] || data["Textable"];
        if (isTextableVal) {
          const text = String(isTextableVal).toLowerCase();
          const yesVal = text.includes("yes") || text.includes("true") || text === "y" || text.includes("textable");
          if (yesVal && !labels.some(l => l.toLowerCase() === "textable")) {
            labels.push("Textable");
          }
        }
        data["Labels"] = labels.join(", ");

        // 2. Migrate "Preferred Number" -> Preferred Phone Type ("Personal" or "Household")
        if (!data["Preferred Phone Type"] && data["Preferred Number"]) {
          const prefNum = String(data["Preferred Number"]).replace(/[^0-9]/g, "");
          const household = String(data["Household Phone"] || "").replace(/[^0-9]/g, "");
          const personal = String(data["Personal Phone"] || "").replace(/[^0-9]/g, "");
          
          if (prefNum && household && prefNum.includes(household)) {
            data["Preferred Phone Type"] = "Household";
          } else if (prefNum && personal && prefNum.includes(personal)) {
            data["Preferred Phone Type"] = "Personal";
          }
        }

        records.push({
          id: docSnap.id,
          ...data
        });

        // Track and register dynamic custom fields
        Object.keys(data).forEach(key => {
          // EXCLUDE dynamic system fields & legacy hidden properties from direct column headers
          if (
            key !== "updatedAt" && 
            key !== "id" && 
            key !== "Preferred Phone Type" && 
            key !== "Is Textable?" && 
            key !== "Is Textable" && 
            key !== "Textable" && 
            key !== "Preferred Number"
          ) {
            foundFields.add(key);
          }
        });
      });

      // Sort contacts by Worker Name alphabetically
      records.sort((a, b) => {
        const nameA = (a["Worker Name"] || a["Name"] || "").toLowerCase();
        const nameB = (b["Worker Name"] || b["Name"] || "").toLowerCase();
        return nameA.localeCompare(nameB);
      });

      setContacts(records);
      setColumns(Array.from(foundFields));
    } catch (err: any) {
      console.error("Error fetching contacts from Firestore:", err);
      setError("Failed to fetch CRM contacts. Ensure you have network connectivity and Firebase is properly configured.");
    } finally {
      setLoading(false);
    }
  };

  const fetchConflicts = async () => {
    setConflictsLoading(true);
    try {
      const qSnapshot = await getDocs(collection(db, "crm_sync_conflicts"));
      const records: ConflictRecord[] = [];
      qSnapshot.forEach((docSnap) => {
        records.push({
          id: docSnap.id,
          ...docSnap.data()
        } as ConflictRecord);
      });
      // Sort: pending first, then by id descending
      records.sort((a, b) => {
        if (a.status === "pending" && b.status !== "pending") return -1;
        if (a.status !== "pending" && b.status === "pending") return 1;
        return b.id.localeCompare(a.id);
      });
      setConflicts(records);
    } catch (err) {
      console.error("Error fetching conflicts:", err);
    } finally {
      setConflictsLoading(false);
    }
  };

  const handleResolveConflict = async (
    conflict: ConflictRecord, 
    decision: "yes" | "no" | "never"
  ) => {
    try {
      const conflictRef = doc(db, "crm_sync_conflicts", conflict.id);
      
      if (decision === "yes") {
        if (conflict.field === "Presence") {
          // Yes means delete the contact as they are no longer a volunteer
          await deleteDoc(doc(db, "crm_contacts", conflict.contactId));
        } else {
          // Apply incoming value to contact
          const contactRef = doc(db, "crm_contacts", conflict.contactId);
          await setDoc(contactRef, {
            [conflict.field]: conflict.incomingValue,
            updatedAt: serverTimestamp()
          }, { merge: true });
        }
        // Update conflict status to resolved/applied
        await updateDoc(conflictRef, {
          status: "applied",
          updatedAt: serverTimestamp()
        });
      } else if (decision === "no") {
        // Reject the incoming value: keep existing, mark conflict as rejected
        await updateDoc(conflictRef, {
          status: "rejected",
          updatedAt: serverTimestamp()
        });
      } else if (decision === "never") {
        // Never overwrite this field: save rule to crm_never_rules
        const ruleId = `${conflict.contactId}_${conflict.field.toLowerCase().replace(/\s+/g, "_")}`;
        await setDoc(doc(db, "crm_never_rules", ruleId), {
          contactId: conflict.contactId,
          field: conflict.field,
          rule: "NEVER",
          createdAt: serverTimestamp()
        });
        // Reject this conflict
        await updateDoc(conflictRef, {
          status: "rejected",
          updatedAt: serverTimestamp()
        });
      }

      // Refresh both
      await fetchContacts();
      await fetchConflicts();
    } catch (err) {
      console.error("Error resolving conflict:", err);
      alert("Failed to resolve conflict.");
    }
  };

  const clearResolvedLogs = async () => {
    if (!confirm("Are you sure you want to clear all resolved conflict logs?")) return;
    try {
      const resolved = conflicts.filter(c => c.status !== "pending");
      for (const r of resolved) {
        await deleteDoc(doc(db, "crm_sync_conflicts", r.id));
      }
      await fetchConflicts();
    } catch (err) {
      console.error("Error clearing logs:", err);
    }
  };

  useEffect(() => {
    fetchContacts();
    fetchConflicts();

    // Listen to SMS templates in real-time
    const unsubscribeTemplates = onSnapshot(
      collection(db, "text_templates"),
      (snapshot) => {
        const list: TextTemplate[] = [];
        snapshot.forEach((docSnap) => {
          list.push({ id: docSnap.id, ...docSnap.data() } as TextTemplate);
        });
        list.sort((a, b) => a.title.localeCompare(b.title));
        setTemplates(list);
      },
      (err) => {
        console.error("Firestore templates listener error:", err);
      }
    );

    return () => {
      unsubscribeTemplates();
    };
  }, []);

  // Save/Update Text Template in Settings tab
  const handleSaveTemplateInSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTemplateTitle.trim() || !newTemplateContent.trim()) return;
    try {
      if (editingTemplateId) {
        const docRef = doc(db, "text_templates", editingTemplateId);
        await updateDoc(docRef, {
          title: newTemplateTitle.trim(),
          content: newTemplateContent.trim(),
          updatedAt: serverTimestamp()
        });
      } else {
        const docRef = doc(collection(db, "text_templates"));
        await setDoc(docRef, {
          title: newTemplateTitle.trim(),
          content: newTemplateContent.trim(),
          createdAt: serverTimestamp()
        });
      }
      setEditingTemplateId(null);
      setNewTemplateTitle("");
      setNewTemplateContent("");
      setShowAddTemplateForm(false);
    } catch (err) {
      console.error("Failed to save template:", err);
      alert("Failed to save template.");
    }
  };

  // Delete Text Template in Settings tab
  const handleDeleteTemplateInSettings = async (id: string) => {
    if (!confirm("Are you sure you want to delete this text template?")) return;
    try {
      await deleteDoc(doc(db, "text_templates", id));
    } catch (err) {
      console.error("Failed to delete template:", err);
    }
  };

  // Update a specific cell in Firestore
  const updateContactField = async (contactId: string, field: string, value: string) => {
    try {
      const contactRef = doc(db, "crm_contacts", contactId);
      await updateDoc(contactRef, {
        [field]: value,
        updatedAt: serverTimestamp()
      });

      // Update local state
      setContacts(prev => prev.map(c => c.id === contactId ? { ...c, [field]: value } : c));
      setEditingCell(null);
    } catch (err) {
      console.error("Error updating cell:", err);
      alert("Error saving change to database.");
    }
  };

  // Set the preferred phone number type
  const setPreferredPhoneType = async (contactId: string, type: "Personal" | "Household") => {
    try {
      const contact = contacts.find(c => c.id === contactId);
      const currentType = contact ? contact["Preferred Phone Type"] : "";
      const newType = currentType === type ? "" : type; // Toggle off if already preferred

      const contactRef = doc(db, "crm_contacts", contactId);
      await updateDoc(contactRef, {
        "Preferred Phone Type": newType,
        updatedAt: serverTimestamp()
      });

      // Update local state
      setContacts(prev => prev.map(c => c.id === contactId ? { ...c, "Preferred Phone Type": newType } : c));
    } catch (err) {
      console.error("Error updating preferred phone type:", err);
    }
  };

  // Delete a contact
  const deleteContact = async (contactId: string) => {
    if (!confirm("Are you sure you want to remove this contact from the CRM?")) return;
    try {
      await deleteDoc(doc(db, "crm_contacts", contactId));
      setContacts(prev => prev.filter(c => c.id !== contactId));
    } catch (err) {
      console.error("Error deleting contact:", err);
      alert("Failed to delete contact.");
    }
  };

  // Create a new custom column
  const handleAddColumn = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = newColName.trim();
    if (!cleanName) return;

    if (columns.includes(cleanName)) {
      alert("This column already exists!");
      return;
    }

    setColumns(prev => [...prev, cleanName]);
    setNewColName("");
    setShowAddCol(false);
  };

  // Handle adding a manual contact
  const handleAddContact = async (e: React.FormEvent) => {
    e.preventDefault();
    const workerName = newContact["Worker Name"]?.trim();
    if (!workerName) {
      alert("Worker Name is required as the primary key!");
      return;
    }

    const documentId = workerName.replace(/[^a-zA-Z0-9]/g, "_").toLowerCase();

    try {
      const docRef = doc(db, "crm_contacts", documentId);
      const contactData = {
        ...newContact,
        updatedAt: serverTimestamp()
      };

      // Set default empty strings for other columns
      columns.forEach(col => {
        if (contactData[col] === undefined) {
          contactData[col] = "";
        }
      });

      await setDoc(docRef, contactData);
      
      // Refresh list
      fetchContacts();
      setShowAddRow(false);
      setNewContact({});
    } catch (err) {
      console.error("Error creating manual contact:", err);
      alert("Failed to save contact.");
    }
  };

  // Get all unique labels to display as filters
  const allLabels: string[] = (Array.from(
    new Set(
      contacts
        .flatMap(c => {
          const lString = c["Labels"] || "";
          return lString.split(",").map((s: string) => s.trim()).filter(Boolean);
        })
    )
  ) as string[]).sort();

  // Helper to filter contacts by search term and selected label filter
  const filteredContacts = contacts.filter(contact => {
    // 1. Text Search matches columns
    const matchesSearch = !searchTerm || columns.some(col => {
      const val = contact[col];
      return val && String(val).toLowerCase().includes(searchTerm.toLowerCase());
    });

    // 2. Clicked Label Filter
    const contactLabels = (contact["Labels"] || "")
      .split(",")
      .map((s: string) => s.trim().toLowerCase())
      .filter(Boolean);
    
    const matchesTag = selectedTagFilters.length === 0 || (
      filterMode === "and"
        ? selectedTagFilters.every(tag => contactLabels.includes(tag.toLowerCase()))
        : selectedTagFilters.some(tag => contactLabels.includes(tag.toLowerCase()))
    );

    return matchesSearch && matchesTag;
  });

  // Check if a cell is being edited
  const isEditing = (contactId: string, field: string) => {
    return editingCell?.contactId === contactId && editingCell?.field === field;
  };

  // Keyboard navigation inside cell edit
  const handleKeyDown = (e: React.KeyboardEvent, contactId: string, field: string) => {
    if (e.key === "Enter") {
      updateContactField(contactId, field, tempValue);
    } else if (e.key === "Escape") {
      setEditingCell(null);
    }
  };

  // Helper to render responsive cell editors or cells for mobile stacked view
  const renderMobileCell = (contact: ContactRecord, col: string) => {
    const cellValue = contact[col] !== undefined ? contact[col] : "";
    const prefType = String(contact["Preferred Phone Type"] || "").toLowerCase();
    const isPersonalPref = prefType === "personal";
    const isHouseholdPref = prefType === "household";

    if (col === "Household Phone") {
      return (
        <PhoneCell 
          number={cellValue}
          isPreferred={isHouseholdPref}
          onSetPreferred={() => setPreferredPhoneType(contact.id, "Household")}
          onEditSubmit={(newVal) => updateContactField(contact.id, col, newVal)}
        />
      );
    }

    if (col === "Personal Phone") {
      return (
        <PhoneCell 
          number={cellValue}
          isPreferred={isPersonalPref}
          onSetPreferred={() => setPreferredPhoneType(contact.id, "Personal")}
          onEditSubmit={(newVal) => updateContactField(contact.id, col, newVal)}
        />
      );
    }

    if (col === "Labels") {
      return (
        <LabelsCell 
          labelsString={cellValue}
          onUpdate={(newVal) => updateContactField(contact.id, col, newVal)}
        />
      );
    }

    // General dynamic cells for Mobile Stacked rows
    return (
      <div 
        className="px-1.5 py-0.5 text-xs text-slate-300 relative hover:bg-white/5 cursor-pointer rounded-md transition-all min-h-[24px] flex items-center justify-between group/mcell"
        onClick={(e) => {
          e.stopPropagation();
          if (!isEditing(contact.id, col)) {
            setEditingCell({ contactId: contact.id, field: col });
            setTempValue(cellValue);
          }
        }}
      >
        {isEditing(contact.id, col) ? (
          <div className="flex items-center gap-1.5 w-full" onClick={e => e.stopPropagation()}>
            <input
              type={col === "Last CSG" || col === "Last LSG" ? "date" : "text"}
              value={col === "Last CSG" || col === "Last LSG" ? formatDateForInput(tempValue) : tempValue}
              onChange={(e) => {
                const val = e.target.value;
                setTempValue(col === "Last CSG" || col === "Last LSG" ? formatDateForDb(val) : val);
              }}
              onBlur={() => updateContactField(contact.id, col, tempValue)}
              onKeyDown={(e) => handleKeyDown(e, contact.id, col)}
              autoFocus
              className="w-full px-1.5 py-0.5 text-xs border border-white/15 rounded-md glass-input focus:outline-hidden [color-scheme:dark]"
            />
            <button
              onClick={() => updateContactField(contact.id, col, tempValue)}
              className="p-0.5 bg-white/10 hover:bg-white/20 rounded-md text-slate-200 shrink-0"
            >
              <Check className="w-3 h-3" />
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-1 w-full">
            <div className="truncate max-w-[280px]">
              {cellValue === "" ? (
                <span className="text-slate-600 italic text-[11px]">empty</span>
              ) : (
                cellValue
              )}
            </div>
            <Edit3 className="w-3 h-3 text-slate-500 opacity-0 group-hover/mcell:opacity-100 shrink-0" />
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="w-full">

      {activeView === "contacts" ? (
        <>
          {/* Pinned/Sticky Search & Label Filter Bar */}
          <div className="sticky top-[73px] z-[110] bg-slate-950/95 backdrop-blur-md py-4 -mx-4 px-4 border-b border-white/10 mb-0">
            <div className="max-w-6xl mx-auto flex flex-col md:flex-row justify-between gap-4 items-stretch md:items-center">
              {/* Search */}
              <div className="relative flex-1 max-w-md">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Search saved contacts (names, emails, tags, etc)..."
                  className="w-full pl-9 pr-4 py-2 border border-white/10 glass-input text-sm focus:outline-hidden focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400"
                />
              </div>

              {/* Label Filter Dropdown & Clear Options */}
              <div className="flex items-center gap-3">
                <div className="relative">
                  <button
                    onClick={() => setShowLabelDropdown(!showLabelDropdown)}
                    className={`flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold rounded-xl transition-all border cursor-pointer ${
                      selectedTagFilters.length > 0
                        ? "bg-indigo-600 border-indigo-500 text-white shadow-md"
                        : "bg-white/5 border-white/10 text-slate-300 hover:border-white/20 hover:bg-white/10"
                    }`}
                  >
                    <Filter className="w-3.5 h-3.5" />
                    <span>Filter Labels</span>
                    {selectedTagFilters.length > 0 && (
                      <span className="bg-white text-indigo-600 text-[10px] font-extrabold px-1.5 py-0.5 rounded-full ml-1">
                        {selectedTagFilters.length}
                      </span>
                    )}
                    <ChevronDown className="w-3 h-3 text-slate-400 ml-1" />
                  </button>

                  {showLabelDropdown && (
                    <>
                      <div className="fixed inset-0 z-40" onClick={() => setShowLabelDropdown(false)} />
                      <div className="absolute right-0 mt-2 w-56 max-h-80 overflow-y-auto bg-slate-900 border border-white/10 rounded-xl shadow-xl z-50 p-2 divide-y divide-white/5">
                        <div className="pb-1.5">
                          <button
                            onClick={() => {
                              setSelectedTagFilters([]);
                              setShowLabelDropdown(false);
                            }}
                            className={`w-full text-left px-3 py-2 rounded-lg text-xs font-semibold flex items-center justify-between transition-colors cursor-pointer ${
                              selectedTagFilters.length === 0
                                ? "bg-indigo-600/20 text-indigo-300 font-bold"
                                : "text-slate-300 hover:bg-white/5"
                            }`}
                          >
                            <span>All Contacts</span>
                            {selectedTagFilters.length === 0 && <Check className="w-3.5 h-3.5 text-indigo-400" />}
                          </button>
                        </div>

                        <div className="pt-1.5 space-y-0.5">
                          {allLabels.map((label) => {
                            const isSelected = selectedTagFilters.includes(label);
                            const count = contacts.filter((c) => {
                              const arr = (c["Labels"] || "").split(",").map((s) => s.trim().toLowerCase());
                              return arr.includes(label.toLowerCase());
                            }).length;

                            return (
                              <button
                                key={label}
                                onClick={() => {
                                  if (isSelected) {
                                    setSelectedTagFilters(selectedTagFilters.filter((t) => t !== label));
                                  } else {
                                    setSelectedTagFilters([...selectedTagFilters, label]);
                                  }
                                }}
                                className={`w-full text-left px-3 py-1.5 rounded-lg text-xs flex items-center justify-between transition-colors cursor-pointer ${
                                  isSelected
                                    ? "bg-indigo-600/20 text-indigo-300 font-bold"
                                    : "text-slate-400 hover:bg-white/5 hover:text-slate-200"
                                }`}
                              >
                                <div className="flex items-center gap-2 min-w-0">
                                  <div className={`w-3 h-3 border rounded-sm flex items-center justify-center transition-colors ${
                                    isSelected ? "border-indigo-500 bg-indigo-600" : "border-white/20 bg-black/20"
                                  }`}>
                                    {isSelected && <Check className="w-2.5 h-2.5 text-white stroke-[3px]" />}
                                  </div>
                                  <span className="truncate">{label}</span>
                                </div>
                                <span className="text-[10px] text-slate-500 bg-white/5 px-1.5 py-0.2 rounded-full shrink-0">
                                  {count}
                                </span>
                              </button>
                            );
                          })}
                        </div>

                        {selectedTagFilters.length > 0 && (
                          <div className="pt-1.5 border-t border-white/5 mt-1.5">
                            <button
                              onClick={() => {
                                setSelectedTagFilters([]);
                                setShowLabelDropdown(false);
                              }}
                              className="w-full text-center px-3 py-2 rounded-lg text-xs font-bold text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 transition-colors cursor-pointer"
                            >
                              Clear Filters
                            </button>
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="space-y-6 pt-6 px-0.5">
            {/* Slideout Forms */}
            <AnimatePresence>
        {showAddCol && (
          <motion.form 
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            onSubmit={handleAddColumn}
            className="p-4 bg-white/5 border border-white/10 rounded-xl flex items-center gap-3 max-w-md"
          >
            <div className="flex-1">
              <label className="block text-xs font-semibold text-slate-400 mb-1 uppercase tracking-wider">
                Custom Column Label
              </label>
              <input 
                type="text"
                required
                value={newColName}
                onChange={(e) => setNewColName(e.target.value)}
                placeholder="E.g., Hire Date, Department, Status"
                className="w-full px-3 py-1.5 border border-white/10 glass-input text-xs focus:outline-hidden focus:border-indigo-400"
              />
            </div>
            <div className="flex items-end self-end gap-1">
              <button
                type="submit"
                className="bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold px-3 py-2 rounded-lg transition-all"
              >
                Add Column
              </button>
              <button
                type="button"
                onClick={() => setShowAddCol(false)}
                className="bg-white/5 hover:bg-white/10 text-slate-300 text-xs font-bold px-3 py-2 rounded-lg transition-all"
              >
                Cancel
              </button>
            </div>
          </motion.form>
        )}

        {showAddRow && (
          <motion.form
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            onSubmit={handleAddContact}
            className="p-5 bg-white/5 border border-white/10 rounded-xl space-y-4 shadow-lg"
          >
            <h3 className="font-bold text-sm text-slate-200">Create New CRM Contact Row</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {columns.map((col) => (
                <div key={col} className="space-y-1">
                  <label className="block text-xs font-semibold text-slate-400">
                    {col} {col === "Worker Name" && <span className="text-red-400">*</span>}
                  </label>
                  {col === "Last CSG" || col === "Last LSG" ? (
                    <input
                      type="date"
                      value={formatDateForInput(newContact[col] || "")}
                      onChange={(e) => {
                        const val = e.target.value;
                        setNewContact(prev => ({ ...prev, [col]: formatDateForDb(val) }));
                      }}
                      className="w-full px-3 py-2 border border-white/10 glass-input text-xs focus:outline-hidden focus:border-indigo-400 [color-scheme:dark]"
                    />
                  ) : (
                    <input
                      type="text"
                      required={col === "Worker Name"}
                      value={newContact[col] || ""}
                      onChange={(e) => setNewContact(prev => ({ ...prev, [col]: e.target.value }))}
                      placeholder={`Enter ${col.toLowerCase()}...`}
                      className="w-full px-3 py-2 border border-white/10 glass-input text-xs focus:outline-hidden focus:border-indigo-400"
                    />
                  )}
                </div>
              ))}
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t border-white/5">
              <button
                type="button"
                onClick={() => setShowAddRow(false)}
                className="px-4 py-2 text-xs font-semibold text-slate-300 bg-white/5 border border-white/10 hover:bg-white/10 rounded-lg cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg cursor-pointer"
              >
                Save Contact
              </button>
            </div>
          </motion.form>
        )}
      </AnimatePresence>

      {/* Main Database Table & Responsive Cards */}
      {loading ? (
        <div className="overflow-x-auto glass-card border border-white/10 rounded-xl shadow-lg relative z-10 py-20 text-center flex flex-col items-center justify-center">
          <div className="w-8 h-8 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin mb-4" />
          <p className="text-sm text-slate-400">Syncing with cloud contacts...</p>
        </div>
      ) : filteredContacts.length === 0 ? (
        <div className="overflow-x-auto glass-card border border-white/10 rounded-xl shadow-lg relative z-10 py-20 text-center text-slate-400 flex flex-col items-center justify-center max-w-sm mx-auto">
          <ShieldAlert className="w-10 h-10 text-indigo-400 mb-3" />
          <p className="font-semibold text-slate-200">No CRM Contacts Stored</p>
          <p className="text-xs text-slate-400 mt-1 leading-relaxed">
            Analyze a PDF containing workers and click <strong>"Store in CRM Database"</strong>, or clear filters or add a contact manually above to seed the Firestore database!
          </p>
        </div>
      ) : (
        <>
          {/* DESKTOP VIEW: Spreadsheet-style horizontally scrollable table */}
          <div className="hidden lg:block overflow-x-auto glass-card border border-white/10 rounded-xl shadow-lg relative z-10">
            <table className="w-full min-w-max border-collapse">
              <thead>
                <tr className="bg-black/25 border-b border-white/10">
                  {columns.map((col) => (
                    <th 
                      key={col}
                      className="px-4 py-3 text-left text-xs font-bold text-slate-200 tracking-wider"
                    >
                      {col}
                    </th>
                  ))}
                  <th className="w-16 px-4 py-3 bg-black/10 text-right text-xs font-bold text-slate-300">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {filteredContacts.map((contact) => {
                  const prefType = String(contact["Preferred Phone Type"] || "").toLowerCase();
                  const isPersonalPref = prefType === "personal";
                  const isHouseholdPref = prefType === "household";

                  return (
                    <tr 
                      key={contact.id}
                      className="hover:bg-white/5 transition-colors group"
                    >
                      {columns.map((col) => {
                        const cellValue = contact[col] !== undefined ? contact[col] : "";
                        
                        // Render specialized interactive cells for phone and label properties
                        if (col === "Household Phone") {
                          return (
                            <td key={col} className="px-4 py-2.5 text-sm min-w-[160px]">
                              <PhoneCell 
                                number={cellValue}
                                isPreferred={isHouseholdPref}
                                onSetPreferred={() => setPreferredPhoneType(contact.id, "Household")}
                                onEditSubmit={(newVal) => updateContactField(contact.id, col, newVal)}
                              />
                            </td>
                          );
                        }

                        if (col === "Personal Phone") {
                          return (
                            <td key={col} className="px-4 py-2.5 text-sm min-w-[160px]">
                              <PhoneCell 
                                number={cellValue}
                                isPreferred={isPersonalPref}
                                onSetPreferred={() => setPreferredPhoneType(contact.id, "Personal")}
                                onEditSubmit={(newVal) => updateContactField(contact.id, col, newVal)}
                              />
                            </td>
                          );
                        }

                        if (col === "Labels") {
                          return (
                            <td key={col} className="px-4 py-2.5 text-sm min-w-[180px]">
                              <LabelsCell 
                                labelsString={cellValue}
                                onUpdate={(newVal) => updateContactField(contact.id, col, newVal)}
                              />
                            </td>
                          );
                        }

                        // Render general dynamic cells
                        return (
                          <td 
                            key={col}
                            className="px-4 py-2.5 text-sm text-slate-300 relative hover:bg-white/5 cursor-pointer min-w-[140px]"
                            onClick={() => {
                              if (!isEditing(contact.id, col)) {
                                setEditingCell({ contactId: contact.id, field: col });
                                setTempValue(cellValue);
                              }
                            }}
                          >
                            {isEditing(contact.id, col) ? (
                              <div className="flex items-center gap-1.5" onClick={e => e.stopPropagation()}>
                                <input
                                  type={col === "Last CSG" || col === "Last LSG" ? "date" : "text"}
                                  value={col === "Last CSG" || col === "Last LSG" ? formatDateForInput(tempValue) : tempValue}
                                  onChange={(e) => {
                                    const val = e.target.value;
                                    setTempValue(col === "Last CSG" || col === "Last LSG" ? formatDateForDb(val) : val);
                                  }}
                                  onBlur={() => updateContactField(contact.id, col, tempValue)}
                                  onKeyDown={(e) => handleKeyDown(e, contact.id, col)}
                                  autoFocus
                                  className="w-full px-2 py-1 text-sm border border-white/15 rounded-md glass-input focus:outline-hidden [color-scheme:dark]"
                                />
                                <button
                                  onClick={() => updateContactField(contact.id, col, tempValue)}
                                  className="p-1 bg-white/10 hover:bg-white/20 rounded-md text-slate-200 shrink-0"
                                >
                                  <Check className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            ) : (
                              <div className="flex items-center justify-between gap-1 group/cell">
                                <div className="truncate max-w-[320px]">
                                  {cellValue === "" ? (
                                    <span className="text-slate-600 italic text-xs">empty</span>
                                  ) : (
                                    cellValue
                                  )}
                                </div>
                                <Edit3 className="w-3 h-3 text-slate-500 opacity-0 group-hover/cell:opacity-100 shrink-0" />
                              </div>
                            )}
                          </td>
                        );
                      })}
                      <td className="px-4 py-2.5 text-right whitespace-nowrap">
                        <button
                          onClick={() => deleteContact(contact.id)}
                          className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-red-400 hover:bg-red-500/10 p-1.5 rounded-lg transition-all cursor-pointer"
                          title="Delete contact"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* MOBILE VIEW: Stacked records cards optimised for small screens */}
          <div className="block lg:hidden space-y-3 relative z-10">
            {filteredContacts.map((contact) => {
              const customCols = columns.filter(col => 
                !["Worker Name", "Household Phone", "Personal Phone", "Email", "Labels", "Last CSG", "Last LSG", "Total CSG", "Total LSG"].includes(col)
              );

              return (
                <div 
                  key={contact.id}
                  className="glass-card border border-white/10 rounded-xl p-3 space-y-2 relative overflow-hidden shadow-md hover:border-indigo-500/30 transition-all"
                >
                  {/* Floating Action Menu for Deletion */}
                  <div className="absolute top-2.5 right-2.5 z-20">
                    <button
                      onClick={() => deleteContact(contact.id)}
                      className="text-slate-400 hover:text-red-400 hover:bg-red-500/10 p-1 rounded-lg transition-all cursor-pointer"
                      title="Delete contact"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {/* Row 1: Name | House Number (Household Phone) | Phone Number (Personal Phone) | Email */}
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 pb-2 border-b border-white/5 pr-8 text-xs">
                    {/* Name */}
                    <div className="flex items-center gap-1 font-bold text-slate-200 min-w-[150px] text-sm">
                      <User className="w-4 h-4 text-indigo-400 shrink-0" />
                      <div className="flex-1 min-w-0">{renderMobileCell(contact, "Worker Name")}</div>
                    </div>

                    {/* House (Household Phone) */}
                    <div className="flex items-center gap-1 min-w-[130px] flex-1">
                      <Home className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      <div className="flex-1 min-w-0">{renderMobileCell(contact, "Household Phone")}</div>
                    </div>

                    {/* Personal Phone */}
                    <div className="flex items-center gap-1 min-w-[130px] flex-1">
                      <Phone className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      <div className="flex-1 min-w-0">{renderMobileCell(contact, "Personal Phone")}</div>
                    </div>

                    {/* Email */}
                    <div className="flex items-center gap-1 min-w-[130px] flex-1">
                      <Mail className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      <div className="flex-1 min-w-0">{renderMobileCell(contact, "Email")}</div>
                    </div>
                  </div>

                  {/* Row 2: Last CSG | Last LSG | Total CSG | Total LSG */}
                  <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1 py-1.5 border-b border-white/5 text-[11px] text-slate-300">
                    <div className="flex items-center gap-1 min-w-[115px]">
                      <Calendar className="w-3 h-3 text-indigo-400 shrink-0" />
                      <span className="text-slate-400 font-medium">Last CSG:</span>
                      <div className="flex-1">{renderMobileCell(contact, "Last CSG")}</div>
                    </div>
                    <div className="flex items-center gap-1 min-w-[115px]">
                      <Calendar className="w-3 h-3 text-indigo-400 shrink-0" />
                      <span className="text-slate-400 font-medium">Last LSG:</span>
                      <div className="flex-1">{renderMobileCell(contact, "Last LSG")}</div>
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="text-slate-400 font-medium">Total CSG:</span>
                      <div>{renderMobileCell(contact, "Total CSG")}</div>
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="text-slate-400 font-medium">Total LSG:</span>
                      <div>{renderMobileCell(contact, "Total LSG")}</div>
                    </div>
                  </div>

                  {/* Row 3: Tags and Labels */}
                  <div className="flex items-center gap-1.5 pt-1 text-xs">
                    <Tag className="w-3 h-3 text-slate-500 shrink-0" />
                    <div className="flex-1 min-w-0">{renderMobileCell(contact, "Labels")}</div>
                  </div>

                  {/* Dynamic Custom Columns if any */}
                  {customCols.length > 0 && (
                    <div className="flex flex-wrap gap-x-3 gap-y-1.5 pt-1.5 border-t border-white/5 text-xs">
                      {customCols.map(col => (
                        <div key={col} className="flex items-center gap-1">
                          <span className="text-amber-400/80 font-medium text-[11px]">{col}:</span>
                          {renderMobileCell(contact, col)}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* Database Quick Tip info card */}
      <div className="bg-indigo-500/5 border border-indigo-500/15 rounded-xl p-4 flex gap-3 text-xs leading-relaxed text-slate-300">
        <Info className="w-4 h-4 text-indigo-400 shrink-0 mt-0.5" />
        <div className="space-y-1">
          <p className="font-bold text-slate-200">How phone highlighting works:</p>
          <p>
            • Hover over a phone number and click the <Star className="w-3 h-3 inline text-slate-400" /> icon to designate it as preferred. Preferred numbers are instantly styled in **bold font**.
          </p>
          <p>
            • The system automatically triggers the server-side validation engine on render. Numbers verified as <strong>Landline</strong> (Fixed Line) are highlighted in <span className="text-red-400 font-semibold">Red</span> and display a <strong>"Landline"</strong> badge.
          </p>
        </div>
      </div>

      {/* Guide Note */}
      <div className="flex justify-between items-center text-xs text-slate-400 px-1 pt-1">
        <div className="flex items-center gap-1">
          <Database className="w-3.5 h-3.5 text-indigo-400" />
          <span>Extensible NoSQL Model: Adding custom columns dynamically populates fields on newly entered or modified contacts.</span>
        </div>
        <div>
          Total Records: <strong className="text-slate-200">{filteredContacts.length} contacts</strong>
        </div>
      </div>
          </div>
        </>
      ) : (
        <div className="space-y-6">
          {/* Custom Column Management Section */}
          <div className="glass-card rounded-xl p-6 border border-white/10 shadow-lg space-y-4">
            <div>
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                <PlusCircle className="w-5 h-5 text-indigo-400" />
                Custom CRM Columns
              </h3>
              <p className="text-xs text-slate-400 mt-1 max-w-2xl leading-relaxed">
                Define additional custom fields for your CRM directory. These columns will instantly appear in your active Contacts view and can be edited inline.
              </p>
            </div>

            {/* Form to add a new custom column */}
            <form onSubmit={handleAddColumn} className="flex flex-col sm:flex-row items-end gap-3 max-w-md pt-2">
              <div className="flex-1 w-full">
                <label className="block text-xs font-semibold text-slate-400 mb-1.5 uppercase tracking-wider">
                  New Column Label
                </label>
                <input 
                  type="text"
                  required
                  value={newColName}
                  onChange={(e) => setNewColName(e.target.value)}
                  placeholder="E.g., Hire Date, Department, Status"
                  className="w-full px-3 py-2 border border-white/10 rounded-lg glass-input text-xs focus:outline-hidden focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400"
                />
              </div>
              <button
                type="submit"
                className="bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold px-4 py-2.5 rounded-lg transition-all whitespace-nowrap cursor-pointer shadow-md"
              >
                Create Column
              </button>
            </form>

            {/* List of active custom columns */}
            {columns.filter(col => !["Worker Name", "Household Phone", "Personal Phone", "Email", "Labels", "Last CSG", "Last LSG", "Total CSG", "Total LSG"].includes(col)).length > 0 && (
              <div className="pt-2">
                <span className="text-[10px] font-extrabold text-indigo-400 uppercase tracking-wider block mb-2">
                  Active Custom Columns
                </span>
                <div className="flex flex-wrap gap-2">
                  {columns.filter(col => !["Worker Name", "Household Phone", "Personal Phone", "Email", "Labels", "Last CSG", "Last LSG", "Total CSG", "Total LSG"].includes(col)).map(col => (
                    <span key={col} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold bg-white/5 border border-white/10 text-slate-300">
                      {col}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* SMS Reminder Templates Section */}
          <div className="glass-card rounded-xl p-6 border border-white/10 shadow-lg space-y-6">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
              <div>
                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                  <MessageSquare className="w-5 h-5 text-indigo-400" />
                  SMS Reminder Templates
                </h3>
                <p className="text-xs text-slate-400 mt-1 max-w-2xl leading-relaxed">
                  Manage the text message templates used to send event reminders to your scheduled contacts. Use placeholders to dynamically inject schedule details.
                </p>
              </div>
              {!showAddTemplateForm && !editingTemplateId && (
                <button
                  onClick={() => {
                    setEditingTemplateId(null);
                    setNewTemplateTitle("");
                    setNewTemplateContent("");
                    setShowAddTemplateForm(true);
                  }}
                  className="flex items-center gap-1.5 px-3 py-2 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-500 rounded-xl transition-all cursor-pointer shadow-md"
                  id="btn-add-sms-template"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Create Template</span>
                </button>
              )}
            </div>

            {/* Template Creation / Editing Form */}
            {(showAddTemplateForm || editingTemplateId) && (
              <form id="sms-template-form" onSubmit={handleSaveTemplateInSettings} className="p-4 bg-white/5 border border-white/10 rounded-xl space-y-4">
                <div className="flex justify-between items-center border-b border-white/5 pb-2">
                  <h4 className="text-sm font-bold text-slate-200">
                    {editingTemplateId ? "Edit SMS Template" : "Create New SMS Template"}
                  </h4>
                  <button
                    type="button"
                    onClick={() => {
                      setShowAddTemplateForm(false);
                      setEditingTemplateId(null);
                      setNewTemplateTitle("");
                      setNewTemplateContent("");
                    }}
                    className="text-slate-400 hover:text-slate-200"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-400 mb-1">
                      Template Title <span className="text-rose-400">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      value={newTemplateTitle}
                      onChange={(e) => setNewTemplateTitle(e.target.value)}
                      placeholder="e.g., Groom LSG Arrival Reminder"
                      className="w-full px-3 py-2 border border-white/10 rounded-lg glass-input text-xs focus:outline-hidden focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400 font-sans"
                    />
                  </div>

                  <div>
                    <div className="flex justify-between items-center mb-1">
                      <label className="block text-xs font-semibold text-slate-400">
                        Template Body <span className="text-rose-400">*</span>
                      </label>
                      <span className="text-[10px] text-slate-500 font-mono">Dynamic Placeholders available</span>
                    </div>
                    <textarea
                      ref={textareaRef}
                      required
                      rows={4}
                      value={newTemplateContent}
                      onChange={(e) => setNewTemplateContent(e.target.value)}
                      placeholder="e.g., Hi {worker_name}, this is a reminder that you are scheduled for {title} on {date}. Your arrival time is {lsg_arrival}. See you there!"
                      className="w-full px-3 py-2 border border-white/10 rounded-lg glass-input text-xs focus:outline-hidden focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400 font-sans leading-relaxed"
                    />
                    
                    {/* Emoji Helper Bar */}
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5 p-2 bg-slate-950/40 rounded-lg border border-white/5">
                      <span className="text-[10px] font-bold text-slate-500 mr-1 uppercase tracking-wider font-mono">Insert Emoji:</span>
                      {["👋", "😊", "📅", "⏰", "🔔", "⛪", "💍", "👰", "🤵", "🎉", "❤️", "✨", "👍", "🙌", "✉️", "🚨"].map(emoji => (
                        <button
                          key={emoji}
                          type="button"
                          onClick={() => handleInsertTextAtCursor(emoji)}
                          className="w-6 h-6 flex items-center justify-center text-sm rounded bg-white/5 hover:bg-white/15 border border-white/5 hover:border-white/10 transition-all cursor-pointer"
                        >
                          {emoji}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Helper / Copyable Placeholders Badge Container */}
                <div className="bg-black/25 rounded-lg p-3 border border-white/5 space-y-2">
                  <span className="text-[10px] font-extrabold text-indigo-400 uppercase tracking-wider block">
                    Copy and Paste Placeholders:
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {[
                      { placeholder: "{worker_name}", label: "Worker Name" },
                      { placeholder: "{title}", label: "Event Title" },
                      { placeholder: "{date}", label: "Event Date" },
                      { placeholder: "{time}", label: "Event Time" },
                      { placeholder: "{lsg_arrival}", label: "LSG Arrival" },
                      { placeholder: "{csg_arrival}", label: "CSG Arrival" },
                      { placeholder: "{bride_and_groom_arrival}", label: "Bride & Groom Arrival" },
                      { placeholder: "{lsg_bride_first}", label: "Bride LSG First" },
                      { placeholder: "{lsg_groom_first}", label: "Groom LSG First" },
                      { placeholder: "{csg_first}", label: "CSG First" }
                    ].map((item) => (
                      <button
                        key={item.placeholder}
                        type="button"
                        onClick={() => {
                          handleInsertTextAtCursor(item.placeholder);
                        }}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded bg-white/5 hover:bg-white/10 border border-white/10 text-[11px] text-slate-300 font-mono transition-colors group cursor-pointer"
                        title={`Click to insert ${item.placeholder}`}
                      >
                        <span>{item.placeholder}</span>
                        <Copy className="w-2.5 h-2.5 text-slate-500 group-hover:text-slate-300 transition-colors" />
                      </button>
                    ))}
                  </div>
                  <span className="text-[10px] text-slate-500 block">
                    Tip: Placeholders will be replaced automatically with data from the event card when selecting workers.
                  </span>
                </div>

                <div className="flex justify-end gap-2 pt-2 border-t border-white/5">
                  <button
                    type="button"
                    onClick={() => {
                      setShowAddTemplateForm(false);
                      setEditingTemplateId(null);
                      setNewTemplateTitle("");
                      setNewTemplateContent("");
                    }}
                    className="px-3.5 py-1.5 text-xs font-semibold text-slate-300 bg-white/5 border border-white/10 hover:bg-white/10 rounded-lg cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-3.5 py-1.5 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg cursor-pointer flex items-center gap-1.5"
                  >
                    <Save className="w-3.5 h-3.5" />
                    <span>{editingTemplateId ? "Update Template" : "Save Template"}</span>
                  </button>
                </div>
              </form>
            )}

            {/* List of active templates */}
            {templates.length === 0 ? (
              <div className="p-8 text-center bg-white/5 border border-dashed border-white/10 rounded-xl text-slate-400 text-xs">
                No custom SMS templates created yet. Click "Create Template" to add your first template.
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {templates.map((tpl) => (
                  <div
                    key={tpl.id}
                    className="p-4 bg-white/5 border border-white/10 rounded-xl hover:border-white/20 transition-all flex flex-col justify-between"
                  >
                    <div className="space-y-2">
                      <div className="flex justify-between items-start gap-2">
                        <h4 className="font-bold text-sm text-slate-200 truncate">{tpl.title}</h4>
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            onClick={() => {
                              setEditingTemplateId(tpl.id);
                              setNewTemplateTitle(tpl.title);
                              setNewTemplateContent(tpl.content);
                              setShowAddTemplateForm(true);
                              setTimeout(() => {
                                document.getElementById("sms-template-form")?.scrollIntoView({ behavior: "smooth", block: "center" });
                              }, 100);
                            }}
                            className="p-1 hover:bg-white/10 text-slate-400 hover:text-indigo-400 rounded transition-colors cursor-pointer"
                            title="Edit template"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handleDeleteTemplateInSettings(tpl.id)}
                            className="p-1 hover:bg-white/10 text-slate-400 hover:text-rose-400 rounded transition-colors cursor-pointer"
                            title="Delete template"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                      <p className="text-xs text-slate-400 bg-black/15 p-2.5 rounded-lg font-mono border border-white/5 leading-relaxed break-words whitespace-pre-wrap">
                        {tpl.content}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Review Center Container */}
          <div className="glass-card rounded-xl p-6 shadow-lg space-y-6">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-white/5 pb-4">
              <div>
                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                  <ShieldAlert className="w-5 h-5 text-indigo-400 animate-pulse" />
                  Database Review Center & Decision Log
                </h3>
                <p className="text-xs text-slate-400 mt-1 max-w-2xl leading-relaxed">
                  Review differences between uploaded worker lists and your manual CRM edits. Keep your manual updates secure by deciding which changes to allow (Yes), skip (No), or block permanently (NEVER).
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={fetchConflicts}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-300 hover:text-white bg-white/5 border border-white/10 rounded-lg transition-all cursor-pointer shadow-sm"
                >
                  <RefreshCw className="w-3 h-3" />
                  Sync Log
                </button>
                <button
                  onClick={clearResolvedLogs}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-rose-300 hover:text-rose-200 bg-rose-500/10 border border-rose-500/20 rounded-lg transition-all cursor-pointer shadow-sm"
                >
                  <Trash2 className="w-3 h-3" />
                  Clear Decision History
                </button>
              </div>
            </div>

            {/* Pending Decisions Section */}
            <div className="space-y-4">
              <h4 className="text-xs font-extrabold text-amber-400 uppercase tracking-wider flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                Pending Decisions ({conflicts.filter(c => c.status === "pending").length})
              </h4>

              {conflictsLoading ? (
                <div className="text-center py-12 text-slate-500 text-sm">
                  <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-indigo-400" />
                  Loading sync logs...
                </div>
              ) : conflicts.filter(c => c.status === "pending").length === 0 ? (
                <div className="p-10 text-center bg-white/5 border border-white/5 rounded-xl text-slate-400 space-y-1">
                  <CheckCircle className="w-8 h-8 text-emerald-400 mx-auto mb-2 animate-bounce" />
                  <p className="font-bold text-sm text-slate-300">All caught up!</p>
                  <p className="text-xs">No pending conflicts found. Existing CRM edits are completely preserved.</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-4">
                  {conflicts.filter(c => c.status === "pending").map((conflict) => (
                    <div 
                      key={conflict.id}
                      className="p-5 bg-white/5 border border-white/10 rounded-xl space-y-4 hover:border-white/20 transition-all shadow-md relative overflow-hidden"
                    >
                      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="bg-indigo-500/10 text-indigo-400 text-[10px] font-bold px-2 py-0.5 rounded-md border border-indigo-500/20 uppercase tracking-wider">
                              {conflict.sheetType === "worker_history" ? "History Report" : "Search Results"}
                            </span>
                            {conflict.field === "Presence" && (
                              <span className="bg-rose-500/20 text-rose-300 text-[10px] font-bold px-2 py-0.5 rounded-md border border-rose-500/30 uppercase tracking-wider">
                                Volunteer Status
                              </span>
                            )}
                          </div>
                          <h5 className="font-extrabold text-base text-white mt-1.5 flex items-center gap-2">
                            <User className="w-4 h-4 text-slate-400" />
                            {conflict.workerName}
                          </h5>
                        </div>
                        <span className="text-xs text-slate-400">
                          Field: <strong className="text-indigo-300 font-semibold uppercase tracking-wider text-[11px] bg-indigo-500/10 px-2 py-0.5 rounded-md border border-indigo-500/20">{conflict.field}</strong>
                        </span>
                      </div>

                      {/* Side by side comparison */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-black/20 p-4 rounded-lg border border-white/5 text-sm">
                        <div className="space-y-1">
                          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Existing CRM Value:</span>
                          <span className="font-medium text-slate-300">
                            {conflict.existingValue ? (
                              conflict.existingValue
                            ) : (
                              <span className="text-slate-600 italic text-xs">empty</span>
                            )}
                          </span>
                        </div>
                        <div className="space-y-1 sm:border-l sm:border-white/5 sm:pl-4">
                          <span className="text-[10px] font-bold text-indigo-400 uppercase tracking-wider block">Incoming PDF Value:</span>
                          <span className="font-bold text-white">
                            {conflict.incomingValue ? (
                              conflict.incomingValue
                            ) : (
                              <span className="text-slate-600 italic text-xs">empty</span>
                            )}
                          </span>
                        </div>
                      </div>

                      {/* Actions */}
                      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 pt-1 border-t border-white/5 mt-2">
                        <span className="text-[11px] text-slate-400 leading-relaxed max-w-md">
                          {conflict.field === "Presence" 
                            ? "Accepting (Yes) will delete this contact from your CRM directory, rejecting (No) keeps them active."
                            : "Accepting (Yes) will overwrite the field. Rejecting (No) keeps your manual edits secure."
                          }
                        </span>
                        <div className="flex gap-2 self-end sm:self-center shrink-0">
                          <button
                            onClick={() => handleResolveConflict(conflict, "yes")}
                            className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-lg cursor-pointer transition-all flex items-center gap-1 shadow-xs"
                          >
                            <Check className="w-3.5 h-3.5" />
                            Yes, Apply
                          </button>
                          <button
                            onClick={() => handleResolveConflict(conflict, "no")}
                            className="px-3.5 py-1.5 bg-white/5 hover:bg-white/10 text-slate-300 hover:text-white text-xs font-bold rounded-lg cursor-pointer transition-all flex items-center gap-1 border border-white/10"
                          >
                            <X className="w-3.5 h-3.5" />
                            No, Skip
                          </button>
                          <button
                            onClick={() => handleResolveConflict(conflict, "never")}
                            className="px-3 py-1.5 bg-red-500/10 hover:bg-red-500/20 text-red-300 hover:text-red-200 text-xs font-bold rounded-lg cursor-pointer transition-all border border-red-500/25"
                            title="Never prompt or overwrite this field or contact again"
                          >
                            NEVER OVERWRITE
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Resolved History / Decisions Logs Section */}
            <div className="space-y-3 pt-4 border-t border-white/5">
              <h4 className="text-xs font-extrabold text-slate-400 uppercase tracking-wider">
                Decision History & Auto-Applied Activity Log ({conflicts.filter(c => c.status !== "pending").length})
              </h4>
              {conflicts.filter(c => c.status !== "pending").length === 0 ? (
                <p className="text-xs text-slate-500 italic">No historical changes logged yet in this session.</p>
              ) : (
                <div className="max-h-64 overflow-y-auto divide-y divide-white/5 border border-white/5 rounded-lg bg-black/15 text-xs">
                  {conflicts.filter(c => c.status !== "pending").map((log) => (
                    <div key={log.id} className="p-3 flex justify-between items-center gap-4 hover:bg-white/5">
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-2">
                          <strong className="text-slate-200">{log.workerName}</strong>
                          <span className="text-[10px] text-slate-400 font-mono">({log.field})</span>
                          <span className="text-[9px] bg-white/5 text-slate-500 px-1.5 py-0.2 rounded-md">
                            {log.sheetType === "worker_history" ? "History" : "Search"}
                          </span>
                        </div>
                        <p className="text-slate-400 leading-normal">
                          Value: <strong className="text-indigo-300 font-semibold">"{log.incomingValue}"</strong>
                          {log.existingValue && log.existingValue !== "(None - Not in CRM)" && (
                            <span className="text-slate-500"> (was "{log.existingValue}")</span>
                          )}
                        </p>
                      </div>
                      <div className="text-right">
                        <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold ${
                          log.status === "applied" 
                            ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" 
                            : "bg-white/5 text-slate-400 border border-white/5"
                        }`}>
                          {log.status === "applied" ? "Overwritten" : "Preserved / Skipped"}
                        </span>
                        <div className="text-[9px] text-slate-500 mt-1 font-mono">
                          {log.updatedAt?.seconds ? new Date(log.updatedAt.seconds * 1000).toLocaleTimeString() : "Resolved"}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
