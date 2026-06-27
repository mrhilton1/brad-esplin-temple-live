import { useState, useEffect } from "react";
import { 
  FileText, ArrowRight, Play, AlertCircle, RefreshCw, 
  Settings, CheckCircle2, Sliders, ChevronRight, HelpCircle, Database, Calendar,
  ShieldAlert
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { collection, db, onSnapshot, query, where } from "./lib/dataStore";
import FileUploader from "./components/FileUploader";
import TablePreview from "./components/TablePreview";
import CrmDatabase from "./components/CrmDatabase";
import EventMatcher from "./components/EventMatcher";
import { UploadedFile, ExtractedTableData } from "./types";
import { parsePdfLocally } from "./lib/pdfParser";

const LOADING_STEPS = [
  "Reading PDF binary layout...",
  "Extracting selectable PDF text locally...",
  "Locating structural column boundaries...",
  "Filtering out document titles & branding headers...",
  "Discarding page numbers, footers & margin noise...",
  "Standardizing column headers across pages...",
  "Formulating validated JSON structure...",
  "Completing clean data serialization..."
];

export default function App() {
  const [selectedFile, setSelectedFile] = useState<UploadedFile | null>(null);
  const [selectedPreset, setSelectedPreset] = useState("crm_contacts");
  const [isExtracting, setIsExtracting] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [extractedData, setExtractedData] = useState<ExtractedTableData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"extractor" | "database" | "schedule" | "reviews">("database");
  const [contactsCount, setContactsCount] = useState<number>(0);
  const [pendingConflictsCount, setPendingConflictsCount] = useState<number>(0);

  useEffect(() => {
    // Listen to real-time crm_contacts collection size
    const unsubscribeContacts = onSnapshot(
      collection(db, "crm_contacts"),
      (snapshot) => {
        setContactsCount(snapshot.size);
      },
      (err) => {
        console.error("Supabase contacts listener error:", err);
      }
    );

    // Listen to real-time pending crm_sync_conflicts size
    const qConflicts = query(
      collection(db, "crm_sync_conflicts"),
      where("status", "==", "pending")
    );
    const unsubscribeConflicts = onSnapshot(
      qConflicts,
      (snapshot) => {
        setPendingConflictsCount(snapshot.size);
      },
      (err) => {
        console.error("Supabase conflicts listener error:", err);
      }
    );

    return () => {
      unsubscribeContacts();
      unsubscribeConflicts();
    };
  }, []);

  const CRM_INSTRUCTION = 'Extract clean CRM contact tabular data with exactly these columns: "Worker Name", "Household Phone", "Personal Phone", "Email", "Labels", "Preferred Phone Type". Use "Worker Name" as the primary key/column. "Preferred Phone Type" must be exactly "Personal" or "Household" (or "None" if unspecified) based on which phone number is noted as preferred. Under "Labels", identify whether they are textable (assign the tag "Textable") and identify any other tags, categories, or notes (e.g., "Contractor", "Lead", "Urgent") formatted as a simple comma-separated list of tags.';
  const HISTORY_INSTRUCTION = 'Extract clean worker activity history with exactly these columns: "Worker Name", "Date Last Served - CSG", "Date Last Served - LSG", "Total Times Served - CSG", "Total Times Served - LSG". Use "Worker Name" as the primary key/column. For columns containing dates or total times served, extract them accurately as text strings.';
  const EVENT_INSTRUCTION = 'Extract clean daily schedule of ordinances with exactly these columns: "Date of event", "Time of event", "Room of event", "Type of event", "Names of the guests". For "Date of event", find the date header above the items (e.g. "Saturday, August 1, 2026") and repeat it for each event on that date. For "Time of event", get the event start time (e.g. "9:00 AM", "12:15 PM"). For "Room of event", get the room (e.g., "Room 1", "Room 2", "Room 3"). For "Type of event", get the type (e.g., "LICENSED MARRIAGE", "SEALING AFTER CIVIL MARRIAGE", "CHILD-TO-PARENT SEALING"). For "Names of the guests", extract the full names of the primary couple/persons exactly as listed (include any parentheses), separating different guests with a semicolon (e.g., "Rivera Trevino, Jose Jaden (Rivera, Jaden); Jones, Aycie Ila (Jones, Aycie)").';

  const handlePresetSelect = (presetId: string) => {
    setSelectedPreset(presetId);
  };

  // Interval timer to cycle through extraction loading messages
  const startLoadingAnimation = () => {
    setCurrentStep(0);
    const interval = setInterval(() => {
      setCurrentStep((prev) => {
        if (prev < LOADING_STEPS.length - 1) {
          return prev + 1;
        }
        return prev; // hold on last step until complete
      });
    }, 2200);
    return interval;
  };

  // Clear file and reset state
  const handleFileCleared = () => {
    setSelectedFile(null);
    setExtractedData(null);
    setError(null);
  };

  const handleReset = () => {
    setSelectedFile(null);
    setExtractedData(null);
    setError(null);
    setSelectedPreset("crm_contacts");
  };

  // Parse the PDF locally without sending document contents to an AI service.
  const handleExtractData = async () => {
    if (!selectedFile) return;

    setIsExtracting(true);
    setError(null);
    const intervalId = startLoadingAnimation();

    try {
      const result = await parsePdfLocally(selectedFile.base64, selectedPreset);

      if (result.rows.length === 0) {
        throw new Error(
          "No table rows were found. This PDF may be scanned/image-only or use a layout that needs a custom parser rule."
        );
      }

      setExtractedData(result);
    } catch (err: any) {
      console.error("Local PDF extraction error:", err);
      setError(
        err.message || 
        "Failed to extract table data from this PDF."
      );
    } finally {
      clearInterval(intervalId);
      setIsExtracting(false);
    }
  };

  return (
    <div className="min-h-screen text-slate-100 font-sans relative selection:bg-indigo-500/30 overflow-x-clip">
      
      {/* Ambient glow mesh background blobs */}
      <div className="mesh-bg-container">
        <div className="mesh-bg-1" />
        <div className="mesh-bg-2" />
      </div>

      {/* Main Container */}
      <main className="max-w-6xl mx-auto px-4 pt-0 pb-6 md:pb-8 relative z-10">
        
        {/* Navigation Tabs Segmented Control */}
        <div className="sticky top-0 z-[120] bg-slate-950/95 backdrop-blur-md py-4 -mx-4 px-4 border-b border-white/10 mb-0 flex justify-center md:justify-start">
          <div className="inline-flex p-1 bg-black/30 border border-white/10 rounded-xl">
            <button
              onClick={() => setActiveTab("database")}
              className={`flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-bold transition-all cursor-pointer ${
                activeTab === "database"
                  ? "bg-indigo-600 text-white shadow-md"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              <Database className="w-4 h-4" />
              Contacts {contactsCount > 0 ? `(${contactsCount})` : ""}
            </button>
            <button
              onClick={() => setActiveTab("schedule")}
              className={`flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-bold transition-all cursor-pointer ${
                activeTab === "schedule"
                  ? "bg-indigo-600 text-white shadow-md"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              <Calendar className="w-4 h-4" />
              Events
            </button>
            <button
              onClick={() => setActiveTab("extractor")}
              className={`flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-bold transition-all cursor-pointer ${
                activeTab === "extractor"
                  ? "bg-indigo-600 text-white shadow-md"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              <FileText className="w-4 h-4" />
              PDF Extractor
            </button>
            <button
              onClick={() => setActiveTab("reviews")}
              className={`flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-bold transition-all cursor-pointer relative ${
                activeTab === "reviews"
                  ? "bg-indigo-600 text-white shadow-md"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              <ShieldAlert className="w-4 h-4" />
              Settings/Review
              {pendingConflictsCount > 0 && (
                <span className="bg-amber-500 text-black text-[10px] font-extrabold px-1.5 py-0.5 rounded-full ml-1.5">
                  {pendingConflictsCount}
                </span>
              )}
            </button>
          </div>
        </div>

        {/* Dynamic Display Area */}
        <AnimatePresence mode="wait">
          {activeTab === "database" ? (
            <motion.div
              key="database-view"
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -15 }}
              transition={{ duration: 0.3 }}
              className="relative"
            >
              <CrmDatabase activeView="contacts" />
            </motion.div>
          ) : activeTab === "reviews" ? (
            <motion.div
              key="reviews-view"
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -15 }}
              transition={{ duration: 0.3 }}
              className="relative pt-6"
            >
              <CrmDatabase activeView="reviews" />
            </motion.div>
          ) : activeTab === "schedule" ? (
            <motion.div
              key="schedule-view"
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -15 }}
              transition={{ duration: 0.3 }}
              className="relative"
            >
              <EventMatcher />
            </motion.div>
          ) : !extractedData && !isExtracting ? (
            // Form View (Upload and Settings)
            <motion.div
              key="uploader-view"
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -15 }}
              transition={{ duration: 0.3 }}
              className="space-y-6 pt-6"
            >
              <div className="glass-card rounded-2xl p-6 md:p-8 shadow-2xl relative z-10">
                <div className="space-y-6">
                  {/* Schema Template Presets (NOW ABOVE UPLOAD as requested in screenshot) */}
                  <div className="space-y-3">
                    <label className="text-sm font-bold text-slate-100 flex items-center gap-2">
                      <Sliders className="w-4 h-4 text-indigo-400" />
                      Select Document Template Preset
                    </label>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      <button
                        type="button"
                        onClick={() => handlePresetSelect("crm_contacts")}
                        className={`p-4 rounded-xl border text-left transition-all cursor-pointer ${
                          selectedPreset === "crm_contacts"
                            ? "bg-indigo-600/15 border-indigo-400 text-white shadow-lg"
                            : "bg-white/5 border-white/10 text-slate-300 hover:bg-white/10 hover:border-white/20"
                        }`}
                      >
                        <div className="font-bold text-sm flex items-center gap-1.5 flex-wrap">
                          👥 Worker Search Results
                          <span className="bg-indigo-500/20 text-indigo-300 text-[10px] font-semibold px-1.5 py-0.5 rounded">
                            CRM Info
                          </span>
                        </div>
                        <div className="text-xs text-slate-400 mt-1.5 leading-relaxed font-sans">
                          Target exact columns: <strong>Worker Name</strong>, <strong>Household Phone</strong>, <strong>Personal Phone</strong>, <strong>Email</strong>, with smart <strong>Labels</strong> & <strong>Preferred Phone</strong> styling.
                        </div>
                      </button>

                      <button
                        type="button"
                        onClick={() => handlePresetSelect("worker_history")}
                        className={`p-4 rounded-xl border text-left transition-all cursor-pointer ${
                          selectedPreset === "worker_history"
                            ? "bg-indigo-600/15 border-indigo-400 text-white shadow-lg"
                            : "bg-white/5 border-white/10 text-slate-300 hover:bg-white/10 hover:border-white/20"
                        }`}
                      >
                        <div className="font-bold text-sm flex items-center gap-1.5 flex-wrap">
                          📊 Worker History Report
                          <span className="bg-indigo-500/20 text-indigo-300 text-[10px] font-semibold px-1.5 py-0.5 rounded">
                            CSG/LSG Times
                          </span>
                        </div>
                        <div className="text-xs text-slate-400 mt-1.5 leading-relaxed font-sans">
                          Target exact history columns: <strong>Worker Name</strong>, <strong>Last CSG Date</strong>, <strong>Last LSG Date</strong>, <strong>Total CSG</strong>, <strong>Total LSG</strong>.
                        </div>
                      </button>

                      <button
                        type="button"
                        onClick={() => handlePresetSelect("event_schedule")}
                        className={`p-4 rounded-xl border text-left transition-all cursor-pointer ${
                          selectedPreset === "event_schedule"
                            ? "bg-indigo-600/15 border-indigo-400 text-white shadow-lg"
                            : "bg-white/5 border-white/10 text-slate-300 hover:bg-white/10 hover:border-white/20"
                        }`}
                      >
                        <div className="font-bold text-sm flex items-center gap-1.5 flex-wrap">
                          📅 Ordinance Schedule
                          <span className="bg-indigo-500/20 text-indigo-300 text-[10px] font-semibold px-1.5 py-0.5 rounded">
                            Event Matcher
                          </span>
                        </div>
                        <div className="text-xs text-slate-400 mt-1.5 leading-relaxed font-sans">
                          Target schedule columns: <strong>Date</strong>, <strong>Time</strong>, <strong>Room</strong>, <strong>Type</strong>, and <strong>Names of the guests</strong>.
                        </div>
                      </button>
                    </div>
                  </div>

                  {/* File Selection (NOW BELOW PRESETS as requested in screenshot) */}
                  <div className="space-y-3 pt-2">
                    <div className="flex items-center justify-between">
                      <label className="text-sm font-bold text-slate-100 flex items-center gap-2">
                        Upload PDF Document
                      </label>
                      <span className="text-xs text-slate-400 font-mono">PDF up to 20MB</span>
                    </div>
                    
                    <FileUploader
                      selectedFile={selectedFile}
                      onFileLoaded={setSelectedFile}
                      onFileCleared={handleFileCleared}
                    />
                  </div>

                  {/* Submit Trigger */}
                  <div className="pt-4 border-t border-white/5 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4">
                    <div className="flex items-center gap-2 text-xs text-slate-400">
                      <HelpCircle className="w-4 h-4 text-slate-400 shrink-0" />
                      <span>Data is processed server-side securely. We do not persist files.</span>
                    </div>

                    <button
                      id="extract-columns-btn"
                      disabled={!selectedFile}
                      onClick={handleExtractData}
                      className={`flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl font-bold text-sm transition-all shadow-md ${
                        selectedFile 
                          ? "bg-indigo-600 hover:bg-indigo-500 text-white hover:shadow-lg cursor-pointer focus:ring-2 focus:ring-indigo-500/50" 
                          : "bg-white/5 text-slate-500 border border-white/5 cursor-not-allowed"
                      }`}
                    >
                      <span>Analyze & Extract Columns</span>
                      <ArrowRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            </motion.div>
          ) : isExtracting ? (
            // Processing/Extracting Loading View
            <motion.div
              key="loading-view"
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.98 }}
              className="glass-card rounded-2xl p-8 md:p-12 shadow-2xl text-center flex flex-col items-center justify-center min-h-[400px] relative z-10"
            >
              {/* Spinner */}
              <div className="relative flex items-center justify-center w-16 h-16 mb-8">
                <span className="absolute inline-flex h-full w-full rounded-full bg-indigo-500 opacity-10 animate-ping" />
                <div className="w-12 h-12 border-4 border-white/10 border-t-indigo-500 rounded-full animate-spin" />
              </div>

              {/* Status Header */}
              <h2 className="text-lg font-bold text-white mb-1">
                Analyzing Document Tables...
              </h2>
              <p className="text-sm text-slate-300 mb-6 max-w-sm">
                This takes a few moments as Gemini reads the multi-page layout and strips recurring noise.
              </p>

              {/* Cycle through loading steps */}
              <div className="w-full max-w-md bg-black/25 border border-white/5 rounded-xl p-4 text-left animate-pulse">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">
                  Processing Queue
                </p>
                <div className="space-y-2.5">
                  {LOADING_STEPS.map((step, idx) => {
                    const isActive = idx === currentStep;
                    const isCompleted = idx < currentStep;
                    return (
                      <div 
                        key={idx} 
                        className={`flex items-center gap-2.5 text-xs transition-all ${
                          isActive 
                            ? "text-white font-bold translate-x-1" 
                            : isCompleted 
                              ? "text-indigo-400 font-medium" 
                              : "text-slate-500"
                        }`}
                      >
                        {isCompleted ? (
                          <CheckCircle2 className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                        ) : isActive ? (
                          <div className="w-3.5 h-3.5 rounded-full border-2 border-indigo-400 border-t-transparent animate-spin shrink-0" />
                        ) : (
                          <div className="w-3.5 h-3.5 rounded-full border border-white/10 shrink-0" />
                        )}
                        <span>{step}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </motion.div>
          ) : (
            // Extracted Results View (TablePreview)
            <motion.div
              key="results-view"
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -15 }}
              transition={{ duration: 0.3 }}
            >
              {extractedData && (
                <TablePreview
                  data={extractedData}
                  onDataUpdated={setExtractedData}
                  onReset={handleReset}
                  sheetPreset={selectedPreset}
                />
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Global Error Banner */}
        {error && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-6 flex flex-col md:flex-row items-start md:items-center justify-between gap-4 p-4 md:p-5 bg-red-500/10 border border-red-500/25 rounded-xl text-red-200 text-sm shadow-2xs relative z-10"
          >
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
              <div>
                <p className="font-bold">Extraction Error</p>
                <p className="text-red-300 mt-0.5 leading-relaxed max-w-2xl">{error}</p>
              </div>
            </div>
            <button
              onClick={handleReset}
              className="px-3.5 py-1.5 text-xs font-bold text-red-300 hover:text-white border border-red-500/20 hover:bg-red-600/20 rounded-lg transition-colors shrink-0 cursor-pointer"
            >
              Dismiss & Retry
            </button>
          </motion.div>
        )}

      </main>

      {/* Clean human-labeled footer */}
      <footer className="mt-16 border-t border-white/5 py-8 bg-black/10 text-center text-xs text-slate-500 relative z-10">
        <p>© 2026 PDF Column Extractor. Crafted using Google GenAI and React.</p>
      </footer>
    </div>
  );
}
