"use client";

import { signOut } from "firebase/auth";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Download,
  Eye,
  FileText,
  Home,
  Maximize2,
  MessageSquare,
  Minimize2,
  Minus,
  Plus,
  Search,
  Settings,
  Trash2,
  X,
} from "lucide-react";

import { auth } from "../../../lib/firebase";
import { buildAutoAvatarUrl } from "../../../lib/avatar";
import DocxPreview from "../../../components/DocxPreview";
import { getValidAccessToken } from "../../../lib/session";
import { APP_THEMES, applyTheme, getSavedTheme, THEME_KEY } from "../../../lib/theme";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "http://127.0.0.1:8000";

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

function formatUploadDate(value) {
  if (!value) {
    return "-";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }

  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatFileSize(sizeBytes) {
  const size = Number(sizeBytes || 0);
  if (!Number.isFinite(size) || size <= 0) {
    return "-";
  }
  if (size < 1024) {
    return `${size} B`;
  }
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }
  return `${(size / (1024 * 1024)).toFixed(2)} MB`;
}

function statusPill(statusValue) {
  const status = String(statusValue || "").toLowerCase();
  if (status === "indexed") {
    return "bg-emerald-50 text-emerald-700 border border-emerald-200";
  }
  if (status === "error") {
    return "bg-rose-50 text-rose-700 border border-rose-200";
  }
  return "bg-amber-50 text-amber-700 border border-amber-200";
}

async function parseJsonSafely(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function resolveFileUrl(fileUrl) {
  if (!fileUrl) {
    return "";
  }
  if (fileUrl.startsWith("http://") || fileUrl.startsWith("https://")) {
    return fileUrl;
  }
  return `${API_BASE_URL}${fileUrl.startsWith("/") ? fileUrl : `/${fileUrl}`}`;
}

export default function DocumentsPage() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [logoutLoading, setLogoutLoading] = useState(false);
  const [docsLoading, setDocsLoading] = useState(true);
  const [documents, setDocuments] = useState([]);
  const [search, setSearch] = useState("");
  const [tagFilter, setTagFilter] = useState("all");
  const [error, setError] = useState("");
  const [deletingId, setDeletingId] = useState("");
  const [theme, setTheme] = useState("sage");
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewData, setPreviewData] = useState(null);
  const [previewZoom, setPreviewZoom] = useState(100);
  const [previewFitWidth, setPreviewFitWidth] = useState(true);
  const [previewFullscreen, setPreviewFullscreen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
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

    setDocsLoading(true);
    setError("");

    try {
      const response = await fetch(`${API_BASE_URL}/documents?limit=150`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await parseJsonSafely(response);

      if (!response.ok) {
        throw new Error(data?.detail || "Failed to fetch documents.");
      }

      setDocuments(Array.isArray(data) ? data : []);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to fetch documents.";
      setError(message);
    } finally {
      setDocsLoading(false);
    }
  }, [router]);

  useEffect(() => {
    setUser(readStoredUser());
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

  useEffect(() => {
    const saved = getSavedTheme();
    setTheme(saved);
    applyTheme(saved);
  }, []);

  const handleThemeChange = (nextTheme) => {
    setTheme(nextTheme);
    localStorage.setItem(THEME_KEY, nextTheme);
    applyTheme(nextTheme);
  };

  const filteredDocuments = useMemo(() => {
    return documents.filter((doc) => {
      const nameMatch = doc.filename?.toLowerCase().includes(search.toLowerCase().trim());
      const statusMatch = tagFilter === "all" ? true : String(doc.status || "").toLowerCase() === tagFilter;
      return nameMatch && statusMatch;
    });
  }, [documents, search, tagFilter]);

  const handleDelete = async (documentId) => {
    const token = getAccessToken();
    if (!token) {
      router.replace("/");
      return;
    }

    setDeletingId(documentId);
    setError("");

    try {
      const response = await fetch(`${API_BASE_URL}/documents/${documentId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await parseJsonSafely(response);

      if (!response.ok) {
        throw new Error(data?.detail || "Failed to delete document.");
      }

      setDocuments((prev) => prev.filter((doc) => doc.id !== documentId));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to delete document.";
      setError(message);
    } finally {
      setDeletingId("");
    }
  };

  const openPreview = async (documentId) => {
    const token = getAccessToken();
    if (!token) {
      router.replace("/");
      return;
    }

    setPreviewLoading(true);
    setError("");

    try {
      const response = await fetch(`${API_BASE_URL}/documents/${documentId}/preview`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await parseJsonSafely(response);
      if (response.status === 401) {
        clearSession();
        router.replace("/");
        return;
      }
      if (!response.ok) {
        throw new Error(data?.detail || "Failed to load preview.");
      }
      setPreviewZoom(100);
      setPreviewFitWidth(true);
      setPreviewFullscreen(false);
      setPreviewData(data);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load preview.";
      setError(message);
    } finally {
      setPreviewLoading(false);
    }
  };

  const buildPdfPreviewUrl = (fileUrl) => {
    const base = resolveFileUrl(fileUrl);
    const zoomPart = previewFitWidth ? "page-width" : `${previewZoom}`;
    return `${base}#zoom=${zoomPart}`;
  };

  return (
    <main className="min-h-screen app-bg app-text">
      <div className="min-h-screen grid grid-cols-1 lg:grid-cols-[248px_1fr]">
        <aside className="border-r app-border app-sidebar px-4 py-6">
          <div className="px-2">
            <div className="flex items-center gap-2">
              <img src="/logo_of_app.png" alt="AskMyDocs" className="h-8 w-8 rounded-md object-cover" />
              <p className="text-sm font-semibold uppercase tracking-[0.18em] app-text">ASKMYDOCS</p>
            </div>
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
            <button type="button" className="w-full flex items-center gap-3 rounded-xl app-primary px-3 py-2.5 text-sm font-medium text-white">
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
            <button
              type="button"
              onClick={() => router.push("/app/settings")}
              className="w-full flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium app-nav-item"
            >
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
            <p className="text-sm font-medium app-muted">Document Library</p>
            <h2 className="mt-1 text-3xl font-semibold tracking-tight app-text">
              Manage your AI knowledge base
            </h2>
          </header>

          <div className="mt-6 grid gap-3 md:grid-cols-[1fr_220px]">
            <label className="relative block">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 app-muted" />
              <input
                type="text"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search documents..."
                className="w-full rounded-xl app-input pl-9 pr-3 py-2.5 text-sm"
              />
            </label>

            <select
              value={tagFilter}
              onChange={(event) => setTagFilter(event.target.value)}
              className="rounded-xl app-input px-3 py-2.5 text-sm"
            >
              <option value="all">Filter by tags: All</option>
              <option value="indexed">Indexed</option>
              <option value="processing">Processing</option>
              <option value="error">Error</option>
            </select>
          </div>

          {error ? <p className="mt-4 text-sm text-rose-600">{error}</p> : null}

          <div className="mt-6 overflow-hidden rounded-2xl border app-border app-surface shadow-sm">
            <div className="hidden md:grid grid-cols-[2fr_1.2fr_0.9fr_0.9fr_1.2fr] gap-4 border-b app-border app-soft px-5 py-3 text-xs font-semibold uppercase tracking-wide app-muted">
              <span>Document Name</span>
              <span>Upload Date</span>
              <span>File Size</span>
              <span>Status</span>
              <span>Actions</span>
            </div>

            {docsLoading ? (
              <div className="px-5 py-8 text-sm app-muted">Loading documents...</div>
            ) : filteredDocuments.length === 0 ? (
              <div className="px-5 py-8 text-sm app-muted">No documents found.</div>
            ) : (
              <div className="divide-y app-border">
                {filteredDocuments.map((doc) => (
                  <div
                    key={doc.id}
                    className="grid grid-cols-1 gap-3 px-5 py-4 text-sm md:grid-cols-[2fr_1.2fr_0.9fr_0.9fr_1.2fr] md:items-center"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium app-text">{doc.filename}</p>
                    </div>
                    <p className="app-muted">{formatUploadDate(doc.uploaded_at)}</p>
                    <p className="app-muted">{formatFileSize(doc.file_size_bytes)}</p>
                    <span className={`inline-flex w-fit rounded-full px-2.5 py-1 text-xs font-medium ${statusPill(doc.status)}`}>
                      {String(doc.status || "processing").replace(/^./, (s) => s.toUpperCase())}
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => void openPreview(doc.id)}
                        className="inline-flex items-center gap-1 rounded-lg border app-border app-soft px-2.5 py-1.5 text-xs font-medium app-text"
                      >
                        <Eye size={14} />
                        View
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          router.push(
                            `/app/chats?documentId=${encodeURIComponent(doc.id)}&documentName=${encodeURIComponent(doc.filename)}`,
                          )
                        }
                        className="rounded-lg app-primary px-3 py-1.5 text-xs font-medium text-white "
                      >
                        Chat with this file
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(doc.id)}
                        disabled={deletingId === doc.id}
                        className="rounded-lg border app-border app-soft p-1.5 app-muted disabled:opacity-60"
                        aria-label="Delete document"
                        title="Delete document"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {previewData ? (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
              <div
                className={`w-full rounded-2xl border app-border app-surface shadow-xl ${
                  previewFullscreen ? "h-[95vh] max-w-[95vw]" : "max-w-4xl"
                }`}
              >
                <div className="flex items-center justify-between border-b app-border px-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold app-text">{previewData.filename}</p>
                    <p className="text-xs app-muted">{previewData.mime_type}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setPreviewZoom((z) => Math.max(50, z - 10))}
                      className="rounded-lg border app-border app-soft p-1.5 app-muted"
                      title="Zoom out"
                    >
                      <Minus size={14} />
                    </button>
                    <span className="w-12 text-center text-xs app-muted">{previewZoom}%</span>
                    <button
                      type="button"
                      onClick={() => setPreviewZoom((z) => Math.min(200, z + 10))}
                      className="rounded-lg border app-border app-soft p-1.5 app-muted"
                      title="Zoom in"
                    >
                      <Plus size={14} />
                    </button>
                    <button
                      type="button"
                      onClick={() => setPreviewFitWidth((v) => !v)}
                      className="rounded-lg border app-border app-soft px-2.5 py-1.5 text-xs app-muted"
                      title="Fit width"
                    >
                      {previewFitWidth ? "Fit: On" : "Fit: Off"}
                    </button>
                    <a
                      href={resolveFileUrl(previewData.file_url)}
                      download={previewData.filename}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-lg border app-border app-soft p-1.5 app-muted"
                      title="Download file"
                    >
                      <Download size={14} />
                    </a>
                    <button
                      type="button"
                      onClick={() => setPreviewFullscreen((v) => !v)}
                      className="rounded-lg border app-border app-soft p-1.5 app-muted"
                      title="Toggle full screen"
                    >
                      {previewFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
                    </button>
                    <button
                      type="button"
                      onClick={() => setPreviewData(null)}
                      className="rounded-lg border app-border app-soft p-1.5 app-muted"
                      aria-label="Close preview"
                    >
                      <X size={16} />
                    </button>
                  </div>
                </div>

                <div className={`${previewFullscreen ? "h-[calc(95vh-56px)]" : "max-h-[70vh]"} overflow-auto p-4`}>
                  {previewLoading ? <p className="text-sm app-muted">Loading preview...</p> : null}

                  {!previewLoading && previewData.preview_type === "text" ? (
                    <pre
                      className="whitespace-pre-wrap break-words rounded-xl app-soft p-4 app-text"
                      style={{ fontSize: `${Math.max(11, Math.min(22, previewZoom / 8 + 10))}px` }}
                    >
                      {previewData.content || "No text preview available for this file."}
                    </pre>
                  ) : null}

                  {!previewLoading && previewData.preview_type === "image" ? (
                    <img
                      src={resolveFileUrl(previewData.file_url)}
                      alt={previewData.filename}
                      className={`mx-auto rounded-xl border app-border object-contain ${
                        previewFitWidth ? "w-full h-auto" : "max-h-[62vh]"
                      }`}
                      style={previewFitWidth ? undefined : { transform: `scale(${previewZoom / 100})`, transformOrigin: "top center" }}
                    />
                  ) : null}

                  {!previewLoading && previewData.preview_type === "pdf" ? (
                    <iframe
                      src={buildPdfPreviewUrl(previewData.file_url)}
                      title={previewData.filename}
                      className={`w-full rounded-xl border app-border ${previewFullscreen ? "h-[calc(95vh-140px)]" : "h-[62vh]"}`}
                    />
                  ) : null}

                  {!previewLoading && previewData.preview_type === "docx" ? (
                    <DocxPreview
                      fileUrl={resolveFileUrl(previewData.file_url)}
                      zoom={previewZoom}
                      fitWidth={previewFitWidth}
                      heightClass={previewFullscreen ? "h-[calc(95vh-140px)]" : "h-[62vh]"}
                    />
                  ) : null}

                  {!previewLoading && !["text", "image", "pdf", "docx"].includes(previewData.preview_type) ? (
                    <div className="rounded-xl app-soft p-4 text-sm app-muted">
                      Preview is not available for this file type.
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          ) : null}
        </section>
      </div>
    </main>
  );
}
