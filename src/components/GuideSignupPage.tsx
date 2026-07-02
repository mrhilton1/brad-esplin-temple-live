import React, { useEffect, useMemo, useState } from "react";
import { Calendar, Check, ChevronLeft, ChevronRight, Clock, Loader2, MapPin, Send, User, Users } from "lucide-react";

type RoleKey = "bride" | "groom" | "company";

type SignupRole = {
  filled: boolean;
  name?: string;
  pending?: boolean;
  confirmed?: boolean;
};

type SignupSlot = {
  id: string;
  date: string;
  time: string;
  room: string;
  title: string;
  roles: Record<RoleKey, SignupRole>;
};

const ROLE_LABELS: Record<RoleKey, string> = {
  bride: "Bride Guide",
  groom: "Groom Guide",
  company: "Company Guide",
};

const parseDateString = (dateStr: string): Date | null => {
  if (!dateStr) return null;
  const direct = new Date(dateStr);
  if (!Number.isNaN(direct.getTime())) return direct;
  const cleaned = dateStr.replace(/^(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday),\s*/i, "");
  const parsed = new Date(cleaned);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const getMonthKey = (date: Date) => `${date.getFullYear()}-${date.getMonth()}`;

const formatDateHeading = (dateStr: string) => {
  const date = parseDateString(dateStr);
  if (!date) return dateStr;
  return date.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
};

const formatMonthTitle = (monthDate: Date) => {
  return monthDate.toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });
};

const getTokenFromLocation = () => {
  const params = new URLSearchParams(window.location.search);
  const queryToken = params.get("token");
  if (queryToken) return queryToken;
  return decodeURIComponent(window.location.pathname.split("/").filter(Boolean)[1] || "");
};

const roleEntries = (slot: SignupSlot) => {
  return (Object.keys(ROLE_LABELS) as RoleKey[]).map(role => ({
    role,
    label: ROLE_LABELS[role],
    status: slot.roles[role],
  }));
};

const roleSummaryText = (label: string, status: SignupRole) => {
  if (status.pending) return `${label}: Pending: ${status.name || "Submitted"}`;
  if (status.confirmed || status.filled) return `${label}: ${status.name || "Assigned"}`;
  return `${label}: Open`;
};

const roleChoiceText = (status: SignupRole) => {
  if (status.pending) return `Pending: ${status.name || "Submitted"}`;
  if (status.confirmed || status.filled) return `Assigned: ${status.name || "Assigned"}`;
  return "Available";
};

export default function GuideSignupPage() {
  const [slots, setSlots] = useState<SignupSlot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedDate, setSelectedDate] = useState("");
  const [selectedSlotId, setSelectedSlotId] = useState("");
  const [selectedRole, setSelectedRole] = useState<RoleKey | "">("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [successMessage, setSuccessMessage] = useState("");
  const [visibleMonth, setVisibleMonth] = useState<Date>(() => new Date());

  const token = useMemo(getTokenFromLocation, []);

  useEffect(() => {
    const loadSlots = async () => {
      setLoading(true);
      setError("");
      try {
        const response = await fetch(`/api/public/signup-slots?token=${encodeURIComponent(token)}`);
        const payload = await response.json().catch(() => null);
        if (!response.ok) {
          throw new Error(payload?.error || "Unable to load available guide assignments.");
        }
        const loadedSlots = Array.isArray(payload?.slots) ? payload.slots : [];
        setSlots(loadedSlots);
        const firstDate = loadedSlots[0]?.date || "";
        setSelectedDate(firstDate);
        const parsed = parseDateString(firstDate);
        if (parsed) setVisibleMonth(new Date(parsed.getFullYear(), parsed.getMonth(), 1));
      } catch (err: any) {
        setError(err?.message || "Unable to load available guide assignments.");
      } finally {
        setLoading(false);
      }
    };

    loadSlots();
  }, [token]);

  const dates = useMemo(() => {
    const unique = new Map<string, { date: string; parsed: Date }>();
    slots.forEach(slot => {
      const parsed = parseDateString(slot.date);
      if (parsed && !unique.has(slot.date)) {
        unique.set(slot.date, { date: slot.date, parsed });
      }
    });
    return Array.from(unique.values()).sort((a, b) => a.parsed.getTime() - b.parsed.getTime());
  }, [slots]);

  const visibleDates = dates.filter(({ parsed }) => getMonthKey(parsed) === getMonthKey(visibleMonth));
  const selectedSlots = slots.filter(slot => slot.date === selectedDate);
  const selectedSlot = slots.find(slot => slot.id === selectedSlotId) || null;
  const selectedRoleStatus = selectedSlot && selectedRole ? selectedSlot.roles[selectedRole] : null;
  const canSubmit = !!selectedSlot && !!selectedRole && !selectedRoleStatus?.filled && firstName.trim() && lastName.trim() && !submitting;

  const shiftMonth = (amount: number) => {
    setVisibleMonth(prev => new Date(prev.getFullYear(), prev.getMonth() + amount, 1));
  };

  const handleDateSelect = (date: string) => {
    setSelectedDate(date);
    setSelectedSlotId("");
    setSelectedRole("");
    setSuccessMessage("");
  };

  const handleSlotSelect = (slotId: string) => {
    setSelectedSlotId(slotId);
    setSelectedRole("");
    setSuccessMessage("");
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selectedSlot || !selectedRole) return;

    setSubmitting(true);
    setError("");
    setSuccessMessage("");
    try {
      const response = await fetch("/api/public/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          eventId: selectedSlot.id,
          role: selectedRole,
          firstName,
          lastName,
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error || "Unable to submit this guide signup.");
      }

      const submittedName = `${lastName.trim()}, ${firstName.trim()}`;
      setSlots(prev => prev.map(slot => {
        if (slot.id !== selectedSlot.id || !selectedRole) return slot;
        return {
          ...slot,
          roles: {
            ...slot.roles,
            [selectedRole]: {
              filled: true,
              name: submittedName,
              pending: true,
            },
          },
        };
      }));
      setSuccessMessage(`Thank you. ${ROLE_LABELS[selectedRole]} has been submitted for review.`);
      setFirstName("");
      setLastName("");
      setSelectedRole("");
    } catch (err: any) {
      setError(err?.message || "Unable to submit this guide signup.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-950">
      <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-4 py-5 sm:px-6 lg:px-8">
        <header className="mb-5 space-y-2">
          <div className="inline-flex items-center gap-2 rounded-full bg-indigo-50 px-3 py-1 text-xs font-bold uppercase tracking-wider text-indigo-700">
            <Calendar className="h-3.5 w-3.5" />
            Temple Guide Signup
          </div>
          <h1 className="text-2xl font-black tracking-tight text-slate-950 sm:text-3xl">
            Select A Date & Time
          </h1>
          <p className="max-w-2xl text-sm font-medium leading-relaxed text-slate-600">
            Choose a Friday or Saturday assignment, then enter your name for an available guide role you can serve.
          </p>
        </header>

        {loading ? (
          <div className="flex flex-1 items-center justify-center rounded-2xl border border-slate-200 bg-white p-8">
            <div className="flex items-center gap-3 text-slate-600">
              <Loader2 className="h-5 w-5 animate-spin text-indigo-600" />
              <span className="font-bold">Loading open guide assignments...</span>
            </div>
          </div>
        ) : error && slots.length === 0 ? (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 p-5 text-sm font-bold text-rose-700">
            {error}
          </div>
        ) : (
          <div className="grid flex-1 grid-cols-1 gap-5 lg:grid-cols-[1fr_0.95fr]">
            <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
              <div className="mb-4 flex items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={() => shiftMonth(-1)}
                  className="rounded-full border border-slate-200 p-2 text-slate-600 transition hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-700"
                  aria-label="Previous month"
                >
                  <ChevronLeft className="h-5 w-5" />
                </button>
                <h2 className="text-lg font-black">{formatMonthTitle(visibleMonth)}</h2>
                <button
                  type="button"
                  onClick={() => shiftMonth(1)}
                  className="rounded-full border border-slate-200 p-2 text-slate-600 transition hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-700"
                  aria-label="Next month"
                >
                  <ChevronRight className="h-5 w-5" />
                </button>
              </div>

              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {visibleDates.length === 0 ? (
                  <div className="col-span-full rounded-xl border border-dashed border-slate-300 p-5 text-center text-sm font-bold text-slate-500">
                    No Friday or Saturday assignments in this month.
                  </div>
                ) : visibleDates.map(({ date, parsed }) => {
                  const selected = selectedDate === date;
                  const count = slots.filter(slot => slot.date === date).length;
                  return (
                    <button
                      key={date}
                      type="button"
                      onClick={() => handleDateSelect(date)}
                      className={`rounded-xl border p-4 text-left transition ${
                        selected
                          ? "border-indigo-600 bg-indigo-600 text-white shadow-lg shadow-indigo-200"
                          : "border-slate-200 bg-white hover:border-indigo-200 hover:bg-indigo-50"
                      }`}
                    >
                      <span className={`block text-xs font-black uppercase tracking-wider ${selected ? "text-indigo-100" : "text-slate-500"}`}>
                        {parsed.toLocaleDateString(undefined, { weekday: "long" })}
                      </span>
                      <span className="mt-1 block text-2xl font-black">{parsed.getDate()}</span>
                      <span className={`mt-1 block text-xs font-bold ${selected ? "text-indigo-100" : "text-indigo-700"}`}>
                        {count} time{count === 1 ? "" : "s"}
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>

            <section className="space-y-4">
              <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
                <h2 className="mb-3 text-lg font-black">{selectedDate ? formatDateHeading(selectedDate) : "Choose a date"}</h2>
                <div className="space-y-2">
                  {selectedSlots.length === 0 ? (
                    <div className="rounded-xl bg-slate-50 p-4 text-sm font-bold text-slate-500">
                      Select a highlighted date to see available times.
                    </div>
                  ) : selectedSlots.map(slot => {
                    const selected = slot.id === selectedSlotId;
                    const openRoles = roleEntries(slot).filter(({ status }) => !status.filled);
                    return (
                      <button
                        key={slot.id}
                        type="button"
                        onClick={() => handleSlotSelect(slot.id)}
                        className={`w-full rounded-xl border p-4 text-left transition ${
                          selected
                            ? "border-indigo-600 bg-indigo-50"
                            : "border-slate-200 bg-white hover:border-indigo-200 hover:bg-slate-50"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <div className="flex items-center gap-2 text-xl font-black text-indigo-700">
                              <Clock className="h-5 w-5" />
                              {slot.time}
                            </div>
                            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-bold text-slate-500">
                              <span className="inline-flex items-center gap-1">
                                <MapPin className="h-3.5 w-3.5" />
                                {slot.room || "Room TBD"}
                              </span>
                              <span className="inline-flex items-center gap-1">
                                <Users className="h-3.5 w-3.5" />
                                {openRoles.length} open
                              </span>
                            </div>
                          </div>
                          {selected && <Check className="h-5 w-5 text-indigo-700" />}
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {roleEntries(slot).map(({ role, label, status }) => (
                            <span
                              key={role}
                              className={`rounded-full px-2.5 py-1 text-[11px] font-black ${
                                status.pending
                                  ? "bg-amber-50 text-amber-700 ring-1 ring-amber-200"
                                  : status.filled
                                  ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200"
                                  : "bg-amber-50 text-amber-700 ring-1 ring-amber-200"
                              }`}
                            >
                              {roleSummaryText(label, status)}
                            </span>
                          ))}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {selectedSlot && (
                <form onSubmit={handleSubmit} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
                  <h2 className="mb-3 text-lg font-black">Choose A Role</h2>
                  <div className="grid grid-cols-1 gap-2">
                    {roleEntries(selectedSlot).map(({ role, label, status }) => (
                      <button
                        key={role}
                        type="button"
                        disabled={status.filled}
                        onClick={() => setSelectedRole(role)}
                        className={`rounded-xl border p-3 text-left transition disabled:cursor-not-allowed ${
                          selectedRole === role
                            ? "border-indigo-600 bg-indigo-600 text-white"
                            : status.filled
                              ? "border-slate-200 bg-slate-100 text-slate-400"
                              : "border-slate-200 bg-white hover:border-indigo-200 hover:bg-indigo-50"
                        }`}
                      >
                        <span className="block font-black">{label}</span>
                        <span className={`mt-1 block text-xs font-bold ${selectedRole === role ? "text-indigo-100" : "text-slate-500"}`}>
                          {roleChoiceText(status)}
                        </span>
                      </button>
                    ))}
                  </div>

                  <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <label className="space-y-1 text-sm font-bold text-slate-700">
                      First Name
                      <input
                        value={firstName}
                        onChange={(event) => setFirstName(event.target.value)}
                        className="w-full rounded-xl border border-slate-300 bg-white px-3 py-3 text-base font-semibold outline-none transition focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100"
                        autoComplete="given-name"
                      />
                    </label>
                    <label className="space-y-1 text-sm font-bold text-slate-700">
                      Last Name
                      <input
                        value={lastName}
                        onChange={(event) => setLastName(event.target.value)}
                        className="w-full rounded-xl border border-slate-300 bg-white px-3 py-3 text-base font-semibold outline-none transition focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100"
                        autoComplete="family-name"
                      />
                    </label>
                  </div>

                  {error && (
                    <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm font-bold text-rose-700">
                      {error}
                    </div>
                  )}
                  {successMessage && (
                    <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-bold text-emerald-700">
                      {successMessage}
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={!canSubmit}
                    className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-3.5 text-base font-black text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:bg-slate-300"
                  >
                    {submitting ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
                    Submit For Review
                  </button>
                </form>
              )}
            </section>
          </div>
        )}

        <footer className="mt-5 flex items-center justify-center gap-2 text-xs font-bold text-slate-400">
          <User className="h-3.5 w-3.5" />
          Your submission is reviewed before it is added to the schedule.
        </footer>
      </main>
    </div>
  );
}
