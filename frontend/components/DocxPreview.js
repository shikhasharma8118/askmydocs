"use client";

import { useEffect, useRef, useState } from "react";

export default function DocxPreview({
  fileUrl,
  heightClass = "h-[62vh]",
  zoom = 100,
  fitWidth = false,
}) {
  const containerRef = useRef(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;

    const renderDocx = async () => {
      if (!fileUrl || !containerRef.current) {
        return;
      }

      setLoading(true);
      setError("");

      try {
        const { renderAsync } = await import("docx-preview");
        const response = await fetch(fileUrl);
        if (!response.ok) {
          throw new Error("Could not fetch DOCX file.");
        }
        const buffer = await response.arrayBuffer();
        if (!alive || !containerRef.current) {
          return;
        }

        containerRef.current.innerHTML = "";
        await renderAsync(buffer, containerRef.current, undefined, {
          className: "docx",
          inWrapper: true,
          breakPages: true,
          ignoreWidth: false,
          ignoreHeight: false,
          renderHeaders: true,
          renderFooters: true,
          renderFootnotes: true,
        });
      } catch (err) {
        if (!alive) {
          return;
        }
        const message = err instanceof Error ? err.message : "DOCX preview failed.";
        setError(message);
      } finally {
        if (alive) {
          setLoading(false);
        }
      }
    };

    renderDocx();
    return () => {
      alive = false;
    };
  }, [fileUrl]);

  return (
    <div className={`${heightClass} w-full overflow-auto rounded-xl border app-border bg-white`}>
      {loading ? <p className="px-4 py-3 text-sm app-muted">Loading Word preview...</p> : null}
      {error ? <p className="px-4 py-3 text-sm text-rose-700">{error}</p> : null}
      <div
        ref={containerRef}
        className={`docx-preview-host px-3 py-3 ${fitWidth ? "docx-fit-width" : ""}`}
        style={{ zoom: `${Math.max(50, Math.min(200, zoom))}%` }}
      />
    </div>
  );
}
