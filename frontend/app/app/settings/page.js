"use client";

import { signOut } from "firebase/auth";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Download,
  Eraser,
  FileText,
  Home,
  MessageSquare,
  Settings,
  Shield,
  Trash2,
} from "lucide-react";

import { auth } from "../../../lib/firebase";
import { buildAutoAvatarUrl } from "../../../lib/avatar";
import { getValidAccessToken } from "../../../lib/session";
import { APP_THEMES, applyTheme, getSavedTheme, THEME_KEY } from "../../../lib/theme";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "http://127.0.0.1:8000";
const ANSWER_EXPORTS_KEY = "askmydocs_answer_exports";
const STORE_ANSWERS_KEY = "askmydocs_store_answers";
const PRIVATE_PREVIEW_KEY = "askmydocs_private_preview";
const STORAGE_QUOTA_BYTES = 1024 * 1024 * 1024;

function readStoredUser() {
  if (typeof window === "undefined") {
    return null;
  }
  const savedUser = localStorage.getItem("current_user");
  if (!savedUser) {
    return null;
  }
  try {
    return JSON.parse(savedUser);
  } catch {
    return null;
  }
}

function getAccessToken() {
  return getValidAccessToken();
}

function formatBytes(value) {
  const bytes = Number(value || 0);
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

async function parseJsonSafely(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export default function SettingsPage() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [theme, setTheme] = useState("blue-gray");
  const [logoutLoading, setLogoutLoading] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [documents, setDocuments] = useState([]);
  const [loadingDocs, setLoadingDocs] = useState(true);
  const [actionLoading, setActionLoading] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [privatePreview, setPrivatePreview] = useState(true);
  const [storeAnswers, setStoreAnswers] = useState(true);
  const profileMenuRef = useRef(null);

  const clearSession = () => {
    localStorage.removeItem("access_token");
    localStorage.removeItem("current_user");
    localStorage.removeItem("auth_mode");
  };

  const handleLogout = async () => {
    setLogoutLoading(true);
    try {
      await signOut(auth);
    } catch {
      // Ignore Firebase sign-out errors and still clear local session.
    } finally {
      clearSession();
      router.replace("/");
      setLogoutLoading(false);
    }
  };

  const loadDocuments = useCallback(async () => {
    const token = getAccessToken();
    if (!token) {
      router.replace("/");
      return;
    }

    setLoadingDocs(true);
    setError("");
    try {
      const response = await fetch(`${API_BASE_URL}/documents?limit=500`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await parseJsonSafely(response);
      if (!response.ok) {
        throw new Error(data?.detail || "Failed to load document usage.");
      }
      setDocuments(Array.isArray(data) ? data : []);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load document usage.";
      setError(message);
    } finally {
      setLoadingDocs(false);
    }
  }, [router]);

  useEffect(() => {
    setUser(readStoredUser());
    const saved = getSavedTheme();
    setTheme(saved);
    applyTheme(saved);
    const storeAnswersPref = localStorage.getItem(STORE_ANSWERS_KEY);
    const privatePreviewPref = localStorage.getItem(PRIVATE_PREVIEW_KEY);
    setStoreAnswers(storeAnswersPref !== "false");
    setPrivatePreview(privatePreviewPref !== "false");
  }, []);

  useEffect(() => {
    const onPointerDown = (event) => {
      if (!profileMenuRef.current || profileMenuRef.current.contains(event.target)) {
        return;
      }
      setProfileOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, []);

  useEffect(() => {
    loadDocuments();
  }, [loadDocuments]);

  const handleThemeChange = (nextTheme) => {
    setTheme(nextTheme);
    localStorage.setItem(THEME_KEY, nextTheme);
    applyTheme(nextTheme);
  };

  const usage = useMemo(() => {
    const totalBytes = documents.reduce((sum, doc) => sum + Number(doc?.file_size_bytes || 0), 0);
    const percent = Math.min(100, Math.round((totalBytes / STORAGE_QUOTA_BYTES) * 100));
    return { totalBytes, percent };
  }, [documents]);

  const handleClearChatHistory = () => {
    setActionLoading("clear_chat");
    try {
      localStorage.removeItem(ANSWER_EXPORTS_KEY);
      setNotice("Chat history cache cleared.");
    } catch {
      setError("Could not clear chat history.");
    } finally {
      setActionLoading("");
    }
  };

  const handleDeleteIndexedDocuments = async () => {
    const token = getAccessToken();
    if (!token) {
      router.replace("/");
      return;
    }
    setActionLoading("delete_indexed");
    setError("");
    setNotice("");
    try {
      const targets = documents.filter((doc) => String(doc?.status || "").toLowerCase() === "indexed");
      for (const doc of targets) {
        await fetch(`${API_BASE_URL}/documents/${doc.id}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token}` },
        });
      }
      setNotice(`Deleted ${targets.length} indexed document(s).`);
      await loadDocuments();
    } catch {
      setError("Failed to delete indexed documents.");
    } finally {
      setActionLoading("");
    }
  };

  const handleExportAnswers = () => {
    setActionLoading("export_answers");
    try {
      const raw = localStorage.getItem(ANSWER_EXPORTS_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      const items = Array.isArray(parsed) ? parsed : [];
      if (!items.length) {
        setNotice("No saved answers to export yet.");
        return;
      }
      const blob = new Blob([JSON.stringify(items, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `askmydocs-answers-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setNotice(`Exported ${items.length} answer record(s).`);
    } catch {
      setError("Could not export answers.");
    } finally {
      setActionLoading("");
    }
  };

  const handlePurgeAllData = async () => {
    const confirmed = window.confirm("This will delete all documents and local app data. Continue?");
    if (!confirmed) {
      return;
    }
    const token = getAccessToken();
    if (!token) {
      router.replace("/");
      return;
    }
    setActionLoading("purge_all");
    setError("");
    try {
      for (const doc of documents) {
        await fetch(`${API_BASE_URL}/documents/${doc.id}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token}` },
        });
      }
      localStorage.removeItem(ANSWER_EXPORTS_KEY);
      clearSession();
      await signOut(auth).catch(() => {});
      router.replace("/");
    } catch {
      setError("Failed to purge all data.");
      setActionLoading("");
    }
  };

  const actionDisabled = actionLoading !== "";

  return (
    <main className="min-h-screen app-bg app-text">
      <div className="min-h-screen grid grid-cols-1 lg:grid-cols-[248px_1fr]">
        <aside className="border-r app-border app-sidebar px-4 py-6">
          <div className="px-2">
            <p className="text-sm font-semibold uppercase tracking-[0.18em] app-text">ASKMYDOCS</p>
            <h1 className="mt-1 text-xl font-semibold app-text">Workspace</h1>
          </div>

          <nav className="mt-8 space-y-1">
            <button
              type="button"
              onClick={() => router.push("/app")}
              className="w-full flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium app-nav-item"
            >
              <Home size={18} />
              Home
            </button>
            <button
              type="button"
              onClick={() => router.push("/app/documents")}
              className="w-full flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium app-nav-item"
            >
              <FileText size={18} />
              Documents
            </button>
            <button
              type="button"
              onClick={() => router.push("/app/chats")}
              className="w-full flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium app-nav-item"
            >
              <MessageSquare size={18} />
              Chats
            </button>
            <button type="button" className="w-full flex items-center gap-3 rounded-xl app-primary px-3 py-2.5 text-sm font-medium text-white">
              <Settings size={18} />
              Settings
            </button>
          </nav>

          <div className="mt-8 rounded-xl border app-border app-soft p-3">
            <label className="block text-xs font-medium app-muted mb-2">Theme</label>
            <select
              value={theme}
              onChange={(event) => handleThemeChange(event.target.value)}
              className="w-full rounded-lg border app-border app-surface px-2.5 py-2 text-sm app-text outline-none"
            >
              {APP_THEMES.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </div>
        </aside>

        <section className="px-6 py-8 md:px-10">
          <div className="mb-3 flex justify-end">
            <div ref={profileMenuRef} className="relative">
              <button
                type="button"
                onClick={() => setProfileOpen((v) => !v)}
                className="h-10 w-10 overflow-hidden rounded-full border-2 app-border app-soft shadow-[0_4px_14px_rgba(15,23,42,0.22)] ring-2 ring-white/70"
                title="Profile"
              >
                <img
                  src={user?.avatar_url || buildAutoAvatarUrl(user)}
                  alt="Profile avatar"
                  className="h-full w-full object-cover"
                />
              </button>
              {profileOpen ? (
                <div className="absolute right-0 z-20 mt-2 w-64 rounded-xl border app-border app-surface p-3 shadow-lg">
                  <p className="text-xs font-medium uppercase tracking-wide app-muted">Profile</p>
                  <img
                    src={user?.avatar_url || buildAutoAvatarUrl(user)}
                    alt="Profile avatar"
                    className="mt-2 h-10 w-10 rounded-full border app-border object-cover"
                  />
                  <p className="mt-2 text-sm font-semibold app-text truncate">{user?.display_name || "User"}</p>
                  <p className="text-xs app-muted truncate">{user?.email || "Unknown user"}</p>
                  <button
                    type="button"
                    onClick={handleLogout}
                    disabled={logoutLoading}
                    className="mt-3 w-full rounded-lg border app-border app-soft px-3 py-2 text-sm app-text disabled:opacity-60"
                  >
                    {logoutLoading ? "Logging out..." : "Logout"}
                  </button>
                </div>
              ) : null}
            </div>
          </div>
          <header>
            <p className="text-sm font-medium app-muted">Settings</p>
            <h2 className="mt-1 text-3xl font-semibold tracking-tight app-text">Privacy &amp; Data Control</h2>
          </header>

          <div className="mt-6 rounded-2xl border app-border app-surface p-5 shadow-sm">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-semibold app-text">Storage Usage</p>
                <p className="mt-1 text-xs app-muted">
                  {loadingDocs ? "Calculating..." : `${formatBytes(usage.totalBytes)} of ${formatBytes(STORAGE_QUOTA_BYTES)} used`}
                </p>
              </div>
              <span className="text-xs font-medium app-muted">{loadingDocs ? "-" : `${usage.percent}%`}</span>
            </div>
            <div className="mt-3 h-2.5 w-full rounded-full bg-slate-200/70">
              <div className="h-full rounded-full bg-[#4e6f92] transition-all" style={{ width: `${usage.percent}%` }} />
            </div>
          </div>

          <div className="mt-5 rounded-2xl border app-border app-surface p-5 shadow-sm">
            <h3 className="text-sm font-semibold app-text">Privacy Options</h3>
            <div className="mt-4 space-y-3">
              <div className="flex items-center justify-between rounded-xl border app-border app-soft px-3 py-2.5">
                <div>
                  <p className="text-sm font-medium app-text">Private Preview Mode</p>
                  <p className="text-xs app-muted">Hide preview text from sharing overlays.</p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setPrivatePreview((v) => {
                      const next = !v;
                      localStorage.setItem(PRIVATE_PREVIEW_KEY, String(next));
                      return next;
                    });
                  }}
                  className={`h-6 w-11 rounded-full transition ${privatePreview ? "bg-emerald-500" : "bg-slate-300"}`}
                >
                  <span
                    className={`block h-5 w-5 rounded-full bg-white transition ${privatePreview ? "translate-x-5" : "translate-x-0.5"}`}
                  />
                </button>
              </div>

              <div className="flex items-center justify-between rounded-xl border app-border app-soft px-3 py-2.5">
                <div>
                  <p className="text-sm font-medium app-text">Store Answers Locally</p>
                  <p className="text-xs app-muted">Required for Export Answers.</p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setStoreAnswers((v) => {
                      const next = !v;
                      localStorage.setItem(STORE_ANSWERS_KEY, String(next));
                      return next;
                    });
                  }}
                  className={`h-6 w-11 rounded-full transition ${storeAnswers ? "bg-emerald-500" : "bg-slate-300"}`}
                >
                  <span
                    className={`block h-5 w-5 rounded-full bg-white transition ${storeAnswers ? "translate-x-5" : "translate-x-0.5"}`}
                  />
                </button>
              </div>
            </div>
          </div>

          <div className="mt-5 rounded-2xl border app-border app-surface p-5 shadow-sm">
            <h3 className="text-sm font-semibold app-text">Data Actions</h3>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <button
                type="button"
                disabled={actionDisabled}
                onClick={handleClearChatHistory}
                className="inline-flex items-center justify-center gap-2 rounded-xl border app-border app-soft px-4 py-2.5 text-sm font-medium app-text disabled:opacity-60"
              >
                <Eraser size={16} />
                {actionLoading === "clear_chat" ? "Clearing..." : "Clear Chat History"}
              </button>

              <button
                type="button"
                disabled={actionDisabled}
                onClick={handleDeleteIndexedDocuments}
                className="inline-flex items-center justify-center gap-2 rounded-xl border app-border app-soft px-4 py-2.5 text-sm font-medium app-text disabled:opacity-60"
              >
                <Trash2 size={16} />
                {actionLoading === "delete_indexed" ? "Deleting..." : "Delete All Indexed Documents"}
              </button>

              <button
                type="button"
                disabled={actionDisabled || !storeAnswers}
                onClick={handleExportAnswers}
                className="inline-flex items-center justify-center gap-2 rounded-xl border app-border app-soft px-4 py-2.5 text-sm font-medium app-text disabled:opacity-60"
              >
                <Download size={16} />
                {actionLoading === "export_answers" ? "Exporting..." : "Export Answers"}
              </button>

              <div className="inline-flex items-center justify-center gap-2 rounded-xl border app-border app-soft px-4 py-2.5 text-sm font-medium app-muted">
                <Shield size={16} />
                Privacy-first controls active
              </div>
            </div>
          </div>

          <div className="mt-5 rounded-2xl border border-red-300 bg-red-50 p-5 shadow-sm">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 text-red-600" size={20} />
              <div className="flex-1">
                <h3 className="text-sm font-semibold text-red-700">Danger Zone</h3>
                <p className="mt-1 text-xs text-red-600">
                  Permanently deletes all stored documents, indexed data, and local session cache.
                </p>
                <button
                  type="button"
                  disabled={actionDisabled}
                  onClick={handlePurgeAllData}
                  className="mt-3 w-full sm:w-auto rounded-xl bg-red-100 px-4 py-2.5 text-sm font-semibold text-red-700 ring-1 ring-red-300 transition hover:bg-red-200 disabled:opacity-60"
                >
                  {actionLoading === "purge_all" ? "Purging..." : "Purge All Data"}
                </button>
              </div>
            </div>
          </div>

          {notice ? <p className="mt-4 text-sm text-emerald-700">{notice}</p> : null}
          {error ? <p className="mt-2 text-sm text-rose-600">{error}</p> : null}
        </section>
      </div>
    </main>
  );
}
