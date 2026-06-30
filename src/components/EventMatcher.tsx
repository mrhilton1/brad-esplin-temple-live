import React, { useEffect, useState, useRef } from "react";
import { 
  Calendar, Clock, Users, Check, AlertTriangle, Trash2, RefreshCw, 
  Search, ShieldAlert, ArrowRight, UserCheck, AlertCircle, Info,
  CheckCircle, Plus, Sparkles, MapPin, Bookmark, X, User, ChevronDown,
  CheckSquare, Square, Filter, MessageSquare, Copy, Edit3, Save, Printer
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import {
  collection, db, deleteDoc, doc, getDoc, getDocs, serverTimestamp, setDoc, updateDoc,
} from "../lib/dataStore";

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

const parseEventTimeMinutes = (timeStr: string): number => {
  const match = String(timeStr || "").trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!match) return Number.MAX_SAFE_INTEGER;

  let hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  const period = match[3].toUpperCase();

  if (period === "PM" && hours < 12) {
    hours += 12;
  } else if (period === "AM" && hours === 12) {
    hours = 0;
  }

  return hours * 60 + minutes;
};

const compareEventsByDateTime = (a: EventRecord, b: EventRecord): number => {
  const dateA = parseDateString(a.date)?.getTime() || 0;
  const dateB = parseDateString(b.date)?.getTime() || 0;
  if (dateA !== dateB) return dateA - dateB;

  const timeA = parseEventTimeMinutes(a.time);
  const timeB = parseEventTimeMinutes(b.time);
  if (timeA !== timeB) return timeA - timeB;

  return (a.guests || a.id || "").localeCompare(b.guests || b.id || "");
};

const eventNeedsLsg = (event: EventRecord): boolean => {
  return !!(
    !event.completed &&
    event.status !== "deleted" &&
    event.status !== "changed" &&
    event.assignedCsgId &&
    (!event.assignedLsgId || !event.assignedGroomLsgId)
  );
};

const eventNeedsCsg = (event: EventRecord): boolean => {
  return !!(
    !event.completed &&
    event.status !== "deleted" &&
    event.status !== "changed" &&
    event.assignedLsgId &&
    event.assignedGroomLsgId &&
    !event.assignedCsgId
  );
};

const eventHasAssignedWorkers = (event: EventRecord): boolean => {
  return !!(event.assignedLsgId || event.assignedGroomLsgId || event.assignedCsgId);
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

const formatDateFriendly = (d: Date | null): string => {
  if (!d) return "";
  const day = d.getDate();
  const monthNamesShort = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const month = monthNamesShort[d.getMonth()];
  const year = d.getFullYear();
  return `${day} ${month} ${year}`;
};

// Calculate dynamic arrival times relative to the event's start time
const calculateArrivalTime = (timeStr: string, minutesBefore: number): string => {
  if (!timeStr) return "";
  
  const match = timeStr.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!match) return "";
  
  let [_, hoursStr, minutesStr, ampm] = match;
  let hours = parseInt(hoursStr, 10);
  const minutes = parseInt(minutesStr, 10);
  
  if (ampm.toUpperCase() === "PM" && hours < 12) {
    hours += 12;
  } else if (ampm.toUpperCase() === "AM" && hours === 12) {
    hours = 0;
  }
  
  let totalMinutes = hours * 60 + minutes - minutesBefore;
  if (totalMinutes < 0) {
    totalMinutes += 24 * 60; // wrap around
  }
  
  const newHours24 = Math.floor(totalMinutes / 60) % 24;
  const newMinutes = totalMinutes % 60;
  
  const newAmpm = newHours24 >= 12 ? "PM" : "AM";
  let newHours12 = newHours24 % 12;
  if (newHours12 === 0) newHours12 = 12;
  
  return `${newHours12}:${String(newMinutes).padStart(2, "0")} ${newAmpm}`;
};

// Formatter to create display title: [Last Name 1] & [Last Name 2] Sealing | D MMM YYYY | Time
const getEventTitle = (guestsStr: string, dateStr: string, timeStr: string) => {
  let namePart = "Guests";
  if (guestsStr) {
    const list = guestsStr.split(";").map(g => g.trim()).filter(Boolean);
    const lastNames = list.map(g => {
      const parts = g.split(",");
      return parts[0].trim();
    });
    if (lastNames.length >= 2) {
      namePart = `${lastNames[0]} & ${lastNames[1]}`;
    } else if (lastNames.length === 1) {
      namePart = lastNames[0];
    }
  }

  // Format Date to "1 Aug 2026"
  let datePart = dateStr;
  const d = parseDateString(dateStr);
  if (d) {
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    datePart = `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
  }

  // Ensure word "Sealing" is always in the title as requested by the user
  return `${namePart} Sealing | ${datePart} | ${timeStr}`;
};

interface EventRecord {
  id: string;
  date: string;
  time: string;
  room: string;
  type: string;
  guests: string;
  assignedLsgId: string;
  assignedGroomLsgId?: string;
  assignedCsgId: string;
  status: "unassigned" | "assigned" | "changed" | "deleted";
  completed?: boolean;
  completedAt?: any;
  updatedAt?: any;
  lsgConfirmed?: boolean;
  groomLsgConfirmed?: boolean;
  csgConfirmed?: boolean;
  lsgReminded?: boolean;
  groomLsgReminded?: boolean;
  csgReminded?: boolean;
}

interface TextTemplate {
  id: string;
  title: string;
  content: string;
  createdAt?: any;
  updatedAt?: any;
}

interface SearchableWorkerSelectProps {
  value: string;
  onChange: (id: string) => void;
  workers: any[];
  placeholder: string;
  disabled?: boolean;
}

// Custom Searchable Dropdown Combobox Component with instant Clear
function SearchableWorkerSelect({ value, onChange, workers, placeholder, disabled }: SearchableWorkerSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  
  const selectedWorker = workers.find(w => w.id === value);
  const displayValue = selectedWorker ? selectedWorker["Worker Name"] : "";

  // Filter workers dynamically based on query
  const filteredWorkers = workers.filter(w => {
    const name = (w["Worker Name"] || "").toLowerCase();
    const query = searchQuery.toLowerCase();
    return name.includes(query);
  });

  return (
    <div className="relative inline-block text-left">
      <div className="flex items-center gap-1">
        <div className="relative flex items-center">
          <input
            type="text"
            disabled={disabled}
            value={isOpen ? searchQuery : displayValue}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              if (!isOpen) setIsOpen(true);
            }}
            onFocus={() => {
              setSearchQuery("");
              setIsOpen(true);
            }}
            placeholder={placeholder}
            className="px-2.5 py-1 text-xs text-white bg-slate-900/80 border border-white/10 rounded-md focus:outline-hidden focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400 w-[140px] xs:w-[150px] sm:w-[170px] pr-8 truncate disabled:opacity-40 disabled:cursor-not-allowed transition-all font-mono"
          />
          
          {/* Clear button or trigger chevron */}
          {value ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onChange("");
                setSearchQuery("");
                setIsOpen(false);
              }}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-red-400 p-0.5 rounded-full hover:bg-white/10 transition-all cursor-pointer"
              title="Clear selection"
            >
              <X className="w-3 h-3" />
            </button>
          ) : (
            <ChevronDown className="w-3.5 h-3.5 absolute right-2.5 text-slate-500 pointer-events-none" />
          )}
        </div>
      </div>

      {isOpen && (
        <>
          {/* Backdrop click dismiss */}
          <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />
          
          <div className="absolute left-0 mt-1 w-[200px] max-h-[180px] overflow-y-auto bg-slate-950 border border-white/15 rounded-md shadow-2xl z-50 py-1 scrollbar-thin">
            {filteredWorkers.length === 0 ? (
              <div className="px-3 py-2 text-[11px] text-slate-500 italic">No workers found</div>
            ) : (
              filteredWorkers.map((worker) => {
                const labels = (worker["Labels"] || "").toLowerCase();
                const isCertifiedLsg = labels.includes("lsg");
                const isCertifiedCsg = labels.includes("csg");
                return (
                  <button
                    key={worker.id}
                    type="button"
                    onClick={() => {
                      onChange(worker.id);
                      setIsOpen(false);
                      setSearchQuery("");
                    }}
                    className={`w-full text-left px-2.5 py-1.5 text-xs hover:bg-indigo-600 hover:text-white transition-all flex items-center justify-between gap-1 cursor-pointer ${
                      worker.id === value ? "bg-indigo-600/30 text-white font-bold" : "text-slate-200"
                    }`}
                  >
                    <span className="truncate">{worker["Worker Name"]}</span>
                    {(isCertifiedLsg || isCertifiedCsg) && (
                      <span className="text-[9px] bg-emerald-500/20 text-emerald-300 font-bold px-1 rounded shrink-0 font-mono">
                        Cert
                      </span>
                    )}
                  </button>
                );
              })
            )}
          </div>
        </>
      )}
    </div>
  );
}

export default function EventMatcher() {
  const [events, setEvents] = useState<EventRecord[]>([]);
  const [contacts, setContacts] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [dateRangeStart, setDateRangeStart] = useState<Date | null>(null);
  const [dateRangeEnd, setDateRangeEnd] = useState<Date | null>(null);
  const [dateQuickFilter, setDateQuickFilter] = useState<"weekends" | null>("weekends");
  const [expandedEventIds, setExpandedEventIds] = useState<Record<string, boolean>>({});
  const [selectedPrintEventIds, setSelectedPrintEventIds] = useState<Set<string>>(new Set());
  const [syncStatus, setSyncStatus] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [isSyncingStats, setIsSyncingStats] = useState(false);

  // session edited IDs to avoid records disappearing on filter change (Option A)
  const [sessionEditedIds, setSessionEditedIds] = useState<Set<string>>(new Set());
  const [showStatusDropdown, setShowStatusDropdown] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [calMonth, setCalMonth] = useState<number>(new Date().getMonth());
  const [calYear, setCalYear] = useState<number>(new Date().getFullYear());

  // --- SMS Templates and Tooling States ---
  const [templates, setTemplates] = useState<TextTemplate[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("");
  const [selectedWorkerRole, setSelectedWorkerRole] = useState<"lsg" | "groom_lsg" | "csg" | "">("");
  const [isTextingModalOpen, setIsTextingModalOpen] = useState<boolean>(false);
  const [textingEvent, setTextingEvent] = useState<EventRecord | null>(null);
  const [customMessageBody, setCustomMessageBody] = useState<string>("");
  const [isManagingTemplates, setIsManagingTemplates] = useState<boolean>(false);
  const [isCopied, setIsCopied] = useState<boolean>(false);

  // Template editor states
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null);
  const [newTemplateTitle, setNewTemplateTitle] = useState<string>("");
  const [newTemplateContent, setNewTemplateContent] = useState<string>("");

  const templateTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const messageTextareaRef = useRef<HTMLTextAreaElement | null>(null);

  const handleInsertTemplateTextAtCursor = (textToInsert: string) => {
    const textarea = templateTextareaRef.current;
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

  const handleInsertMessageTextAtCursor = (textToInsert: string) => {
    const textarea = messageTextareaRef.current;
    if (!textarea) {
      setCustomMessageBody(prev => prev + textToInsert);
      return;
    }

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const text = textarea.value;
    const before = text.substring(0, start);
    const after = text.substring(end, text.length);

    setCustomMessageBody(before + textToInsert + after);

    setTimeout(() => {
      textarea.focus();
      const newCursorPos = start + textToInsert.length;
      textarea.setSelectionRange(newCursorPos, newCursorPos);
    }, 10);
  };

  // Load Templates from Supabase
  const loadTemplates = async () => {
    try {
      const templatesSnap = await getDocs(collection(db, "text_templates"));
      const list: TextTemplate[] = [];
      templatesSnap.forEach((docSnap) => {
        list.push({ id: docSnap.id, ...docSnap.data() } as TextTemplate);
      });

      if (list.length === 0) {
        // Seed default templates
        const defaults = [
          {
            title: "LSG Arrival Reminder",
            content: "Hi {worker_name}, this is a reminder for the {title} on {date}. Your LSG arrival time is {lsg_arrival}. The ceremony starts at {time}. See you there!"
          },
          {
            title: "CSG Arrival Reminder",
            content: "Hi {worker_name}, this is a reminder for the {title} on {date}. Your CSG arrival time is {csg_arrival}. The ceremony starts at {time}. See you there!"
          },
          {
            title: "General Reminder",
            content: "Hi {worker_name}, this is a reminder that you are scheduled as {role} for the {title} on {date} at {time}. Please let us know if you have any questions."
          }
        ];

        for (const t of defaults) {
          const newDocRef = doc(collection(db, "text_templates"));
          await setDoc(newDocRef, {
            ...t,
            createdAt: serverTimestamp()
          });
          list.push({ id: newDocRef.id, ...t });
        }
      }

      list.sort((a, b) => a.title.localeCompare(b.title));
      setTemplates(list);
      if (list.length > 0) {
        setSelectedTemplateId(list[0].id);
      }
    } catch (err) {
      console.error("Failed to load text templates:", err);
    }
  };

  // Save/Update Text Template
  const handleSaveTemplate = async () => {
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
      setIsManagingTemplates(false);
      await loadTemplates();
    } catch (err) {
      console.error("Failed to save template:", err);
    }
  };

  // Delete Text Template
  const handleDeleteTemplate = async (id: string) => {
    try {
      await deleteDoc(doc(db, "text_templates", id));
      await loadTemplates();
    } catch (err) {
      console.error("Failed to delete template:", err);
    }
  };

  // Helper to replace placeholders with dynamic event/worker data
  const getMergedMessage = (templateContent: string, event: EventRecord, workerRole: "lsg" | "groom_lsg" | "csg" | "") => {
    if (!event) return "";
    let workerName = "Worker";
    let roleLabel = "Worker";

    if (workerRole === "lsg") {
      const contact = contacts.find(c => c.id === event.assignedLsgId);
      workerName = contact ? contact["Worker Name"] : "Bride LSG";
      roleLabel = "Bride LSG";
    } else if (workerRole === "groom_lsg") {
      const contact = contacts.find(c => c.id === event.assignedGroomLsgId);
      workerName = contact ? contact["Worker Name"] : "Groom LSG";
      roleLabel = "Groom LSG";
    } else if (workerRole === "csg") {
      const contact = contacts.find(c => c.id === event.assignedCsgId);
      workerName = contact ? contact["Worker Name"] : "CSG Worker";
      roleLabel = "CSG Worker";
    }

    const lsgArrival = calculateArrivalTime(event.time, 90);
    const brideAndGroomArrival = calculateArrivalTime(event.time, 75);
    const csgArrival = calculateArrivalTime(event.time, 60);
    
    // Helper to extract first name (after comma) if available
    const extractFirstNameFromContactName = (nameString: string) => {
      if (!nameString) return "";
      if (nameString.includes(",")) {
        const parts = nameString.split(",");
        if (parts.length > 1 && parts[1].trim()) {
          return parts[1].trim();
        }
      }
      return nameString;
    };

    let workerFirstName = extractFirstNameFromContactName(workerName);
    
    // Parse Date nicely
    let dateText = event.date;
    const d = parseDateString(event.date);
    if (d) {
      const weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
      const fullMonths = [
        "January", "February", "March", "April", "May", "June", 
        "July", "August", "September", "October", "November", "December"
      ];
      dateText = `${weekdays[d.getDay()]}, ${fullMonths[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
    }

    let namePart = "Guests";
    if (event.guests) {
      const list = event.guests.split(";").map(g => g.trim()).filter(Boolean);
      const lastNames = list.map(g => {
        const parts = g.split(",");
        return parts[0].trim();
      });
      if (lastNames.length >= 2) {
        namePart = `${lastNames[0]} & ${lastNames[1]}`;
      } else if (lastNames.length === 1) {
        namePart = lastNames[0];
      }
    }
    const recordTitle = `${namePart} Sealing`;

    // Extract first names for specific roles
    const brideLsgContact = event.assignedLsgId ? contacts.find(c => c.id === event.assignedLsgId) : null;
    const groomLsgContact = event.assignedGroomLsgId ? contacts.find(c => c.id === event.assignedGroomLsgId) : null;
    const csgContactRecord = event.assignedCsgId ? contacts.find(c => c.id === event.assignedCsgId) : null;

    const lsgBrideFirst = brideLsgContact ? extractFirstNameFromContactName(brideLsgContact["Worker Name"]) : "";
    const lsgGroomFirst = groomLsgContact ? extractFirstNameFromContactName(groomLsgContact["Worker Name"]) : "";
    const csgFirst = csgContactRecord ? extractFirstNameFromContactName(csgContactRecord["Worker Name"]) : "";

    return templateContent
      .replace(/{worker_name}/g, workerFirstName)
      .replace(/{role}/g, roleLabel)
      .replace(/{title}/g, recordTitle)
      .replace(/{date}/g, dateText)
      .replace(/{time}/g, event.time)
      .replace(/{lsg_arrival}/g, lsgArrival)
      .replace(/{csg_arrival}/g, csgArrival)
      .replace(/{bride_and_groom_arrival}/g, brideAndGroomArrival)
      .replace(/{lsg_bride_first}/g, lsgBrideFirst)
      .replace(/{lsg_groom_first}/g, lsgGroomFirst)
      .replace(/{csg_first}/g, csgFirst);
  };

  const getWorkerContact = (role: "lsg" | "groom_lsg" | "csg" | ""): any | null => {
    if (!textingEvent || !role) return null;
    const id = role === "lsg" ? textingEvent.assignedLsgId 
             : role === "groom_lsg" ? textingEvent.assignedGroomLsgId 
             : textingEvent.assignedCsgId;
    if (!id) return null;
    return contacts.find(c => c.id === id) || null;
  };

  const getContactPhone = (contact: any): string => {
    if (!contact) return "";
    const prefType = String(contact["Preferred Phone Type"] || "").toLowerCase();
    if (prefType === "personal") {
      return contact["Personal Phone"] || contact["Household Phone"] || "";
    } else if (prefType === "household") {
      return contact["Household Phone"] || contact["Personal Phone"] || "";
    }
    return contact["Personal Phone"] || contact["Household Phone"] || "";
  };

  // Clear session edits when filter changes so the user can re-filter freshly
  useEffect(() => {
    setSessionEditedIds(new Set());
  }, [statusFilter, dateRangeStart, dateRangeEnd, dateQuickFilter, searchTerm]);

  // Load events and contacts from Supabase
  const loadData = async () => {
    setIsLoading(true);
    try {
      // Load Events
      const eventsSnap = await getDocs(collection(db, "events"));
      const eventsList: EventRecord[] = [];
      eventsSnap.forEach((docSnap) => {
        eventsList.push({ id: docSnap.id, ...docSnap.data() } as EventRecord);
      });
      
      eventsList.sort(compareEventsByDateTime);
      setEvents(eventsList);

      // Load Contacts
      const contactsSnap = await getDocs(collection(db, "crm_contacts"));
      const contactsList: any[] = [];
      contactsSnap.forEach((docSnap) => {
        contactsList.push({ id: docSnap.id, ...docSnap.data() });
      });
      setContacts(contactsList);
    } catch (err) {
      console.error("Error loading Event Matcher data:", err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    loadTemplates();
  }, []);

  useEffect(() => {
    if (events.length > 0) {
      const firstEvent = events.find(e => !isDateInPast(e.date)) || events[0];
      const parsed = parseDateString(firstEvent.date);
      if (parsed) {
        setCalMonth(parsed.getMonth());
        setCalYear(parsed.getFullYear());
      }
    }
  }, [events]);

  // Extract unique dates from loaded events to populate date filter dropdown
  const uniqueDates = Array.from(new Set(events.map(e => e.date))).sort((a: string, b: string) => {
    const timeA = parseDateString(a)?.getTime() || 0;
    const timeB = parseDateString(b)?.getTime() || 0;
    return timeA - timeB;
  });

  // Update event assignment in Supabase
  const handleAssignWorker = async (eventId: string, role: "lsg" | "groom_lsg" | "csg", contactId: string) => {
    try {
      const eventRef = doc(db, "events", eventId);
      let field: "assignedLsgId" | "assignedGroomLsgId" | "assignedCsgId";
      let confirmField: "lsgConfirmed" | "groomLsgConfirmed" | "csgConfirmed";
      let remindedField: "lsgReminded" | "groomLsgReminded" | "csgReminded";
      if (role === "lsg") {
        field = "assignedLsgId";
        confirmField = "lsgConfirmed";
        remindedField = "lsgReminded";
      } else if (role === "groom_lsg") {
        field = "assignedGroomLsgId";
        confirmField = "groomLsgConfirmed";
        remindedField = "groomLsgReminded";
      } else {
        field = "assignedCsgId";
        confirmField = "csgConfirmed";
        remindedField = "csgReminded";
      }
      
      // Find the event
      const eventIndex = events.findIndex(e => e.id === eventId);
      if (eventIndex === -1) return;
      const updatedEvent = { ...events[eventIndex] };
      updatedEvent[field] = contactId;
      // Reset communication states if changing assignment.
      updatedEvent[confirmField] = false;
      updatedEvent[remindedField] = false;

      // Automatically compute status based on user's custom pending assignment logic:
      // All three assigned = Covered (Green)
      // Otherwise = Pending Assignment (Default gray)
      if (updatedEvent.status !== "deleted" && updatedEvent.status !== "changed") {
        if (updatedEvent.assignedLsgId && updatedEvent.assignedGroomLsgId && updatedEvent.assignedCsgId) {
          updatedEvent.status = "assigned"; // Covered
        } else {
          updatedEvent.status = "unassigned"; // Pending Assignment
        }
      }

      await updateDoc(eventRef, {
        [field]: contactId,
        [confirmField]: false,
        [remindedField]: false,
        status: updatedEvent.status,
        updatedAt: serverTimestamp()
      });

      // Add to session edited set to prevent disappearing records under current filter (Option A)
      setSessionEditedIds(prev => {
        const next = new Set(prev);
        next.add(eventId);
        return next;
      });

      // Update local state
      const nextEvents = [...events];
      nextEvents[eventIndex] = updatedEvent;
      setEvents(nextEvents);
    } catch (err) {
      console.error("Failed to update event assignment:", err);
    }
  };

  // Toggle confirmation status in Supabase
  const handleToggleConfirm = async (eventId: string, role: "lsg" | "groom_lsg" | "csg", currentValue: boolean) => {
    try {
      const eventRef = doc(db, "events", eventId);
      let confirmField: "lsgConfirmed" | "groomLsgConfirmed" | "csgConfirmed";
      if (role === "lsg") {
        confirmField = "lsgConfirmed";
      } else if (role === "groom_lsg") {
        confirmField = "groomLsgConfirmed";
      } else {
        confirmField = "csgConfirmed";
      }

      const newValue = !currentValue;

      // Find the event
      const eventIndex = events.findIndex(e => e.id === eventId);
      if (eventIndex === -1) return;
      const updatedEvent = { ...events[eventIndex] };
      updatedEvent[confirmField] = newValue;

      await updateDoc(eventRef, {
        [confirmField]: newValue,
        updatedAt: serverTimestamp()
      });

      // Add to session edited set to prevent disappearing records
      setSessionEditedIds(prev => {
        const next = new Set(prev);
        next.add(eventId);
        return next;
      });

      // Update local state
      const nextEvents = [...events];
      nextEvents[eventIndex] = updatedEvent;
      setEvents(nextEvents);
    } catch (err) {
      console.error("Failed to toggle confirmation status:", err);
    }
  };

  // Toggle reminder status in Supabase
  const handleToggleReminder = async (eventId: string, role: "lsg" | "groom_lsg" | "csg", currentValue: boolean) => {
    try {
      const eventRef = doc(db, "events", eventId);
      let remindedField: "lsgReminded" | "groomLsgReminded" | "csgReminded";
      if (role === "lsg") {
        remindedField = "lsgReminded";
      } else if (role === "groom_lsg") {
        remindedField = "groomLsgReminded";
      } else {
        remindedField = "csgReminded";
      }

      const newValue = !currentValue;

      const eventIndex = events.findIndex(e => e.id === eventId);
      if (eventIndex === -1) return;
      const updatedEvent = { ...events[eventIndex] };
      updatedEvent[remindedField] = newValue;

      await updateDoc(eventRef, {
        [remindedField]: newValue,
        updatedAt: serverTimestamp()
      });

      setSessionEditedIds(prev => {
        const next = new Set(prev);
        next.add(eventId);
        return next;
      });

      const nextEvents = [...events];
      nextEvents[eventIndex] = updatedEvent;
      setEvents(nextEvents);
    } catch (err) {
      console.error("Failed to toggle reminder status:", err);
    }
  };

  // Complete Event & Increment Worker Stats
  const handleCompleteEvent = async (event: EventRecord) => {
    try {
      const eventRef = doc(db, "events", event.id);
      
      // Mark event as completed in database
      await updateDoc(eventRef, {
        completed: true,
        completedAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });

      let updatedWorkersInfo: string[] = [];

      // 1. If Bride LSG assigned, increment statistics as LSG
      if (event.assignedLsgId) {
        const workerRef = doc(db, "crm_contacts", event.assignedLsgId);
        const workerSnap = await getDoc(workerRef);
        if (workerSnap.exists()) {
          const wData = workerSnap.data();
          const currentTotal = parseInt(wData["Total LSG"] || "0", 10) || 0;
          const newTotal = currentTotal + 1;
          
          await updateDoc(workerRef, {
            "Total LSG": newTotal.toString(),
            "Last LSG": event.date,
            "updatedAt": serverTimestamp()
          });
          updatedWorkersInfo.push(`${wData["Worker Name"] || "Bride LSG"} (+1 LSG, Last: ${event.date})`);
        }
      }

      // 2. If Groom LSG assigned, ALSO increment statistics as LSG
      if (event.assignedGroomLsgId) {
        const workerRef = doc(db, "crm_contacts", event.assignedGroomLsgId);
        const workerSnap = await getDoc(workerRef);
        if (workerSnap.exists()) {
          const wData = workerSnap.data();
          const currentTotal = parseInt(wData["Total LSG"] || "0", 10) || 0;
          const newTotal = currentTotal + 1;

          await updateDoc(workerRef, {
            "Total LSG": newTotal.toString(),
            "Last LSG": event.date,
            "updatedAt": serverTimestamp()
          });
          updatedWorkersInfo.push(`${wData["Worker Name"] || "Groom LSG"} (+1 LSG, Last: ${event.date})`);
        }
      }

      // 3. If CSG Worker assigned, increment statistics as CSG
      if (event.assignedCsgId) {
        const workerRef = doc(db, "crm_contacts", event.assignedCsgId);
        const workerSnap = await getDoc(workerRef);
        if (workerSnap.exists()) {
          const wData = workerSnap.data();
          const currentTotal = parseInt(wData["Total CSG"] || "0", 10) || 0;
          const newTotal = currentTotal + 1;

          await updateDoc(workerRef, {
            "Total CSG": newTotal.toString(),
            "Last CSG": event.date,
            "updatedAt": serverTimestamp()
          });
          updatedWorkersInfo.push(`${wData["Worker Name"] || "CSG Worker"} (+1 CSG, Last: ${event.date})`);
        }
      }

      // Add to session edited set to prevent disappearing records under current filter (Option A)
      setSessionEditedIds(prev => {
        const next = new Set(prev);
        next.add(event.id);
        return next;
      });

      // Update local state
      setEvents(prev => prev.map(e => e.id === event.id ? { ...e, completed: true } : e));

      // Show friendly confirmation banner
      const namesJoined = updatedWorkersInfo.join(" and ");
      setSyncStatus({
        type: "success",
        message: `Event completed successfully! Checked off ordinance and incremented activity statistics for: ${namesJoined || "No assigned workers to log"}.`
      });
      setTimeout(() => setSyncStatus(null), 8000);
    } catch (err) {
      console.error("Failed to complete event:", err);
      setSyncStatus({
        type: "error",
        message: "Failed to mark event as completed."
      });
    }
  };

  // Reconfirm changed details (clear yellow warning)
  const handleReconfirmEvent = async (eventId: string) => {
    try {
      const eventIndex = events.findIndex(e => e.id === eventId);
      if (eventIndex === -1) return;
      
      const updatedEvent = { ...events[eventIndex] };
      updatedEvent.status = (updatedEvent.assignedLsgId && updatedEvent.assignedGroomLsgId && updatedEvent.assignedCsgId) ? "assigned" : "unassigned";

      await updateDoc(doc(db, "events", eventId), {
        status: updatedEvent.status,
        updatedAt: serverTimestamp()
      });

      const nextEvents = [...events];
      nextEvents[eventIndex] = updatedEvent;
      setEvents(nextEvents);

      setSyncStatus({
        type: "success",
        message: "Successfully reconfirmed details with the assigned LSG. Status is now updated."
      });
      setTimeout(() => setSyncStatus(null), 4000);
    } catch (err) {
      console.error("Failed to reconfirm event details:", err);
    }
  };

  // Dismiss / Acknowledge Deleted Event. Assigned events stay visible as soft-deleted
  // so workers can still be messaged about the cancellation.
  const handleDeleteEvent = async (event: EventRecord) => {
    try {
      if (eventHasAssignedWorkers(event)) {
        await updateDoc(doc(db, "events", event.id), {
          status: "deleted",
          updatedAt: serverTimestamp()
        });
        setEvents(events.map(e => e.id === event.id ? { ...e, status: "deleted" } : e));
        setSyncStatus({
          type: "success",
          message: "Event kept as DELETED because workers are assigned. It will remain visible so you can message them about the cancellation."
        });
        setTimeout(() => setSyncStatus(null), 7000);
        return;
      }

      await deleteDoc(doc(db, "events", event.id));
      setEvents(events.filter(e => e.id !== event.id));
      setSyncStatus({
        type: "success",
        message: "Event deletion acknowledged. Removed from schedule list because no workers were assigned."
      });
      setTimeout(() => setSyncStatus(null), 4000);
    } catch (err) {
      console.error("Failed to delete event:", err);
      setSyncStatus({
        type: "error",
        message: "Failed to update deleted event status."
      });
    }
  };

  // Perform full historical statistics sync
  const handleSyncHistoricalStats = async () => {
    setIsSyncingStats(true);
    setSyncStatus(null);
    try {
      const eventsSnap = await getDocs(collection(db, "events"));
      const allEvents: EventRecord[] = [];
      eventsSnap.forEach(snap => {
        allEvents.push({ id: snap.id, ...snap.data() } as EventRecord);
      });

      const contactsSnap = await getDocs(collection(db, "crm_contacts"));
      const allContacts: any[] = [];
      contactsSnap.forEach(snap => {
        allContacts.push({ id: snap.id, ...snap.data() });
      });

      // Past events are dates before system baseline
      const pastEvents = allEvents.filter(e => isDateInPast(e.date));
      let updatedCount = 0;

      for (const contact of allContacts) {
        const contactId = contact.id;
        
        // Find past assignments
        const lsgAssignments = pastEvents.filter(e => e.assignedLsgId === contactId);
        const csgAssignments = pastEvents.filter(e => e.assignedCsgId === contactId);

        let latestLsgDate = "";
        let latestCsgDate = "";

        lsgAssignments.forEach(e => {
          if (!latestLsgDate) {
            latestLsgDate = e.date;
          } else {
            const timeA = parseDateString(e.date)?.getTime() || 0;
            const timeCurrent = parseDateString(latestLsgDate)?.getTime() || 0;
            if (timeA > timeCurrent) latestLsgDate = e.date;
          }
        });

        csgAssignments.forEach(e => {
          if (!latestCsgDate) {
            latestCsgDate = e.date;
          } else {
            const timeA = parseDateString(e.date)?.getTime() || 0;
            const timeCurrent = parseDateString(latestCsgDate)?.getTime() || 0;
            if (timeA > timeCurrent) latestCsgDate = e.date;
          }
        });

        const totalLsgCount = lsgAssignments.length;
        const totalCsgCount = csgAssignments.length;

        const currentLsg = parseInt(contact["Total LSG"] || "0", 10) || 0;
        const currentCsg = parseInt(contact["Total CSG"] || "0", 10) || 0;
        const currentLastLsg = contact["Last LSG"] || "";
        const currentLastCsg = contact["Last CSG"] || "";

        let needsUpdate = false;
        const updates: Record<string, any> = {};

        if (latestLsgDate && latestLsgDate !== currentLastLsg) {
          updates["Last LSG"] = latestLsgDate;
          needsUpdate = true;
        }
        if (latestCsgDate && latestCsgDate !== currentLastCsg) {
          updates["Last CSG"] = latestCsgDate;
          needsUpdate = true;
        }

        if (totalLsgCount > 0 && totalLsgCount.toString() !== currentLsg.toString()) {
          updates["Total LSG"] = totalLsgCount.toString();
          needsUpdate = true;
        }
        if (totalCsgCount > 0 && totalCsgCount.toString() !== currentCsg.toString()) {
          updates["Total CSG"] = totalCsgCount.toString();
          needsUpdate = true;
        }

        if (needsUpdate) {
          updates["updatedAt"] = serverTimestamp();
          await updateDoc(doc(db, "crm_contacts", contactId), updates);
          updatedCount++;
        }
      }

      setSyncStatus({
        type: "success",
        message: `Historical stats synchronization completed! Recalculated records from ${pastEvents.length} past events and updated ${updatedCount} workers' historical stats.`
      });
      
      await loadData();
    } catch (err: any) {
      console.error("Failed to sync stats:", err);
      setSyncStatus({
        type: "error",
        message: "Failed to sync historical stats: " + (err.message || "Unknown error")
      });
    } finally {
      setIsSyncingStats(false);
    }
  };

  // Sort contact list with priority to certified workers
  const getSortedWorkersForRole = (role: "LSG" | "CSG") => {
    return [...contacts].sort((a, b) => {
      const aLabels = (a["Labels"] || "").toLowerCase();
      const bLabels = (b["Labels"] || "").toLowerCase();
      const aHasRole = aLabels.includes(role.toLowerCase());
      const bHasRole = bLabels.includes(role.toLowerCase());
      if (aHasRole && !bHasRole) return -1;
      if (!aHasRole && bHasRole) return 1;
      return (a["Worker Name"] || "").localeCompare(b["Worker Name"] || "");
    });
  };

  const lsgWorkers = getSortedWorkersForRole("LSG");
  const csgWorkers = getSortedWorkersForRole("CSG");

  // Pre-calculate calendar events map for fast lookup
  const calendarEventsMap: Record<string, string> = {};
  events.forEach(e => {
    const parsed = parseDateString(e.date);
    if (parsed) {
      calendarEventsMap[parsed.toDateString()] = e.date;
    }
  });

  const monthNames = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
  ];

  const firstDayOfWeek = new Date(calYear, calMonth, 1).getDay(); // 0 = Sun
  const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
  
  const blankCells = Array(firstDayOfWeek).fill(null);
  const monthDays = Array.from({ length: daysInMonth }, (_, i) => new Date(calYear, calMonth, i + 1));
  const calendarCells = [...blankCells, ...monthDays];

  const handlePrevMonth = () => {
    if (calMonth === 0) {
      setCalMonth(11);
      setCalYear(prev => prev - 1);
    } else {
      setCalMonth(prev => prev - 1);
    }
  };

  const handleNextMonth = () => {
    if (calMonth === 11) {
      setCalMonth(0);
      setCalYear(prev => prev + 1);
    } else {
      setCalMonth(prev => prev + 1);
    }
  };

  const handleClearDateFilter = () => {
    setDateRangeStart(null);
    setDateRangeEnd(null);
    setDateQuickFilter(null);
    setShowDatePicker(false);
  };

  const handleWeekendDateFilter = () => {
    setDateRangeStart(null);
    setDateRangeEnd(null);
    setDateQuickFilter("weekends");
    setShowDatePicker(false);
  };

  const statusOptions = [
    { id: "all", label: "All Records" },
    { id: "upcoming", label: "Upcoming" },
    { id: "past", label: "Past (History)" },
    { id: "assigned", label: "🟢 Covered (Confirmed)" },
    { id: "awaiting_confirmation", label: "🟡 Awaiting Confirmation" },
    { id: "lsg_needed", label: "🟡 LSG Needed" },
    { id: "csg_needed", label: "🟡 CSG Needed" },
    { id: "unassigned", label: "🟡 Pending Assignments" },
    { id: "completed", label: "✓ Completed & Logged" },
    { id: "changed", label: "🟡 Changed" },
    { id: "deleted", label: "🔴 Deleted" }
  ];

  // Filter events based on search query, date dropdown, and status filter
  const filteredEvents = events.filter((e) => {
    // Search query match
    const s = searchTerm.toLowerCase().trim();
    const matchesSearch = 
      s === "" ||
      e.date.toLowerCase().includes(s) ||
      e.room.toLowerCase().includes(s) ||
      e.type.toLowerCase().includes(s) ||
      e.guests.toLowerCase().includes(s) ||
      (contacts.find(c => c.id === e.assignedLsgId)?.["Worker Name"] || "").toLowerCase().includes(s) ||
      (contacts.find(c => c.id === e.assignedGroomLsgId)?.["Worker Name"] || "").toLowerCase().includes(s) ||
      (contacts.find(c => c.id === e.assignedCsgId)?.["Worker Name"] || "").toLowerCase().includes(s);

    // Date Filter match (handles both single date and date range)
    const matchesDate = (() => {
      if (dateQuickFilter === "weekends") {
        const parsedEventDate = parseDateString(e.date);
        if (!parsedEventDate) return false;
        const day = parsedEventDate.getDay();
        return day === 5 || day === 6;
      }

      if (!dateRangeStart) return true;
      const parsedEventDate = parseDateString(e.date);
      if (!parsedEventDate) return false;

      const eventTime = new Date(parsedEventDate);
      eventTime.setHours(0, 0, 0, 0);

      const startCompare = new Date(dateRangeStart);
      startCompare.setHours(0, 0, 0, 0);

      if (!dateRangeEnd) {
        return eventTime.getTime() === startCompare.getTime();
      } else {
        const endCompare = new Date(dateRangeEnd);
        endCompare.setHours(0, 0, 0, 0);
        return eventTime.getTime() >= startCompare.getTime() && eventTime.getTime() <= endCompare.getTime();
      }
    })();

    // Status Filter match
    let matchesStatus = true;
    if (statusFilter === "deleted") {
      matchesStatus = e.status === "deleted";
    } else if (statusFilter === "changed") {
      matchesStatus = e.status === "changed";
    } else if (statusFilter === "assigned") {
      matchesStatus = !!(e.assignedLsgId && e.assignedGroomLsgId && e.assignedCsgId && e.lsgConfirmed && e.groomLsgConfirmed && e.csgConfirmed && !e.completed && e.status !== "deleted");
    } else if (statusFilter === "awaiting_confirmation") {
      matchesStatus = !!(e.assignedLsgId && e.assignedGroomLsgId && e.assignedCsgId && !(e.lsgConfirmed && e.groomLsgConfirmed && e.csgConfirmed) && !e.completed && e.status !== "deleted");
    } else if (statusFilter === "lsg_needed") {
      matchesStatus = eventNeedsLsg(e);
    } else if (statusFilter === "csg_needed") {
      matchesStatus = eventNeedsCsg(e);
    } else if (statusFilter === "unassigned") {
      matchesStatus = !!((!e.assignedLsgId || !e.assignedGroomLsgId || !e.assignedCsgId) && !e.completed && e.status !== "deleted");
    } else if (statusFilter === "completed") {
      matchesStatus = !!e.completed;
    } else if (statusFilter === "past") {
      matchesStatus = isDateInPast(e.date);
    } else if (statusFilter === "upcoming") {
      matchesStatus = !isDateInPast(e.date) && e.status !== "deleted" && !e.completed;
    }

    // Option A: Keep recently edited events visible regardless of current filter to prevent them from disappearing abruptly
    if (sessionEditedIds.has(e.id)) {
      matchesStatus = true;
    }

    return matchesSearch && matchesDate && matchesStatus;
  }).sort(compareEventsByDateTime);

  const selectedPrintEvents = filteredEvents.filter(event => selectedPrintEventIds.has(event.id));

  const getContactNameById = (contactId?: string): string => {
    if (!contactId) return "Unassigned";
    return contacts.find(c => c.id === contactId)?.["Worker Name"] || "Unassigned";
  };

  const getGuestNamesList = (guests: string): string[] => {
    return guests.split(";").map(g => g.trim()).filter(Boolean);
  };

  const getLongDateText = (dateStr: string): string => {
    const parsed = parseDateString(dateStr);
    if (!parsed) return dateStr;
    return parsed.toLocaleDateString(undefined, {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    });
  };

  const togglePrintSelection = (eventId: string) => {
    setSelectedPrintEventIds(prev => {
      const next = new Set(prev);
      if (next.has(eventId)) {
        next.delete(eventId);
      } else {
        next.add(eventId);
      }
      return next;
    });
  };

  const selectAllVisibleForPrint = () => {
    setSelectedPrintEventIds(new Set(filteredEvents.map(event => event.id)));
  };

  const clearPrintSelection = () => {
    setSelectedPrintEventIds(new Set());
  };

  const handlePrintSelectedEvents = () => {
    if (selectedPrintEvents.length === 0) return;
    const cleanupPrintMode = () => {
      document.body.classList.remove("printing-events");
      window.removeEventListener("afterprint", cleanupPrintMode);
    };

    document.body.classList.add("printing-events");
    window.addEventListener("afterprint", cleanupPrintMode);

    requestAnimationFrame(() => {
      window.print();
      window.setTimeout(cleanupPrintMode, 1000);
    });
  };

  return (
    <div className="w-full event-matcher-root">

      <div className="event-print-sheet hidden">
        <div className="event-print-cover">
          <h1>Temple Event Assignments</h1>
          <p>{selectedPrintEvents.length} selected event{selectedPrintEvents.length === 1 ? "" : "s"}</p>
        </div>
        {selectedPrintEvents.map((event) => {
          const lsgArrival = calculateArrivalTime(event.time, 90);
          const guestArrival = calculateArrivalTime(event.time, 75);
          const csgArrival = calculateArrivalTime(event.time, 60);
          const guestNames = getGuestNamesList(event.guests);
          return (
            <section className="event-print-card" key={event.id}>
              <header className="event-print-header">
                <h2>{getEventTitle(event.guests, event.date, event.time)}</h2>
                <div className="event-print-meta">
                  <span>{getLongDateText(event.date)}</span>
                  <span>{event.time}</span>
                  <span>{event.room || "Room not set"}</span>
                </div>
              </header>

              <div className="event-print-grid">
                <div className="event-print-panel">
                  <div className="event-print-room">
                    <span>Room:</span>
                    <strong>{event.room || "Unspecified"}</strong>
                  </div>

                  <div className="event-print-section">
                    <h3>LSG Arrival: <strong>{lsgArrival || "--"}</strong></h3>
                    <div className="event-print-worker-row">
                      <span>Bride:</span>
                      <strong>{getContactNameById(event.assignedLsgId)}</strong>
                      <em>{event.lsgConfirmed ? "Confirmed" : "Not confirmed"}</em>
                    </div>
                    <div className="event-print-worker-row">
                      <span>Groom:</span>
                      <strong>{getContactNameById(event.assignedGroomLsgId)}</strong>
                      <em>{event.groomLsgConfirmed ? "Confirmed" : "Not confirmed"}</em>
                    </div>
                  </div>

                  <div className="event-print-section">
                    <h3>CSG Arrival: <strong>{csgArrival || "--"}</strong></h3>
                    <div className="event-print-worker-row">
                      <span>Worker:</span>
                      <strong>{getContactNameById(event.assignedCsgId)}</strong>
                      <em>{event.csgConfirmed ? "Confirmed" : "Not confirmed"}</em>
                    </div>
                  </div>
                </div>

                <div className="event-print-panel event-print-details">
                  <div className="event-print-arrival">Guests Arrival: <strong>{guestArrival || "--"}</strong></div>
                  <div>
                    <span className="event-print-label">Event Type</span>
                    <strong>{event.type || "Unspecified"}</strong>
                  </div>
                  <div>
                    <span className="event-print-label">Guest Names</span>
                    {guestNames.length > 0 ? (
                      <ul>
                        {guestNames.map((name, idx) => (
                          <li key={`${event.id}-guest-${idx}`}>{name}</li>
                        ))}
                      </ul>
                    ) : (
                      <p>None listed</p>
                    )}
                  </div>
                  {event.status === "changed" && (
                    <p className="event-print-note">Dates/times altered. Reconfirm availability with the LSG.</p>
                  )}
                  {event.status === "deleted" && (
                    <p className="event-print-note event-print-note-danger">This event is marked deleted/cancelled.</p>
                  )}
                </div>
              </div>
            </section>
          );
        })}
      </div>

      {/* Sync Status Banner */}
      <AnimatePresence>
        {syncStatus && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="p-4 rounded-xl text-xs font-medium border flex items-start gap-2.5 bg-emerald-500/10 border-emerald-500/20 text-emerald-300 mb-4"
          >
            <CheckCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <p className="leading-relaxed">{syncStatus.message}</p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Sticky Search and Filter Panel (pinned below the main navigation) */}
      <div className="sticky top-[73px] z-[110] bg-slate-950/95 backdrop-blur-md py-4 -mx-4 px-4 border-b border-white/10 mb-0 flex flex-col md:flex-row items-center gap-3">
        
        {/* Search bar */}
        <div className="relative flex-1 w-full">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search rooms, types, guests or workers..."
            className="w-full pl-10 pr-4 py-2.5 border border-white/10 bg-slate-900/50 backdrop-blur-xs text-sm rounded-xl focus:outline-hidden focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400"
          />
        </div>

        {/* Controls container (Calendar picker and Filter dropdown) */}
        <div className="flex items-center gap-2 w-full md:w-auto justify-end">
          
          {/* 1. Custom Interactive Monthly Calendar Picker */}
          <div className="relative">
            <button
              type="button"
              onClick={() => {
                setShowDatePicker(!showDatePicker);
                setShowStatusDropdown(false);
              }}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-xl border text-xs font-bold transition-all shadow-sm cursor-pointer select-none ${
                dateRangeStart || dateQuickFilter
                  ? "bg-indigo-600 text-white border-indigo-500"
                  : "bg-white/5 hover:bg-white/10 text-slate-200 border-white/10"
              }`}
            >
              <Calendar className="w-4 h-4" />
              <span>
                {dateQuickFilter === "weekends" ? (
                  "Weekends"
                ) : dateRangeStart ? (
                  dateRangeEnd ? (
                    `${formatDateFriendly(dateRangeStart)} - ${formatDateFriendly(dateRangeEnd)}`
                  ) : (
                    formatDateFriendly(dateRangeStart)
                  )
                ) : (
                  "Filter by Date"
                )}
              </span>
              <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showDatePicker ? "rotate-180" : ""}`} />
            </button>

            {showDatePicker && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowDatePicker(false)} />
                <div className="absolute right-0 mt-2 w-[280px] bg-slate-950 border border-white/15 rounded-xl shadow-2xl z-50 p-4 space-y-3">
                  
                  {/* Calendar Month Header */}
                  <div className="flex items-center justify-between font-mono">
                    <button
                      type="button"
                      onClick={handlePrevMonth}
                      className="p-1 hover:bg-white/10 rounded-md transition-colors text-slate-400 hover:text-white"
                    >
                      &lt;
                    </button>
                    <span className="text-xs font-black text-white uppercase tracking-wider">
                      {monthNames[calMonth]} {calYear}
                    </span>
                    <button
                      type="button"
                      onClick={handleNextMonth}
                      className="p-1 hover:bg-white/10 rounded-md transition-colors text-slate-400 hover:text-white"
                    >
                      &gt;
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={handleWeekendDateFilter}
                    className={`w-full px-3 py-2 rounded-lg border text-[10px] font-black uppercase tracking-wider transition-all cursor-pointer ${
                      dateQuickFilter === "weekends"
                        ? "bg-indigo-600 text-white border-indigo-500"
                        : "bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-300 border-indigo-500/20"
                    }`}
                  >
                    Weekends: Friday + Saturday
                  </button>

                  {/* Days of Week Row */}
                  <div className="grid grid-cols-7 text-center text-[10px] font-black text-slate-500 uppercase tracking-widest font-mono">
                    {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map(day => (
                      <div key={day} className="py-1">{day}</div>
                    ))}
                  </div>

                  {/* Days Grid */}
                  <div className="grid grid-cols-7 gap-1 text-center font-mono text-xs">
                    {calendarCells.map((day, idx) => {
                      if (!day) {
                        return <div key={`blank-${idx}`} className="py-1.5" />;
                      }

                      const hasEvent = calendarEventsMap[day.toDateString()] !== undefined;
                      
                      // Precise day-level checks
                      const isSelectedStart = dateRangeStart && day.toDateString() === dateRangeStart.toDateString();
                      const isSelectedEnd = dateRangeEnd && day.toDateString() === dateRangeEnd.toDateString();
                      const isWeekendQuickDay = dateQuickFilter === "weekends" && (day.getDay() === 5 || day.getDay() === 6);
                      
                      // For comparing times at 00:00:00 to avoid hours offset issue
                      const dayTime = new Date(day);
                      dayTime.setHours(0, 0, 0, 0);
                      const startTime = dateRangeStart ? new Date(dateRangeStart) : null;
                      if (startTime) startTime.setHours(0, 0, 0, 0);
                      const endTime = dateRangeEnd ? new Date(dateRangeEnd) : null;
                      if (endTime) endTime.setHours(0, 0, 0, 0);
                      
                      const isSelected = isSelectedStart || isSelectedEnd;
                      const isInRange = startTime && endTime && dayTime > startTime && dayTime < endTime;

                      // Click Handler
                      const handleDayClick = () => {
                        setDateQuickFilter(null);
                        if (!dateRangeStart || (dateRangeStart && dateRangeEnd)) {
                          setDateRangeStart(day);
                          setDateRangeEnd(null);
                        } else {
                          if (day < dateRangeStart) {
                            setDateRangeStart(day);
                            setDateRangeEnd(null);
                          } else {
                            setDateRangeEnd(day);
                            setShowDatePicker(false);
                          }
                        }
                      };

                      return (
                        <button
                          key={day.toISOString()}
                          type="button"
                          onClick={handleDayClick}
                          className={`py-1.5 text-center font-bold text-[11px] transition-all relative cursor-pointer ${
                            isSelected
                              ? "bg-indigo-600 text-white rounded-lg z-10 shadow-md scale-105"
                              : isWeekendQuickDay
                              ? "bg-indigo-500/25 text-indigo-100 border border-indigo-500/35 rounded-lg"
                              : isInRange
                              ? "bg-indigo-500/25 text-indigo-200 rounded-none font-black"
                              : hasEvent
                              ? "bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-300 border border-indigo-500/20 rounded-lg"
                              : "text-slate-500 hover:bg-white/5 rounded-lg opacity-60"
                          }`}
                        >
                          <span>{day.getDate()}</span>
                          {hasEvent && !isSelected && (
                            <span className="absolute bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-indigo-400" />
                          )}
                        </button>
                      );
                    })}
                  </div>

                  {/* Clear Button */}
                  <div className="pt-2 border-t border-white/5 flex items-center justify-between">
                    <button
                      type="button"
                      onClick={handleClearDateFilter}
                      className="text-[10px] font-bold text-slate-400 hover:text-white uppercase tracking-wider font-mono hover:underline cursor-pointer"
                    >
                      Clear Date Filter
                    </button>
                    <span className="text-[9px] text-indigo-400 bg-indigo-500/10 px-1.5 py-0.5 rounded font-bold font-mono">
                      {events.length} Loaded
                    </span>
                  </div>

                </div>
              </>
            )}
          </div>

          {/* 2. Custom Filter Dropdown (replaces sync stats and tabs rail) */}
          <div className="relative">
            <button
              type="button"
              onClick={() => {
                setShowStatusDropdown(!showStatusDropdown);
                setShowDatePicker(false);
              }}
              className={`p-2.5 rounded-xl border transition-all shadow-sm cursor-pointer select-none ${
                statusFilter !== "all"
                  ? "bg-indigo-600 border-indigo-500 text-white"
                  : "bg-white/5 border-white/10 text-slate-200 hover:border-white/20 hover:bg-white/10"
              }`}
              title="Filter Records"
            >
              <Filter className="w-4 h-4" />
            </button>

            {showStatusDropdown && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowStatusDropdown(false)} />
                <div className="absolute right-0 mt-2 w-[240px] max-h-[300px] overflow-y-auto bg-slate-950 border border-white/15 rounded-xl shadow-2xl z-50 py-1 scrollbar-thin">
                  {statusOptions.map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => {
                        setStatusFilter(opt.id);
                        setShowStatusDropdown(false);
                      }}
                      className={`w-full text-left px-4 py-2.5 text-xs hover:bg-indigo-600 hover:text-white transition-all flex items-center justify-between cursor-pointer ${
                        opt.id === statusFilter
                          ? "bg-indigo-600/30 text-white font-bold"
                          : "text-slate-200"
                      }`}
                    >
                      <span>{opt.label}</span>
                      {opt.id === statusFilter && <Check className="w-3.5 h-3.5 text-indigo-400" />}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

        </div>
      </div>

      <div className="no-print flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-0.5 pt-4">
        <div className="text-xs text-slate-400 font-mono">
          <span className="font-bold text-slate-200">{selectedPrintEvents.length}</span> selected for print
          <span className="text-slate-600 mx-2">|</span>
          <span>{filteredEvents.length} visible</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={selectAllVisibleForPrint}
            disabled={filteredEvents.length === 0}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 disabled:opacity-40 disabled:cursor-not-allowed text-xs font-bold text-slate-200 transition-all cursor-pointer"
          >
            <CheckSquare className="w-3.5 h-3.5" />
            Select Visible
          </button>
          <button
            type="button"
            onClick={clearPrintSelection}
            disabled={selectedPrintEvents.length === 0}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 disabled:opacity-40 disabled:cursor-not-allowed text-xs font-bold text-slate-200 transition-all cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
            Clear
          </button>
          <button
            type="button"
            onClick={handlePrintSelectedEvents}
            disabled={selectedPrintEvents.length === 0}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-indigo-500/40 bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-950 disabled:border-indigo-900 disabled:text-slate-500 disabled:cursor-not-allowed text-xs font-bold text-white transition-all cursor-pointer shadow-md"
          >
            <Printer className="w-3.5 h-3.5" />
            Print Selected
          </button>
        </div>
      </div>

      <div className="space-y-6 pt-6 px-0.5">
        {/* Main Events Grid / Card Layout */}
      {isLoading ? (
        <div className="glass-card rounded-2xl p-16 text-center shadow-xl flex flex-col items-center justify-center min-h-[300px]">
          <div className="w-10 h-10 border-4 border-white/10 border-t-indigo-500 rounded-full animate-spin mb-4" />
          <p className="text-sm text-slate-400 font-medium">Fetching temple ordinances schedule...</p>
        </div>
      ) : filteredEvents.length === 0 ? (
        <div className="glass-card rounded-2xl p-16 text-center shadow-xl border border-white/5">
          <Calendar className="w-10 h-10 text-slate-600 mx-auto mb-4" />
          <h3 className="text-base font-bold text-slate-300">No events found</h3>
          <p className="text-xs text-slate-500 max-w-sm mx-auto mt-1 leading-relaxed">
            There are no ordinance events matching the selected date or status filters. Try uploading an Ordinance PDF!
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-5">
          {filteredEvents.map((event, index) => {
            const isPast = isDateInPast(event.date);
            const lsgArrival = calculateArrivalTime(event.time, 90);
            const guestArrival = calculateArrivalTime(event.time, 75);
            const csgArrival = calculateArrivalTime(event.time, 60);

            // Fetch display title using getEventTitle formatting containing "Sealing"
            const recordTitle = getEventTitle(event.guests, event.date, event.time);

            // Dynamically computed status logic requested by user:
            // BOTH LSG and CSG assigned = Covered (in Green)
            // LSG only assigned = CSG Needed (in Yellow)
            // CSG only assigned = LSG Needed (in Yellow)
            // Neither assigned = Pending Assignment (Default gray)
            let borderClass = "border-white/10";
            let statusBadge = null;

            if (event.completed) {
              borderClass = "border-emerald-500/20 bg-emerald-500/3";
              statusBadge = (
                <div className="flex items-center gap-1.5 px-3 py-1 bg-emerald-500/20 border border-emerald-500/30 rounded text-[10px] font-bold text-emerald-400 uppercase tracking-wider font-mono">
                  <CheckCircle className="w-3.5 h-3.5" />
                  <span>COMPLETED & LOGGED</span>
                </div>
              );
            } else if (event.status === "deleted") {
              borderClass = "border-red-500/40 bg-red-500/5";
              statusBadge = (
                <div className="flex items-center gap-1.5 px-3 py-1 bg-red-500/20 border border-red-500/35 rounded text-[10px] font-bold text-red-400 uppercase tracking-wider font-mono">
                  <ShieldAlert className="w-3.5 h-3.5" />
                  <span>DELETED</span>
                </div>
              );
            } else if (event.status === "changed") {
              borderClass = "border-amber-500/40 bg-amber-500/5";
              statusBadge = (
                <div className="flex items-center gap-1.5 px-3 py-1 bg-amber-500/20 border border-amber-500/35 rounded text-[10px] font-bold text-amber-400 uppercase tracking-wider font-mono">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  <span>DETAILS CHANGED (RECONFIRM)</span>
                </div>
              );
            } else if (event.assignedLsgId && event.assignedGroomLsgId && event.assignedCsgId) {
              const allConfirmed = !!(event.lsgConfirmed && event.groomLsgConfirmed && event.csgConfirmed);
              if (allConfirmed) {
                // ALL assigned and confirmed = Covered (in Green)
                borderClass = "border-emerald-500/30 bg-emerald-500/5";
                statusBadge = (
                  <div className="flex items-center gap-1.5 px-3 py-1 bg-emerald-500/25 border border-emerald-500/35 rounded text-[10px] font-bold text-emerald-400 uppercase tracking-wider font-mono">
                    <CheckCircle className="w-3.5 h-3.5" />
                    <span>COVERED</span>
                  </div>
                );
              } else {
                // All assigned but NOT all confirmed = Awaiting Confirmation (in Yellow)
                borderClass = "border-amber-500/30 bg-amber-500/3";
                statusBadge = (
                  <div className="flex items-center gap-1.5 px-3 py-1 bg-amber-500/20 border border-amber-500/35 rounded text-[10px] font-bold text-amber-400 uppercase tracking-wider font-mono">
                    <AlertCircle className="w-3.5 h-3.5" />
                    <span>AWAITING CONFIRMATION</span>
                  </div>
                );
              }
            } else if (isPast) {
              borderClass = "border-slate-700 bg-slate-900/30";
              statusBadge = (
                <div className="flex items-center gap-1.5 px-3 py-1 bg-slate-800 border border-slate-700 rounded text-[10px] font-bold text-slate-400 uppercase tracking-wider font-mono">
                  <Info className="w-3.5 h-3.5" />
                  <span>HISTORICAL RECORD</span>
                </div>
              );
            } else if (eventNeedsLsg(event)) {
              // We have CSG Worker but are missing one or both LSGs
              borderClass = "border-amber-500/30 bg-amber-500/3";
              statusBadge = (
                <div className="flex items-center gap-1.5 px-3 py-1 bg-amber-500/20 border border-amber-500/35 rounded text-[10px] font-bold text-amber-400 uppercase tracking-wider font-mono">
                  <AlertCircle className="w-3.5 h-3.5" />
                  <span>LSG NEEDED</span>
                </div>
              );
            } else if (eventNeedsCsg(event)) {
              // We have both LSGs but are missing CSG Worker
              borderClass = "border-amber-500/30 bg-amber-500/3";
              statusBadge = (
                <div className="flex items-center gap-1.5 px-3 py-1 bg-amber-500/20 border border-amber-500/35 rounded text-[10px] font-bold text-amber-400 uppercase tracking-wider font-mono">
                  <AlertCircle className="w-3.5 h-3.5" />
                  <span>CSG NEEDED</span>
                </div>
              );
            } else {
              // Any other unassigned combo = PENDING ASSIGNMENTS (in Yellow)
              borderClass = "border-amber-500/30 bg-amber-500/3";
              statusBadge = (
                <div className="flex items-center gap-1.5 px-3 py-1 bg-amber-500/20 border border-amber-500/35 rounded text-[10px] font-bold text-amber-400 uppercase tracking-wider font-mono">
                  <AlertCircle className="w-3.5 h-3.5" />
                  <span>PENDING ASSIGNMENTS</span>
                </div>
              );
            }

            const lsgCovered = !!event.assignedLsgId;
            const groomLsgCovered = !!event.assignedGroomLsgId;
            const csgCovered = !!event.assignedCsgId;
            const assignedRoleStates = [
              lsgCovered ? { confirmed: !!event.lsgConfirmed, reminded: !!event.lsgReminded } : null,
              groomLsgCovered ? { confirmed: !!event.groomLsgConfirmed, reminded: !!event.groomLsgReminded } : null,
              csgCovered ? { confirmed: !!event.csgConfirmed, reminded: !!event.csgReminded } : null,
            ].filter(Boolean) as Array<{ confirmed: boolean; reminded: boolean }>;
            const hasAssignedWorkers = assignedRoleStates.length > 0;
            const allAssignedConfirmed = hasAssignedWorkers && assignedRoleStates.every(role => role.confirmed);
            const allAssignedReminded = hasAssignedWorkers && assignedRoleStates.every(role => role.reminded);

            // Render guest names list line by line cleanly
            const renderGuestNames = () => {
              if (!event.guests) return <div className="text-slate-500 italic text-xs">None</div>;
              const list = event.guests.split(";").map(g => g.trim()).filter(Boolean);
              return (
                <div className="space-y-1 font-mono text-xs text-slate-300 pl-2 border-l border-white/5">
                  {list.map((name, idx) => (
                    <div key={idx} className="leading-relaxed font-semibold truncate max-w-[280px]" title={name}>
                      {name}
                    </div>
                  ))}
                </div>
              );
            };

            // Compute title components for custom header rendering with texting button
            let namePart = "Guests";
            if (event.guests) {
              const list = event.guests.split(";").map(g => g.trim()).filter(Boolean);
              const lastNames = list.map(g => {
                const parts = g.split(",");
                return parts[0].trim();
              });
              if (lastNames.length >= 2) {
                namePart = `${lastNames[0]} & ${lastNames[1]}`;
              } else if (lastNames.length === 1) {
                namePart = lastNames[0];
              }
            }

            let datePart = event.date;
            const d = parseDateString(event.date);
            if (d) {
              const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
              datePart = `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
            }

            return (
              <div
                key={event.id}
                style={{ zIndex: 100 - index }} // Dynamic z-index placement! Ensures dropdown of upper record overlays bottom records cleanly
                className={`glass-card rounded-xl border ${borderClass} shadow-md transition-all flex flex-col relative`}
              >
                {/* 1. Full-width Wireframe Header Area */}
                <div 
                  onClick={() => {
                    setExpandedEventIds(prev => ({
                      ...prev,
                      [event.id]: !prev[event.id]
                    }));
                  }}
                  className="px-4 py-3 bg-white/3 border-b border-white/5 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 cursor-pointer hover:bg-white/5 select-none transition-colors"
                >
                  <div className="text-xs sm:text-sm font-bold text-slate-100 font-mono tracking-tight flex-1 truncate flex items-center gap-1.5 flex-wrap">
                    <label
                      onClick={(e) => e.stopPropagation()}
                      className="mr-1 inline-flex items-center justify-center cursor-pointer"
                      title="Select this event for printing"
                    >
                      <input
                        type="checkbox"
                        checked={selectedPrintEventIds.has(event.id)}
                        onChange={() => togglePrintSelection(event.id)}
                        className="w-4 h-4 rounded border-white/20 bg-slate-900/80 text-indigo-600 focus:ring-indigo-400 focus:ring-offset-0 cursor-pointer"
                      />
                    </label>
                    <span className="text-white font-sans">{namePart} Sealing</span>
                    <span className="text-slate-600">|</span>
                    <span className="text-slate-300">{datePart}</span>
                    <span className="text-slate-600">|</span>
                    <div className="flex items-center gap-1 bg-indigo-500/10 text-indigo-300 px-1.5 py-0.5 rounded border border-indigo-500/20 text-xs">
                      <Clock className="w-3 h-3 text-indigo-400" />
                      <span>{event.time}</span>
                    </div>

                    {/* Texting Icon to the right of the Time */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation(); // Prevents accordion toggle
                        setTextingEvent(event);
                        
                        // Select first available assigned worker
                        let defaultRole: "lsg" | "groom_lsg" | "csg" | "" = "";
                        if (event.assignedLsgId) defaultRole = "lsg";
                        else if (event.assignedGroomLsgId) defaultRole = "groom_lsg";
                        else if (event.assignedCsgId) defaultRole = "csg";
                        setSelectedWorkerRole(defaultRole);

                        // Set custom message text
                        const currentTemplate = templates.find(t => t.id === selectedTemplateId) || templates[0];
                        if (currentTemplate) {
                          setCustomMessageBody(getMergedMessage(currentTemplate.content, event, defaultRole));
                        } else {
                          setCustomMessageBody("");
                        }
                        setIsTextingModalOpen(true);
                      }}
                      title="Send text message reminder"
                      className="p-1 text-slate-400 hover:text-indigo-400 hover:bg-white/5 rounded-md transition-all cursor-pointer flex items-center justify-center"
                    >
                      <MessageSquare className="w-3.5 h-3.5" />
                    </button>
                    {hasAssignedWorkers && (
                      <div className="inline-flex items-center gap-1 rounded border border-white/10 bg-white/5 px-1.5 py-0.5 text-[10px] font-black uppercase leading-none">
                        <span
                          title="All assigned workers confirmed"
                          className={allAssignedConfirmed ? "text-emerald-400" : "text-slate-500"}
                        >
                          C
                        </span>
                        <span
                          title="All assigned workers reminded"
                          className={allAssignedReminded ? "text-emerald-400" : "text-slate-500"}
                        >
                          R
                        </span>
                      </div>
                    )}
                  </div>
                  <div className="shrink-0 flex items-center justify-end gap-2">
                    {statusBadge}
                    <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform duration-200 ${expandedEventIds[event.id] ? "rotate-180" : ""}`} />
                  </div>
                </div>

                {/* 2. Structured Layout Body with wide right column for guests info */}
                {expandedEventIds[event.id] && (
                  <div className="p-4 md:p-5 grid grid-cols-1 md:grid-cols-12 gap-6 items-stretch">
                    
                    {/* Left Column (7/12 on large screens) - Room & Workers list */}
                    <div className="md:col-span-7 space-y-4 flex flex-col justify-between">
                      
                      <div className="space-y-4">
                        {/* Room Info */}
                        <div className="text-xs font-bold text-slate-300 font-mono flex items-center gap-1.5">
                          <span className="text-indigo-400">Room:</span>
                          <span className="bg-white/5 border border-white/10 rounded px-2.5 py-0.5 text-xs text-white">
                            {event.room || "Unspecified"}
                          </span>
                        </div>

                        {/* Workers list grouped by arrivals exactly like the wireframe */}
                        <div className="space-y-3">
                          {/* Section 1: LSG Arrival Section */}
                          <div className="space-y-1.5">
                            {/* Header: LSG Arrival */}
                            <div className="bg-white/3 border border-white/5 rounded-lg px-2.5 py-1 flex items-center">
                              <div className="text-xs font-bold font-mono flex items-center gap-2 text-slate-200">
                                <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse" />
                                <span>LSG Arrival:</span>
                                <span className="text-indigo-300">{lsgArrival || "—"}</span>
                              </div>
                            </div>

                            {/* Indented Bride & Groom selectors */}
                            <div className="pl-3 space-y-1.5">
                              {/* Bride Row */}
                              <div className="flex flex-wrap items-center gap-2 w-full">
                                <span className="w-[50px] sm:w-[60px] shrink-0 text-xs font-bold text-slate-400 font-mono">Bride:</span>
                                <SearchableWorkerSelect
                                  value={event.assignedLsgId || ""}
                                  onChange={(val) => handleAssignWorker(event.id, "lsg", val)}
                                  workers={lsgWorkers}
                                  placeholder="Select Bride LSG..."
                                  disabled={event.status === "deleted" || event.completed}
                                />
                                {lsgCovered ? (
                                  <span className="shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 bg-emerald-500/15 border border-emerald-500/30 rounded text-[9px] font-bold text-emerald-400 font-mono uppercase">
                                    <Check className="w-2.5 h-2.5" /> Assigned
                                  </span>
                                ) : (
                                  <span className="shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 bg-white/5 border border-white/5 rounded text-[9px] font-bold text-slate-500 font-mono uppercase">
                                    Pending
                                  </span>
                                )}

                                {/* CONFIRMED CHECKBOX */}
                                {lsgCovered && (
                                  <label className="shrink-0 flex items-center gap-1 cursor-pointer select-none">
                                    <input
                                      type="checkbox"
                                      checked={!!event.lsgConfirmed}
                                      onChange={() => handleToggleConfirm(event.id, "lsg", !!event.lsgConfirmed)}
                                      disabled={event.status === "deleted" || event.completed}
                                      className="w-3.5 h-3.5 rounded border-white/20 bg-white/5 text-indigo-600 focus:ring-0 cursor-pointer disabled:opacity-40"
                                    />
                                    <span className={`text-[10px] font-mono uppercase tracking-wider font-bold ${event.lsgConfirmed ? "text-indigo-400" : "text-slate-500"}`}>
                                      Confirmed
                                    </span>
                                  </label>
                                )}
                                {lsgCovered && (
                                  <label className="shrink-0 flex items-center gap-1 cursor-pointer select-none">
                                    <input
                                      type="checkbox"
                                      checked={!!event.lsgReminded}
                                      onChange={() => handleToggleReminder(event.id, "lsg", !!event.lsgReminded)}
                                      disabled={event.status === "deleted" || event.completed}
                                      className="w-3.5 h-3.5 rounded border-white/20 bg-white/5 text-emerald-600 focus:ring-0 cursor-pointer disabled:opacity-40"
                                    />
                                    <span className={`text-[10px] font-mono uppercase tracking-wider font-bold ${event.lsgReminded ? "text-emerald-400" : "text-slate-500"}`}>
                                      Reminded
                                    </span>
                                  </label>
                                )}
                              </div>

                              {/* Groom Row */}
                              <div className="flex flex-wrap items-center gap-2 w-full">
                                <span className="w-[50px] sm:w-[60px] shrink-0 text-xs font-bold text-slate-400 font-mono">Groom:</span>
                                <SearchableWorkerSelect
                                  value={event.assignedGroomLsgId || ""}
                                  onChange={(val) => handleAssignWorker(event.id, "groom_lsg", val)}
                                  workers={lsgWorkers}
                                  placeholder="Select Groom LSG..."
                                  disabled={event.status === "deleted" || event.completed}
                                />
                                {groomLsgCovered ? (
                                  <span className="shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 bg-emerald-500/15 border border-emerald-500/30 rounded text-[9px] font-bold text-emerald-400 font-mono uppercase">
                                    <Check className="w-2.5 h-2.5" /> Assigned
                                  </span>
                                ) : (
                                  <span className="shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 bg-white/5 border border-white/5 rounded text-[9px] font-bold text-slate-500 font-mono uppercase">
                                    Pending
                                  </span>
                                )}

                                {/* CONFIRMED CHECKBOX */}
                                {groomLsgCovered && (
                                  <label className="shrink-0 flex items-center gap-1 cursor-pointer select-none">
                                    <input
                                      type="checkbox"
                                      checked={!!event.groomLsgConfirmed}
                                      onChange={() => handleToggleConfirm(event.id, "groom_lsg", !!event.groomLsgConfirmed)}
                                      disabled={event.status === "deleted" || event.completed}
                                      className="w-3.5 h-3.5 rounded border-white/20 bg-white/5 text-indigo-600 focus:ring-0 cursor-pointer disabled:opacity-40"
                                    />
                                    <span className={`text-[10px] font-mono uppercase tracking-wider font-bold ${event.groomLsgConfirmed ? "text-indigo-400" : "text-slate-500"}`}>
                                      Confirmed
                                    </span>
                                  </label>
                                )}
                                {groomLsgCovered && (
                                  <label className="shrink-0 flex items-center gap-1 cursor-pointer select-none">
                                    <input
                                      type="checkbox"
                                      checked={!!event.groomLsgReminded}
                                      onChange={() => handleToggleReminder(event.id, "groom_lsg", !!event.groomLsgReminded)}
                                      disabled={event.status === "deleted" || event.completed}
                                      className="w-3.5 h-3.5 rounded border-white/20 bg-white/5 text-emerald-600 focus:ring-0 cursor-pointer disabled:opacity-40"
                                    />
                                    <span className={`text-[10px] font-mono uppercase tracking-wider font-bold ${event.groomLsgReminded ? "text-emerald-400" : "text-slate-500"}`}>
                                      Reminded
                                    </span>
                                  </label>
                                )}
                              </div>
                            </div>
                          </div>

                          {/* Section 2: CSG Arrival Section */}
                          <div className="space-y-1.5 pt-1">
                            {/* Header: CSG Arrival */}
                            <div className="bg-white/3 border border-white/5 rounded-lg px-2.5 py-1 flex items-center">
                              <div className="text-xs font-bold font-mono flex items-center gap-2 text-slate-200">
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                                <span>CSG Arrival:</span>
                                <span className="text-emerald-300">{csgArrival || "—"}</span>
                              </div>
                            </div>

                            {/* Indented CSG selector */}
                            <div className="pl-3 space-y-1.5">
                              {/* Worker Row */}
                              <div className="flex flex-wrap items-center gap-2 w-full">
                                <span className="w-[50px] sm:w-[60px] shrink-0 text-xs font-bold text-slate-400 font-mono">Worker:</span>
                                <SearchableWorkerSelect
                                  value={event.assignedCsgId || ""}
                                  onChange={(val) => handleAssignWorker(event.id, "csg", val)}
                                  workers={csgWorkers}
                                  placeholder="Select CSG Worker..."
                                  disabled={event.status === "deleted" || event.completed}
                                />
                                {csgCovered ? (
                                  <span className="shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 bg-emerald-500/15 border border-emerald-500/30 rounded text-[9px] font-bold text-emerald-400 font-mono uppercase">
                                    <Check className="w-2.5 h-2.5" /> Assigned
                                  </span>
                                ) : (
                                  <span className="shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 bg-white/5 border border-white/5 rounded text-[9px] font-bold text-slate-500 font-mono uppercase">
                                    Pending
                                  </span>
                                )}

                                {/* CONFIRMED CHECKBOX */}
                                {csgCovered && (
                                  <label className="shrink-0 flex items-center gap-1 cursor-pointer select-none">
                                    <input
                                      type="checkbox"
                                      checked={!!event.csgConfirmed}
                                      onChange={() => handleToggleConfirm(event.id, "csg", !!event.csgConfirmed)}
                                      disabled={event.status === "deleted" || event.completed}
                                      className="w-3.5 h-3.5 rounded border-white/20 bg-white/5 text-indigo-600 focus:ring-0 cursor-pointer disabled:opacity-40"
                                    />
                                    <span className={`text-[10px] font-mono uppercase tracking-wider font-bold ${event.csgConfirmed ? "text-indigo-400" : "text-slate-500"}`}>
                                      Confirmed
                                    </span>
                                  </label>
                                )}
                                {csgCovered && (
                                  <label className="shrink-0 flex items-center gap-1 cursor-pointer select-none">
                                    <input
                                      type="checkbox"
                                      checked={!!event.csgReminded}
                                      onChange={() => handleToggleReminder(event.id, "csg", !!event.csgReminded)}
                                      disabled={event.status === "deleted" || event.completed}
                                      className="w-3.5 h-3.5 rounded border-white/20 bg-white/5 text-emerald-600 focus:ring-0 cursor-pointer disabled:opacity-40"
                                    />
                                    <span className={`text-[10px] font-mono uppercase tracking-wider font-bold ${event.csgReminded ? "text-emerald-400" : "text-slate-500"}`}>
                                      Reminded
                                    </span>
                                  </label>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Bottom Left Completed Action Button as requested */}
                      <div className="pt-4 border-t border-white/5 flex items-center justify-between gap-3">
                        {event.completed ? (
                          <div className="flex items-center gap-1 text-emerald-400 text-xs font-mono font-bold">
                            <CheckCircle className="w-4 h-4" />
                            <span>Event Completed & Worker Stats Incremented</span>
                          </div>
                        ) : (
                          <button
                            onClick={() => handleCompleteEvent(event)}
                            disabled={event.status === "deleted"}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600/20 hover:bg-emerald-600 text-emerald-300 hover:text-white border border-emerald-500/30 rounded-lg text-xs font-bold transition-all cursor-pointer font-mono shadow-sm disabled:opacity-40 disabled:cursor-not-allowed"
                            title="Complete this ordinance event and increment stats for LSG/CSG"
                          >
                            <CheckSquare className="w-3.5 h-3.5" />
                            <span>Complete Event & Log Stats</span>
                          </button>
                        )}
                      </div>

                    </div>

                    {/* Right Column (5/12 on large screens - wider as requested) - Guest Info */}
                    <div className="md:col-span-5 border-t md:border-t-0 md:border-l border-white/5 pt-4 md:pt-0 md:pl-5 flex flex-col justify-between gap-4">
                      
                      <div className="space-y-3.5">
                        {/* Guests Arrival Yellow Line */}
                        <div className="flex items-center gap-1.5 text-xs font-bold font-mono text-slate-300">
                          <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                          <span>Guests Arrival:</span>
                          <span className="text-amber-400 ml-1">{guestArrival || "—"}</span>
                        </div>

                        {/* Event Type */}
                        <div className="space-y-1">
                          <div className="text-[10px] font-black text-slate-500 uppercase tracking-widest font-mono">
                            Event Type:
                          </div>
                          <div className="text-xs font-bold text-indigo-300 uppercase font-mono tracking-wide">
                            {event.type}
                          </div>
                        </div>

                        {/* Guest Names list */}
                        <div className="space-y-1.5">
                          <div className="text-[10px] font-black text-slate-500 uppercase tracking-widest font-mono">
                            Guest names:
                          </div>
                          {renderGuestNames()}
                        </div>
                      </div>

                      {/* Quick warnings and system action button */}
                      <div className="space-y-2">
                        {event.status === "changed" && (
                          <div className="p-2.5 bg-amber-500/10 border border-amber-500/25 rounded-lg text-[11px] text-amber-300 leading-relaxed font-mono flex items-start gap-1.5">
                            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-amber-400" />
                            <span>Dates/times altered. Please reconfirm availability with the LSG.</span>
                          </div>
                        )}

                        {event.status === "deleted" && (
                          <div className="p-2.5 bg-red-500/10 border border-red-500/25 rounded-lg text-[11px] text-red-300 leading-relaxed font-mono flex items-start gap-1.5">
                            <ShieldAlert className="w-3.5 h-3.5 shrink-0 mt-0.5 text-red-400" />
                            <span>This upcoming schedule was deleted from future schedules.</span>
                          </div>
                        )}

                        {/* Reconfirm or Delete dismiss actions */}
                        <div className="flex items-center justify-end gap-1.5 pt-1.5 border-t border-white/5">
                          {event.status === "changed" && (
                            <button
                              onClick={() => handleReconfirmEvent(event.id)}
                              className="flex items-center gap-1 px-3 py-1 bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 hover:text-white border border-amber-500/30 hover:border-amber-500/50 rounded-lg text-xs font-bold transition-all cursor-pointer font-mono"
                            >
                              <UserCheck className="w-3.5 h-3.5" />
                              <span>Reconfirm</span>
                            </button>
                          )}

                          {event.status === "deleted" && (
                            <button
                              onClick={() => handleDeleteEvent(event)}
                              className="flex items-center gap-1 px-3 py-1 bg-red-500/20 hover:bg-red-500/30 text-red-300 hover:text-white border border-red-500/30 hover:border-red-500/50 rounded-lg text-xs font-bold transition-all cursor-pointer font-mono"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                              <span>{eventHasAssignedWorkers(event) ? "Keep Deleted" : "Dismiss"}</span>
                            </button>
                          )}

                          {event.status !== "deleted" && event.status !== "changed" && (
                            <div className="text-[10px] text-slate-500 italic flex items-center gap-1 font-mono">
                              <Check className="w-3 h-3 text-slate-600" />
                              <span>Verified</span>
                            </div>
                          )}
                        </div>

                      </div>

                    </div>

                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Texting & Template Management Modal */}
      <AnimatePresence>
        {isTextingModalOpen && textingEvent && (
          <div className="fixed inset-0 z-[200] flex items-start justify-center p-3 sm:p-4 pt-4 sm:pt-10 bg-slate-950/80 backdrop-blur-sm overflow-y-auto">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className="w-full max-w-xl glass-card rounded-2xl border border-white/10 bg-slate-950 shadow-2xl flex flex-col overflow-hidden my-0 mb-8 max-h-[calc(100vh-3rem)] sm:max-h-[calc(100vh-6rem)]"
            >
              {/* Modal Header */}
              <div className="px-4 py-3 sm:px-5 sm:py-4 bg-white/3 border-b border-white/5 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <MessageSquare className="w-5 h-5 text-indigo-400" />
                  <h3 className="text-xs sm:text-sm font-bold text-slate-100 font-mono">
                    Text Message Reminders
                  </h3>
                </div>
                <button
                  onClick={() => {
                    setIsTextingModalOpen(false);
                    setTextingEvent(null);
                    setIsManagingTemplates(false);
                    setEditingTemplateId(null);
                  }}
                  className="p-1 hover:bg-white/10 rounded-lg text-slate-400 hover:text-white transition-colors cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Modal Body */}
              <div className="p-4 sm:p-5 overflow-y-auto space-y-4">
                {isManagingTemplates ? (
                  /* Template Manager View */
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <h4 id="modal-template-form-title" className="text-xs font-bold uppercase text-indigo-400 font-mono">
                        {editingTemplateId ? "Edit Template" : "New Template"}
                      </h4>
                      <button
                        onClick={() => {
                          setIsManagingTemplates(false);
                          setEditingTemplateId(null);
                          setNewTemplateTitle("");
                          setNewTemplateContent("");
                        }}
                        className="text-[11px] text-slate-400 hover:text-white font-mono cursor-pointer"
                      >
                        ← Back to Message
                      </button>
                    </div>

                    <div className="space-y-3 bg-white/3 p-4 rounded-xl border border-white/5">
                      <div>
                        <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider font-mono mb-1">
                          Template Title
                        </label>
                        <input
                          type="text"
                          value={newTemplateTitle}
                          onChange={(e) => setNewTemplateTitle(e.target.value)}
                          placeholder="e.g., CSG Weekend Shift Reminder"
                          className="w-full px-3 py-2 text-xs text-white bg-slate-900 border border-white/10 rounded-lg focus:outline-hidden focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400 font-sans"
                        />
                      </div>

                      <div>
                        <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider font-mono mb-1">
                          Template Content
                        </label>
                        <textarea
                          ref={templateTextareaRef}
                          rows={4}
                          value={newTemplateContent}
                          onChange={(e) => setNewTemplateContent(e.target.value)}
                          placeholder="Placeholders: {worker_name}, {role}, {title}, {date}, {time}, {lsg_arrival}, {csg_arrival}, {lsg_bride_first}, {lsg_groom_first}, {csg_first}"
                          className="w-full px-3 py-2 text-xs text-white bg-slate-900 border border-white/10 rounded-lg focus:outline-hidden focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400 font-mono h-28"
                        />
                        
                        {/* Emoji Helper Bar */}
                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 p-2 bg-slate-950/40 rounded-lg border border-white/5">
                          <span className="text-[10px] font-bold text-slate-500 mr-1 uppercase tracking-wider font-mono">Insert Emoji:</span>
                          {["👋", "😊", "📅", "⏰", "🔔", "⛪", "💍", "👰", "🤵", "🎉", "❤️", "✨", "👍", "🙌", "✉️", "🚨"].map(emoji => (
                            <button
                              key={emoji}
                              type="button"
                              onClick={() => handleInsertTemplateTextAtCursor(emoji)}
                              className="w-6 h-6 flex items-center justify-center text-sm rounded bg-white/5 hover:bg-white/15 border border-white/5 hover:border-white/10 transition-all cursor-pointer"
                            >
                              {emoji}
                            </button>
                          ))}
                        </div>

                        <div className="mt-1.5 p-2 bg-slate-950/80 rounded border border-white/5 text-[9px] text-slate-400 font-mono leading-relaxed space-y-1">
                          <p className="font-bold text-slate-300 uppercase">Click to Insert Placeholders (case-sensitive):</p>
                          <div className="flex flex-wrap gap-1 mt-1">
                            {[
                              { placeholder: "{worker_name}", label: "Name" },
                              { placeholder: "{role}", label: "Role Label" },
                              { placeholder: "{title}", label: "Sealing Title" },
                              { placeholder: "{date}", label: "Date" },
                              { placeholder: "{time}", label: "Time" },
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
                                onClick={() => handleInsertTemplateTextAtCursor(item.placeholder)}
                                className="px-1.5 py-0.5 rounded bg-white/5 hover:bg-white/10 border border-white/5 text-[9px] text-indigo-300 font-mono transition-colors cursor-pointer flex items-center gap-1"
                                title={`Insert ${item.placeholder}`}
                              >
                                <span className="font-bold text-indigo-400">{item.placeholder}</span>
                                <span className="text-slate-500 text-[8px] font-sans">({item.label})</span>
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center justify-end gap-2 pt-2">
                        <button
                          onClick={() => {
                            setIsManagingTemplates(false);
                            setEditingTemplateId(null);
                            setNewTemplateTitle("");
                            setNewTemplateContent("");
                          }}
                          className="px-3 py-1.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-[11px] text-slate-300 hover:text-white transition-all font-mono cursor-pointer"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={handleSaveTemplate}
                          disabled={!newTemplateTitle.trim() || !newTemplateContent.trim()}
                          className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 border border-indigo-500/30 rounded-lg text-[11px] font-bold text-white transition-all font-mono disabled:opacity-45 flex items-center gap-1 cursor-pointer"
                        >
                          <Save className="w-3.5 h-3.5" />
                          <span>Save Template</span>
                        </button>
                      </div>
                    </div>

                    {/* List of existing templates to Edit/Delete */}
                    <div className="space-y-2">
                      <h5 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest font-mono pl-1">
                        Existing Templates
                      </h5>
                      <div className="space-y-1.5 max-h-[160px] overflow-y-auto pr-1">
                        {templates.map((tpl) => (
                          <div key={tpl.id} className="bg-white/3 border border-white/5 rounded-lg p-2.5 flex items-center justify-between gap-3 text-xs">
                            <div className="truncate flex-1">
                              <p className="font-bold text-slate-200 font-mono truncate">{tpl.title}</p>
                              <p className="text-[10px] text-slate-400 truncate mt-0.5 font-mono">{tpl.content}</p>
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0">
                              <button
                                onClick={() => {
                                  setEditingTemplateId(tpl.id);
                                  setNewTemplateTitle(tpl.title);
                                  setNewTemplateContent(tpl.content);
                                  setTimeout(() => {
                                    document.getElementById("modal-template-form-title")?.scrollIntoView({ behavior: "smooth", block: "center" });
                                  }, 100);
                                }}
                                className="p-1 hover:bg-white/10 rounded text-slate-400 hover:text-indigo-400 transition-colors cursor-pointer"
                                title="Edit"
                              >
                                <Edit3 className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => handleDeleteTemplate(tpl.id)}
                                className="p-1 hover:bg-white/10 rounded text-slate-400 hover:text-red-400 transition-colors cursor-pointer"
                                title="Delete"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : (
                  /* Primary SMS Sender View */
                  <div className="space-y-4">
                    {/* Recipient Selection */}
                    <div className="space-y-2">
                      <label className="block text-[10px] font-black text-slate-400 uppercase tracking-wider font-mono">
                        Select Recipient:
                      </label>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                        {/* Option Bride */}
                        {textingEvent.assignedLsgId ? (() => {
                          const contact = contacts.find(c => c.id === textingEvent.assignedLsgId);
                          const name = contact ? contact["Worker Name"] : "Bride LSG";
                          const phone = contact ? (getContactPhone(contact) || "No Phone") : "No Phone";
                          const isSelected = selectedWorkerRole === "lsg";
                          return (
                            <button
                              onClick={() => {
                                setSelectedWorkerRole("lsg");
                                const currentTpl = templates.find(t => t.id === selectedTemplateId) || templates[0];
                                if (currentTpl) {
                                  setCustomMessageBody(getMergedMessage(currentTpl.content, textingEvent, "lsg"));
                                }
                              }}
                              className={`p-2 rounded-xl border text-left transition-all flex flex-col justify-between cursor-pointer min-h-[64px] ${
                                isSelected 
                                  ? "bg-indigo-600/15 border-indigo-500 text-white shadow-md shadow-indigo-500/10" 
                                  : "bg-white/3 border-white/5 text-slate-300 hover:bg-white/5"
                              }`}
                            >
                              <div className="w-full truncate">
                                <span className="text-[9px] uppercase font-bold text-indigo-400 block font-mono leading-none mb-1">Bride LSG</span>
                                <span className="font-bold text-xs font-mono block truncate">{name}</span>
                              </div>
                              <span className="text-[10px] font-mono text-slate-400 mt-1 block truncate leading-none">{phone}</span>
                            </button>
                          );
                        })() : null}

                        {/* Option Groom */}
                        {textingEvent.assignedGroomLsgId ? (() => {
                          const contact = contacts.find(c => c.id === textingEvent.assignedGroomLsgId);
                          const name = contact ? contact["Worker Name"] : "Groom LSG";
                          const phone = contact ? (getContactPhone(contact) || "No Phone") : "No Phone";
                          const isSelected = selectedWorkerRole === "groom_lsg";
                          return (
                            <button
                              onClick={() => {
                                setSelectedWorkerRole("groom_lsg");
                                const currentTpl = templates.find(t => t.id === selectedTemplateId) || templates[0];
                                if (currentTpl) {
                                  setCustomMessageBody(getMergedMessage(currentTpl.content, textingEvent, "groom_lsg"));
                                }
                              }}
                              className={`p-2 rounded-xl border text-left transition-all flex flex-col justify-between cursor-pointer min-h-[64px] ${
                                isSelected 
                                  ? "bg-indigo-600/15 border-indigo-500 text-white shadow-md shadow-indigo-500/10" 
                                  : "bg-white/3 border-white/5 text-slate-300 hover:bg-white/5"
                              }`}
                            >
                              <div className="w-full truncate">
                                <span className="text-[9px] uppercase font-bold text-indigo-400 block font-mono leading-none mb-1">Groom LSG</span>
                                <span className="font-bold text-xs font-mono block truncate">{name}</span>
                              </div>
                              <span className="text-[10px] font-mono text-slate-400 mt-1 block truncate leading-none">{phone}</span>
                            </button>
                          );
                        })() : null}

                        {/* Option CSG */}
                        {textingEvent.assignedCsgId ? (() => {
                          const contact = contacts.find(c => c.id === textingEvent.assignedCsgId);
                          const name = contact ? contact["Worker Name"] : "CSG Worker";
                          const phone = contact ? (getContactPhone(contact) || "No Phone") : "No Phone";
                          const isSelected = selectedWorkerRole === "csg";
                          return (
                            <button
                              onClick={() => {
                                setSelectedWorkerRole("csg");
                                const currentTpl = templates.find(t => t.id === selectedTemplateId) || templates[0];
                                if (currentTpl) {
                                  setCustomMessageBody(getMergedMessage(currentTpl.content, textingEvent, "csg"));
                                }
                              }}
                              className={`p-2 rounded-xl border text-left transition-all flex flex-col justify-between cursor-pointer min-h-[64px] ${
                                isSelected 
                                  ? "bg-indigo-600/15 border-indigo-500 text-white shadow-md shadow-indigo-500/10" 
                                  : "bg-white/3 border-white/5 text-slate-300 hover:bg-white/5"
                              }`}
                            >
                              <div className="w-full truncate">
                                <span className="text-[9px] uppercase font-bold text-emerald-400 block font-mono leading-none mb-1">CSG Worker</span>
                                <span className="font-bold text-xs font-mono block truncate">{name}</span>
                              </div>
                              <span className="text-[10px] font-mono text-slate-400 mt-1 block truncate leading-none">{phone}</span>
                            </button>
                          );
                        })() : null}

                        {!textingEvent.assignedLsgId && !textingEvent.assignedGroomLsgId && !textingEvent.assignedCsgId && (
                          <div className="p-4 bg-slate-900 border border-white/5 rounded-xl text-center text-xs text-slate-400 font-mono col-span-3">
                            No workers are currently assigned to this sealing event. Assign workers first in the card to send SMS notifications!
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Template Selection */}
                    {templates.length > 0 && selectedWorkerRole && (
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between">
                          <label className="block text-[10px] font-black text-slate-500 uppercase tracking-wider font-mono">
                            Select Template:
                          </label>
                          <button
                            onClick={() => {
                              setIsManagingTemplates(true);
                              setEditingTemplateId(null);
                              setNewTemplateTitle("");
                              setNewTemplateContent("");
                            }}
                            className="text-[10px] font-bold text-indigo-400 hover:text-indigo-300 font-mono flex items-center gap-1 transition-colors cursor-pointer"
                          >
                            <Plus className="w-3 h-3" /> Manage Templates
                          </button>
                        </div>
                        <select
                          value={selectedTemplateId}
                          onChange={(e) => {
                            const val = e.target.value;
                            setSelectedTemplateId(val);
                            const tpl = templates.find(t => t.id === val);
                            if (tpl) {
                              setCustomMessageBody(getMergedMessage(tpl.content, textingEvent, selectedWorkerRole));
                            }
                          }}
                          className="w-full px-3 py-2 text-xs text-white bg-slate-900 border border-white/10 rounded-lg focus:outline-hidden focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400 font-mono cursor-pointer"
                        >
                          {templates.map(tpl => (
                            <option key={tpl.id} value={tpl.id} className="bg-slate-950 font-mono text-xs">
                              {tpl.title}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}

                    {/* Message Preview Textarea */}
                    {selectedWorkerRole && (
                      <div className="space-y-1.5">
                        <label className="block text-[10px] font-black text-slate-500 uppercase tracking-wider font-mono">
                          Message Body Preview (You can edit before opening SMS):
                        </label>
                        <textarea
                          ref={messageTextareaRef}
                          rows={3}
                          value={customMessageBody}
                          onChange={(e) => setCustomMessageBody(e.target.value)}
                          className="w-full px-3 py-2 text-xs text-white bg-slate-900 border border-white/10 rounded-lg focus:outline-hidden focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400 font-sans leading-relaxed resize-y min-h-[80px]"
                        />
                        
                        {/* Emoji Helper Bar */}
                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 p-1.5 bg-slate-950/40 rounded-lg border border-white/5">
                          <span className="text-[9px] font-bold text-slate-500 mr-1 uppercase tracking-wider font-mono">Insert Emoji:</span>
                          {["👋", "😊", "📅", "⏰", "🔔", "⛪", "💍", "👰", "🤵", "🎉", "❤️", "✨", "👍", "🙌", "✉️", "🚨"].map(emoji => (
                            <button
                              key={emoji}
                              type="button"
                              onClick={() => handleInsertMessageTextAtCursor(emoji)}
                              className="w-6 h-6 flex items-center justify-center text-xs rounded bg-white/5 hover:bg-white/15 border border-white/5 hover:border-white/10 transition-all cursor-pointer"
                            >
                              {emoji}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Action Buttons */}
                    <div className="flex items-center gap-2 pt-2">
                      <button
                        onClick={() => {
                          setIsTextingModalOpen(false);
                          setTextingEvent(null);
                        }}
                        className="flex-1 py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-xs font-bold text-slate-300 hover:text-white transition-all font-mono cursor-pointer"
                      >
                        Close
                      </button>

                      {selectedWorkerRole && (() => {
                        const activeContact = getWorkerContact(selectedWorkerRole);
                        const activePhone = activeContact ? getContactPhone(activeContact) : "";
                        const hasPhone = activePhone && activePhone.replace(/[^\d]/g, "").length >= 7;

                        return (
                          <>
                            {/* Copy Fallback */}
                            <button
                              onClick={() => {
                                navigator.clipboard.writeText(customMessageBody);
                                setIsCopied(true);
                                setTimeout(() => setIsCopied(false), 2000);
                              }}
                              className="px-3 py-2 bg-slate-800 hover:bg-slate-700 border border-white/10 rounded-xl text-xs font-bold text-slate-300 hover:text-white transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                              title="Copy text to clipboard"
                            >
                              {isCopied ? (
                                <Check className="w-4 h-4 text-emerald-400" />
                              ) : (
                                <Copy className="w-4 h-4" />
                              )}
                              <span className="font-mono">{isCopied ? "Copied!" : "Copy"}</span>
                            </button>

                            {/* Launch SMS Link */}
                            <button
                              onClick={() => {
                                if (!hasPhone) return;
                                // Build SMS link
                                const cleanPhone = activePhone.replace(/[^\d+]/g, "");
                                const smsUri = `sms:${cleanPhone}?body=${encodeURIComponent(customMessageBody)}`;
                                // Create a robust link click
                                const link = document.createElement("a");
                                link.href = smsUri;
                                document.body.appendChild(link);
                                link.click();
                                document.body.removeChild(link);
                              }}
                              disabled={!hasPhone}
                              className="flex-1 py-2 bg-indigo-600 hover:bg-indigo-500 border border-indigo-500/35 rounded-xl text-xs font-bold text-white transition-all font-mono flex items-center justify-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed shadow-md shadow-indigo-600/10 cursor-pointer"
                            >
                              <ArrowRight className="w-4 h-4" />
                              <span>{hasPhone ? "Open SMS App" : "No Phone"}</span>
                            </button>
                          </>
                        );
                      })()}
                    </div>
                  </div>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

    </div>
  </div>
  );
}
