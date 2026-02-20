"use client";

import { signOut } from "firebase/auth";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  CloudUpload,
  Download,
  FileText,
  Maximize2,
  Minimize2,
  Home,
  Loader2,
  MessageSquare,
  Minus,
  Settings,
  Plus,
  X,
} from "lucide-react";

import { auth } from "../../lib/firebase";
import DocxPreview from "../../components/DocxPreview";
import { getValidAccessToken } from "../../lib/session";
import { APP_THEMES, applyTheme, getSavedTheme, THEME_KEY } from "../../lib/theme";

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

function formatTimestamp(value) {
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
    hour: "2-digit",
    minute: "2-digit",
  });
}

async function parseJsonSafely(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function normalizeFiles(input) {
  if (!input) {
    return [];
  }

  if (typeof DataTransfer !== "undefined" && input instanceof DataTransfer) {
    if (input.items && input.items.length) {
      return Array.from(input.items)
        .filter((item) => item.kind === "file")
        .map((item) => item.getAsFile())
        .filter(Boolean);
    }
    return Array.from(input.files || []);
  }

  return Array.from(input);
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

export default function MainAppPage() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(false);
  const [documents, setDocuments] = useState([]);
  const [docsLoading, setDocsLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [docError, setDocError] = useState("");
  const [theme, setTheme] = useState("sage");
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewData, setPreviewData] = useState(null);
  const [previewZoom, setPreviewZoom] = useState(100);
  const [previewFitWidth, setPreviewFitWidth] = useState(true);
  const [previewFullscreen, setPreviewFullscreen] = useState(false);
  const fileInputRef = useRef(null);

  const clearSession = () => {
    localStorage.removeItem("access_token");
    localStorage.removeItem("current_user");
    localStorage.removeItem("auth_mode");
  };

  const getAccessToken = () => {
    return getValidAccessToken();
  };

  const handleLogout = async () => {
    setLoading(true);
    try {
      await signOut(auth);
    } catch {
      // Ignore Firebase sign-out errors and still clear local session.
    } finally {
      clearSession();
      router.replace("/");
      setLoading(false);
    }
  };

  const fetchRecentDocuments = useCallback(async () => {
    const token = getAccessToken();
    if (!token) {
      router.replace("/");
      return;
    }

    setDocsLoading(true);

    try {
      const response = await fetch(`${API_BASE_URL}/documents/recent?limit=12`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await parseJsonSafely(response);

      if (!response.ok) {
        throw new Error(data?.detail || "Failed to load documents.");
      }

      setDocuments(Array.isArray(data) ? data : []);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load documents.";
      setDocError(message);
    } finally {
      setDocsLoading(false);
    }
  }, [router]);

  useEffect(() => {
    setUser(readStoredUser());
  }, []);

  useEffect(() => {
    fetchRecentDocuments();
  }, [fetchRecentDocuments]);

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

  const uploadFiles = async (fileInput) => {
    const token = getAccessToken();
    if (!token) {
      router.replace("/");
      return;
    }

    const allFiles = normalizeFiles(fileInput);
    if (!allFiles.length) {
      setDocError("Please select at least one file.");
      return;
    }

    setDocError("");
    setUploading(true);

    try {
      const uploaded = [];

      for (const file of allFiles) {
        const formData = new FormData();
        formData.append("file", file);

        const response = await fetch(`${API_BASE_URL}/documents/upload`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          body: formData,
        });
        const data = await parseJsonSafely(response);

        if (!response.ok) {
          throw new Error(data?.detail || `Upload failed for ${file.name}`);
        }

        uploaded.push(data);
      }

      setDocuments((prev) => {
        const uploadedIds = new Set(uploaded.map((doc) => doc.id));
        const deduped = prev.filter((doc) => !uploadedIds.has(doc.id));
        return [...uploaded, ...deduped];
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to upload document.";
      setDocError(message);
    } finally {
      setUploading(false);
    }
  };

  const handleFileSelect = async (event) => {
    await uploadFiles(event.target.files);
    if (event.target) {
      event.target.value = "";
    }
  };

  const handleDrop = async (event) => {
    event.preventDefault();
    setDragActive(false);
    await uploadFiles(event.dataTransfer);
  };

  const openPreview = async (documentId) => {
    const token = getAccessToken();
    if (!token) {
      router.replace("/");
      return;
    }

    setPreviewLoading(true);
    setDocError("");

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
      setDocError(message);
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
            <p className="text-sm font-semibold uppercase tracking-[0.18em] app-text">ASKMYDOCS</p>
            <h1 className="mt-1 text-xl font-semibold app-text">Workspace</h1>
          </div>

          <nav className="mt-8 space-y-1">
            <button type="button" className="w-full flex items-center gap-3 rounded-xl app-primary px-3 py-2.5 text-sm font-medium text-white">
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
            <button
              type="button"
              onClick={() => router.push("/app/settings")}
              className="w-full flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium app-nav-item"
            >
              <Settings size={18} />
              Settings
            </button>
          </nav>

          <div className="mt-8 rounded-xl border app-border app-soft p-3 text-xs app-muted">
            <p className="font-medium app-text">Signed in as</p>
            <p className="mt-1 truncate">{user?.email || "Unknown user"}</p>
          </div>

          <div className="mt-4 rounded-xl border app-border app-soft p-3">
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

          <button
            type="button"
            onClick={handleLogout}
            disabled={loading}
            className="mt-4 w-full rounded-xl border app-border app-soft px-4 py-2.5 text-sm font-medium app-text disabled:opacity-60"
          >
            {loading ? "Logging out..." : "Logout"}
          </button>
        </aside>

        <section className="px-6 py-8 md:px-10">
          <header>
            <p className="text-sm font-medium app-muted">Welcome back</p>
            <h2 className="mt-1 text-3xl font-semibold tracking-tight">
              {user?.display_name ? `Hi, ${user.display_name}` : "Hi there"}{" "}
              <span className="app-muted">- ready to ask your files?</span>
            </h2>
          </header>

          <div
            className={`mt-8 rounded-2xl border-2 border-dashed app-surface p-10 text-center shadow-sm transition ${
              dragActive ? "app-primary-border app-sidebar" : "app-border"
            }`}
            onDragOver={(event) => {
              event.preventDefault();
              setDragActive(true);
            }}
            onDragLeave={(event) => {
              event.preventDefault();
              setDragActive(false);
            }}
            onDrop={handleDrop}
          >
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={handleFileSelect}
            />

            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full app-soft app-muted">
              {uploading ? <Loader2 size={28} className="animate-spin" /> : <CloudUpload size={28} />}
            </div>
            <h3 className="mt-4 text-xl font-semibold app-text">Drag and Drop Files</h3>
            <p className="mt-2 text-sm app-muted">
              Drop files here, or click to browse. PDFs, documents, images, and text files are supported.
            </p>
            <button
              type="button"
              className="mt-5 rounded-xl app-primary px-5 py-2.5 text-sm font-medium text-white disabled:opacity-60"
              disabled={uploading}
              onClick={() => fileInputRef.current?.click()}
            >
              {uploading ? "Uploading..." : "Upload Documents"}
            </button>
            {docError ? <p className="mt-3 text-sm text-red-600">{docError}</p> : null}
          </div>

          <div className="mt-10">
            <h3 className="text-lg font-semibold app-text">Recent Documents</h3>

            {docsLoading ? (
              <div className="mt-4 rounded-xl border app-border app-surface p-6 text-sm app-muted">
                Loading recent documents...
              </div>
            ) : documents.length ? (
              <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {documents.map((doc) => (
                  <button
                    key={doc.id}
                    type="button"
                    onClick={() => void openPreview(doc.id)}
                    className="rounded-xl border app-border app-surface p-4 shadow-sm text-left hover:shadow-md transition"
                  >
                    <div className="flex items-start gap-3">
                      <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-red-50 text-red-600">
                        <FileText size={18} />
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium app-text" title={doc.filename}>
                          {doc.filename}
                        </p>
                        <p className="mt-1 text-xs app-muted">Last Asked: {formatTimestamp(doc.uploaded_at)}</p>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <div className="mt-4 rounded-xl border border-dashed app-border app-surface p-6 text-sm app-muted">
                No documents yet. Uploaded files will appear here.
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
