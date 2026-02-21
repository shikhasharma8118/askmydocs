"use client";

import { signOut } from "firebase/auth";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Download,
  FileText,
  Home,
  Maximize2,
  MessageSquare,
  Mic,
  Minimize2,
  Minus,
  Paperclip,
  Plus,
  Send,
  Settings,
} from "lucide-react";

import { auth } from "../../../lib/firebase";
import DocxPreview from "../../../components/DocxPreview";
import { getValidAccessToken } from "../../../lib/session";
import { APP_THEMES, applyTheme, getSavedTheme, THEME_KEY } from "../../../lib/theme";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "http://127.0.0.1:8000";
const STORE_ANSWERS_KEY = "askmydocs_store_answers";

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

export default function ChatsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [user, setUser] = useState(null);
  const [logoutLoading, setLogoutLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [chatError, setChatError] = useState("");
  const [theme, setTheme] = useState("sage");
  const [message, setMessage] = useState("");
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewData, setPreviewData] = useState(null);
  const [docSummary, setDocSummary] = useState("");
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryExpanded, setSummaryExpanded] = useState(false);
  const [selectedSource, setSelectedSource] = useState(null);
  const [selectedCitationId, setSelectedCitationId] = useState("");
  const [pdfjsApi, setPdfjsApi] = useState(null);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfError, setPdfError] = useState("");
  const [pdfUseIframeFallback, setPdfUseIframeFallback] = useState(false);
  const [viewerZoom, setViewerZoom] = useState(100);
  const [viewerFitWidth, setViewerFitWidth] = useState(true);
  const [viewerFullscreen, setViewerFullscreen] = useState(false);
  const [messages, setMessages] = useState([
    {
      id: "ai-1",
      role: "ai",
      text: "Ask your question about this document. I will summarize using the file context and show page citations.",
    },
  ]);

  const activeDocumentId = useMemo(() => searchParams.get("documentId"), [searchParams]);
  const activeDocumentName = useMemo(() => {
    const queryName = searchParams.get("documentName");
    return queryName || "Q3_Financial_Report.pdf";
  }, [searchParams]);

  const activeDocumentUrl = useMemo(() => {
    if (!previewData?.file_url) {
      return "";
    }
    if (previewData.file_url.startsWith("http://") || previewData.file_url.startsWith("https://")) {
      return previewData.file_url;
    }
    return `${API_BASE_URL}${previewData.file_url.startsWith("/") ? previewData.file_url : `/${previewData.file_url}`}`;
  }, [previewData]);

  const buildPdfViewerUrl = useCallback(
    (baseUrl, pageNumber) => {
      const safePage = Math.max(1, Number(pageNumber || 1));
      const zoomPart = viewerFitWidth ? "page-width" : `${viewerZoom}`;
      return `${baseUrl}#page=${safePage}&zoom=${zoomPart}`;
    },
    [viewerFitWidth, viewerZoom],
  );

  const pdfCanvasRef = useRef(null);
  const pdfTextLayerRef = useRef(null);
  const viewerShellRef = useRef(null);
  const pdfScrollRef = useRef(null);

  const clearSession = () => {
    localStorage.removeItem("access_token");
    localStorage.removeItem("current_user");
    localStorage.removeItem("auth_mode");
  };

  const getAccessToken = () => {
    return getValidAccessToken();
  };

  async function parseJsonSafely(response) {
    try {
      return await response.json();
    } catch {
      return null;
    }
  }

  useEffect(() => {
    setUser(readStoredUser());
  }, []);

  useEffect(() => {
    const saved = getSavedTheme();
    setTheme(saved);
    applyTheme(saved);
  }, []);

  useEffect(() => {
    let alive = true;

    const loadPdfJs = async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = new URL(
          "pdfjs-dist/build/pdf.worker.min.mjs",
          import.meta.url,
        ).toString();
        if (alive) {
          setPdfjsApi(pdfjs);
        }
      } catch {
        if (alive) {
          setPdfError("PDF renderer could not be loaded.");
        }
      }
    };

    loadPdfJs();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const loadPreview = async () => {
      if (!activeDocumentId) {
        setPreviewData(null);
        return;
      }

      const token = getAccessToken();
      if (!token) {
        router.replace("/");
        return;
      }

      setPreviewLoading(true);
      try {
        const response = await fetch(`${API_BASE_URL}/documents/${activeDocumentId}/preview`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await parseJsonSafely(response);
        if (response.status === 401) {
          clearSession();
          router.replace("/");
          return;
        }
        if (!response.ok) {
          throw new Error(data?.detail || "Failed to load file preview.");
        }
      setViewerZoom(100);
      setViewerFitWidth(true);
      setPdfUseIframeFallback(false);
      setPdfError("");
      setPreviewData(data);
      } catch (err) {
        const messageText = err instanceof Error ? err.message : "Failed to load file preview.";
        setChatError(messageText);
      } finally {
        setPreviewLoading(false);
      }
    };

    loadPreview();
  }, [activeDocumentId, router]);

  useEffect(() => {
    const loadSummary = async () => {
      if (!activeDocumentId) {
        setDocSummary("");
        return;
      }

      const token = getAccessToken();
      if (!token) {
        return;
      }

      setSummaryLoading(true);
      try {
        const response = await fetch(`${API_BASE_URL}/documents/${activeDocumentId}/summary?refresh=true`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await parseJsonSafely(response);
        if (!response.ok) {
          setDocSummary("");
          return;
        }
        setDocSummary(typeof data?.summary === "string" ? data.summary : "");
      } catch {
        setDocSummary("");
      } finally {
        setSummaryLoading(false);
      }
    };

    loadSummary();
  }, [activeDocumentId]);

  const renderPdfVerification = useCallback(async () => {
    if (
      pdfUseIframeFallback ||
      !pdfjsApi ||
      !activeDocumentUrl ||
      previewData?.preview_type !== "pdf" ||
      !pdfCanvasRef.current ||
      !pdfTextLayerRef.current
    ) {
      return;
    }

    setPdfBusy(true);
    setPdfError("");

    try {
      const pageNumber = Math.max(1, Number(selectedSource?.page || 1));
      const loadingTask = pdfjsApi.getDocument({ url: activeDocumentUrl });
      const pdf = await loadingTask.promise;
      const page = await pdf.getPage(Math.min(pageNumber, pdf.numPages));

      const rawViewport = page.getViewport({ scale: 1 });
      const canvas = pdfCanvasRef.current;
      const textLayer = pdfTextLayerRef.current;
      const shell = pdfScrollRef.current;
      const context = canvas.getContext("2d");
      const dpr = window.devicePixelRatio || 1;
      let scale = Math.max(0.6, Math.min(3.0, viewerZoom / 100));
      if (viewerFitWidth && shell) {
        const fitScale = (shell.clientWidth - 24) / rawViewport.width;
        if (Number.isFinite(fitScale) && fitScale > 0) {
          scale = Math.max(0.6, Math.min(3.0, fitScale));
        }
      }
      const viewport = page.getViewport({ scale });

      canvas.width = Math.floor(viewport.width * dpr);
      canvas.height = Math.floor(viewport.height * dpr);
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;
      context.setTransform(dpr, 0, 0, dpr, 0, 0);

      await page.render({ canvasContext: context, viewport }).promise;

      textLayer.innerHTML = "";
      textLayer.style.width = `${viewport.width}px`;
      textLayer.style.height = `${viewport.height}px`;

      const textContent = await page.getTextContent();
      await pdfjsApi.renderTextLayer({
        textContentSource: textContent,
        container: textLayer,
        viewport,
      }).promise;

      const snippet = String(selectedSource?.snippet || "").toLowerCase();
      const snippetTokens = snippet
        .split(/[^a-z0-9]+/i)
        .map((token) => token.trim())
        .filter((token) => token.length > 4);

      if (snippetTokens.length) {
        const spans = Array.from(textLayer.querySelectorAll("span"));
        const scored = spans
          .map((span) => {
            const text = (span.textContent || "").toLowerCase();
            const score = snippetTokens.reduce(
              (sum, token) => (text.includes(token) ? sum + 1 : sum),
              0,
            );
            return { span, score };
          })
          .filter((item) => item.score > 0)
          .sort((a, b) => b.score - a.score)
          .slice(0, 24);

        scored.forEach(({ span }) => {
          span.style.background = "rgba(255, 232, 128, 0.78)";
          span.style.borderRadius = "2px";
        });
      }
    } catch {
      setPdfUseIframeFallback(true);
      setPdfError("PDF.js rendering failed. Switched to compatible viewer.");
    } finally {
      setPdfBusy(false);
    }
  }, [
    activeDocumentUrl,
    pdfUseIframeFallback,
    pdfjsApi,
    previewData?.preview_type,
    selectedSource?.page,
    selectedSource?.snippet,
    viewerZoom,
    viewerFitWidth,
  ]);

  useEffect(() => {
    renderPdfVerification();
  }, [renderPdfVerification]);

  useEffect(() => {
    const onFsChange = () => {
      setViewerFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, []);

  const toggleViewerFullscreen = async () => {
    if (!viewerShellRef.current) {
      return;
    }
    try {
      if (!document.fullscreenElement) {
        await viewerShellRef.current.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch {
      // Ignore fullscreen API errors.
    }
  };

  const handleThemeChange = (nextTheme) => {
    setTheme(nextTheme);
    localStorage.setItem(THEME_KEY, nextTheme);
    applyTheme(nextTheme);
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

  const handleCitationClick = useCallback(
    (source, citationId) => {
      setSelectedSource(source);
      setSelectedCitationId(citationId);

      // Keep the right-side viewer focused when a citation is clicked.
      viewerShellRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });

      // For scrollable viewers, ensure the navigated page/content is visible from the top.
      if (pdfScrollRef.current) {
        pdfScrollRef.current.scrollTo({ top: 0, behavior: "smooth" });
      }
    },
    [],
  );

  const handleSend = async () => {
    const trimmed = message.trim();
    if (!trimmed) {
      return;
    }

    const token = getAccessToken();
    if (!token) {
      router.replace("/");
      return;
    }
    if (!activeDocumentId) {
      setChatError("Please open chat from a selected document.");
      return;
    }

    const userMessage = { id: `user-${Date.now()}`, role: "user", text: trimmed, sources: [] };
    setMessages((prev) => [...prev, userMessage]);
    setMessage("");
    setChatError("");
    setSending(true);

    try {
      const response = await fetch(`${API_BASE_URL}/chats/ask`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          question: trimmed,
          document_id: activeDocumentId,
        }),
      });
      const data = await parseJsonSafely(response);

      if (!response.ok) {
        throw new Error(data?.detail || "Failed to get answer.");
      }

      const aiMessage = {
        id: `ai-${Date.now()}`,
        role: "ai",
        text: data?.answer || "No answer returned.",
        sources: Array.isArray(data?.sources) ? data.sources : [],
      };
      if (localStorage.getItem(STORE_ANSWERS_KEY) !== "false") {
        try {
          const historyKey = "askmydocs_answer_exports";
          const raw = localStorage.getItem(historyKey);
          const existing = raw ? JSON.parse(raw) : [];
          const next = Array.isArray(existing) ? existing : [];
          next.push({
            id: aiMessage.id,
            document_id: activeDocumentId,
            document_name: activeDocumentName,
            question: trimmed,
            answer: aiMessage.text,
            sources: aiMessage.sources,
            created_at: new Date().toISOString(),
          });
          localStorage.setItem(historyKey, JSON.stringify(next.slice(-200)));
        } catch {
          // Ignore local export cache errors.
        }
      }
      if (aiMessage.sources.length) {
        handleCitationClick(aiMessage.sources[0], `${aiMessage.id}-source-0`);
      }
      setMessages((prev) => [...prev, aiMessage]);
    } catch (err) {
      const messageText = err instanceof Error ? err.message : "Failed to get answer.";
      setChatError(messageText);
      setMessages((prev) => [
        ...prev,
        {
          id: `ai-error-${Date.now()}`,
          role: "ai",
          text: "I could not answer that right now.",
          sources: [],
        },
      ]);
    } finally {
      setSending(false);
    }
  };

  return (
    <main className="min-h-screen lg:h-[100dvh] lg:overflow-hidden app-bg app-text">
      <div className="min-h-screen lg:h-full grid grid-cols-1 lg:grid-cols-[248px_1fr]">
        <aside className="hidden lg:block border-r app-border app-sidebar px-4 py-6 overflow-y-auto">
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
              className="w-full flex items-center gap-3 rounded-xl app-primary px-3 py-2.5 text-sm font-medium text-white"
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
            disabled={logoutLoading}
            className="mt-4 w-full rounded-xl border app-border app-soft px-4 py-2.5 text-sm font-medium app-text disabled:opacity-60"
          >
            {logoutLoading ? "Logging out..." : "Logout"}
          </button>
        </aside>

        <section className="px-4 py-4 md:px-6 md:py-5 lg:px-8 lg:py-6 flex flex-col min-h-screen lg:h-full overflow-y-auto lg:overflow-hidden antialiased [text-rendering:optimizeLegibility]">
          <header className="rounded-2xl border app-border app-surface px-5 py-4 shadow-sm">
            <p className="text-xs uppercase tracking-wide app-muted">Currently chatting with:</p>
            <h2 className="mt-1 text-lg font-semibold app-text">{activeDocumentName}</h2>
          </header>

          <div className="mt-4 grid gap-4 lg:grid-cols-[40%_60%] lg:flex-1 lg:min-h-0">
            <div className="rounded-2xl border app-border app-surface p-4 shadow-sm flex min-h-0 flex-col">
              <div className="sticky top-0 z-10 rounded-xl border app-border app-soft app-surface/95 backdrop-blur supports-[backdrop-filter]:app-surface/85 shadow-[0_8px_18px_-14px_rgba(15,23,42,0.45)] p-3 mb-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs uppercase tracking-wide app-muted">Document Summary</p>
                  {!summaryLoading && docSummary ? (
                    <button
                      type="button"
                      onClick={() => setSummaryExpanded((v) => !v)}
                      className="rounded-md border app-border app-soft px-2 py-0.5 text-[11px] app-muted"
                    >
                      {summaryExpanded ? "Show less" : "Show more"}
                    </button>
                  ) : null}
                </div>
                {summaryLoading ? (
                  <p className="mt-1 text-sm app-muted">Generating summary...</p>
                ) : docSummary ? (
                  <pre
                    className={`mt-1 whitespace-pre-wrap text-sm leading-relaxed app-text ${
                      summaryExpanded ? "max-h-72 overflow-y-auto" : "max-h-28 overflow-y-auto"
                    }`}
                  >
                    {docSummary}
                  </pre>
                ) : (
                  <p className="mt-1 text-sm app-muted">No summary available yet for this document.</p>
                )}
              </div>

              <div className="flex-1 min-h-0 overflow-y-auto">
                <div className="mx-auto max-w-4xl space-y-4">
                  {messages.map((item) => (
                    <div
                      key={item.id}
                      className={`flex ${item.role === "user" ? "justify-end" : "justify-start"}`}
                    >
                      <div
                        className={`max-w-[88%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                          item.role === "user"
                            ? "app-bubble-user text-white rounded-br-md"
                            : "app-bubble-ai app-text rounded-bl-md"
                        }`}
                      >
                        <div>{item.text}</div>
                        {item.role === "ai" && Array.isArray(item.sources) && item.sources.length ? (
                          <div className="mt-3 flex flex-wrap items-center gap-1.5">
                            {item.sources.map((source, idx) => (
                              <button
                                key={`${item.id}-source-${idx}`}
                                type="button"
                                onClick={() =>
                                  handleCitationClick(source, `${item.id}-source-${idx}`)
                                }
                                className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium transition ${
                                  selectedCitationId === `${item.id}-source-${idx}`
                                    ? "border-[#6b8fe3] bg-[#dce8ff] text-[#2f4f9a]"
                                    : "app-border bg-[#eef3ff] text-[#3556a8]"
                                }`}
                                title={`Jump to Page ${source.page}`}
                              >
                                [Page {source.page}]
                              </button>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <footer className="mt-3 rounded-2xl border app-border app-surface p-3 shadow-sm">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    className="rounded-xl border app-border app-soft p-2 app-muted"
                    title="Attach file"
                  >
                    <Paperclip size={18} />
                  </button>
                  <button
                    type="button"
                    className="rounded-xl border app-border app-soft p-2 app-muted"
                    title="Voice to text"
                  >
                    <Mic size={18} />
                  </button>

                  <input
                    type="text"
                    value={message}
                    onChange={(event) => setMessage(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        void handleSend();
                      }
                    }}
                    placeholder="Ask a question about this document..."
                    className="flex-1 rounded-xl app-input px-4 py-2.5 text-sm"
                  />

                  <button
                    type="button"
                    onClick={() => void handleSend()}
                    disabled={sending}
                    className="inline-flex items-center gap-2 rounded-xl app-primary px-4 py-2.5 text-sm font-medium text-white disabled:opacity-60"
                  >
                    <Send size={16} />
                    {sending ? "Sending..." : "Send"}
                  </button>
                </div>
                {chatError ? <p className="mt-3 text-sm text-rose-600">{chatError}</p> : null}
              </footer>
            </div>

            <aside ref={viewerShellRef} className="rounded-2xl border app-border app-surface p-4 shadow-sm min-h-0 flex flex-col">
              <div className="mb-3">
                <p className="text-xs uppercase tracking-wide app-muted">Document Viewer</p>
                <p className="mt-1 text-sm font-semibold app-text">{activeDocumentName}</p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setViewerZoom((z) => Math.max(50, z - 10))}
                    className="rounded-lg border app-border app-soft p-1.5 app-muted"
                    title="Zoom out"
                  >
                    <Minus size={14} />
                  </button>
                  <span className="w-12 text-center text-xs app-muted">{viewerZoom}%</span>
                  <button
                    type="button"
                    onClick={() => setViewerZoom((z) => Math.min(200, z + 10))}
                    className="rounded-lg border app-border app-soft p-1.5 app-muted"
                    title="Zoom in"
                  >
                    <Plus size={14} />
                  </button>
                  <button
                    type="button"
                    onClick={() => setViewerFitWidth((v) => !v)}
                    className="rounded-lg border app-border app-soft px-2.5 py-1.5 text-xs app-muted"
                  >
                    {viewerFitWidth ? "Fit: On" : "Fit: Off"}
                  </button>
                  {previewData?.file_url ? (
                    <a
                      href={activeDocumentUrl}
                      download={previewData.filename || activeDocumentName}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-lg border app-border app-soft p-1.5 app-muted"
                      title="Download file"
                    >
                      <Download size={14} />
                    </a>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => void toggleViewerFullscreen()}
                    className="rounded-lg border app-border app-soft p-1.5 app-muted"
                    title="Toggle fullscreen"
                  >
                    {viewerFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
                  </button>
                </div>
              </div>

              <div ref={pdfScrollRef} className="flex-1 min-h-0 rounded-xl border app-border app-soft overflow-hidden">
                {previewLoading ? (
                  <div className="h-full flex items-center justify-center text-sm app-muted">Loading viewer...</div>
                ) : previewData?.preview_type === "pdf" ? (
                  pdfUseIframeFallback ? (
                    <div className="relative h-full bg-white">
                      {pdfError ? <div className="px-3 py-2 text-xs text-amber-700">{pdfError}</div> : null}
                      <iframe
                        src={buildPdfViewerUrl(activeDocumentUrl, selectedSource?.page)}
                        title={activeDocumentName}
                        className="h-full w-full"
                      />
                    </div>
                  ) : (
                    <div className="relative h-full overflow-auto bg-white">
                      {pdfBusy ? (
                        <div className="sticky top-0 z-10 bg-white/85 px-3 py-1.5 text-xs text-slate-600">
                          Rendering page {selectedSource?.page || 1}...
                        </div>
                      ) : null}
                      {pdfError ? (
                        <div className="px-3 py-2 text-xs text-rose-700">{pdfError}</div>
                      ) : null}
                      <div className="relative mx-auto w-fit p-3">
                        <canvas ref={pdfCanvasRef} className="block rounded-sm shadow-sm" />
                        <div
                          ref={pdfTextLayerRef}
                          className="pdf-text-layer pointer-events-none absolute left-3 top-3 select-none"
                          style={{ transformOrigin: "0 0" }}
                        />
                      </div>
                    </div>
                  )
                ) : previewData?.preview_type === "image" ? (
                  <img
                    src={activeDocumentUrl}
                    alt={activeDocumentName}
                    className={`h-full w-full object-contain ${viewerFitWidth ? "" : "origin-top"}`}
                    style={viewerFitWidth ? undefined : { transform: `scale(${viewerZoom / 100})` }}
                  />
                ) : previewData?.preview_type === "docx" ? (
                  <DocxPreview
                    fileUrl={activeDocumentUrl}
                    heightClass="h-full"
                    zoom={viewerZoom}
                    fitWidth={viewerFitWidth}
                  />
                ) : previewData?.preview_type === "text" ? (
                  <pre
                    className="h-full overflow-auto whitespace-pre-wrap p-3 app-text"
                    style={{ fontSize: `${Math.max(11, Math.min(22, viewerZoom / 8 + 10))}px` }}
                  >
                    {previewData.content || "No text preview available."}
                  </pre>
                ) : (
                  <div className="h-full flex items-center justify-center px-4 text-sm app-muted text-center">
                    Open this file from Documents page preview for full details.
                  </div>
                )}
              </div>

            </aside>
          </div>

          <div className="mt-3 text-xs app-muted">
            Citations are shown as clickable page badges in each AI response.
          </div>
        </section>
      </div>
    </main>
  );
}
