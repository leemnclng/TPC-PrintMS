import { useEffect, useRef, useState, type CSSProperties } from "react";
import { getDocument, GlobalWorkerOptions, type PDFDocumentLoadingTask, type RenderTask } from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { Button } from "../Button/Button";
import { api } from "../../lib/apiClient";
import type { DocumentOrientation, JobFile } from "../../types/domain";
import "./PrinterOutputPreview.css";

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

type PrintOrientation = "auto" | "portrait" | "landscape";
type PrintScaling = "auto" | "fit" | "fill" | "actual_size";

interface Props {
  orderId: string;
  file?: JobFile;
  paperLabel: string;
  paperWidthMm: number;
  paperHeightMm: number;
  orientation: PrintOrientation;
  scaling: PrintScaling;
  borderless: boolean;
}

export function PrinterOutputPreview({
  orderId,
  file,
  paperLabel,
  paperWidthMm,
  paperHeightMm,
  orientation,
  scaling,
  borderless,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [sourceUrl, setSourceUrl] = useState<string | null>(null);
  const [pdfData, setPdfData] = useState<Uint8Array | null>(null);
  const [sourceKind, setSourceKind] = useState<"image" | "pdf" | "unsupported" | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadVersion, setLoadVersion] = useState(0);

  const resolvedOrientation = resolveOrientation(orientation, file?.detectedOrientation);
  const widthMm = resolvedOrientation === "landscape" ? Math.max(paperWidthMm, paperHeightMm) : Math.min(paperWidthMm, paperHeightMm);
  const heightMm = resolvedOrientation === "landscape" ? Math.min(paperWidthMm, paperHeightMm) : Math.max(paperWidthMm, paperHeightMm);
  const previewStyle = {
    "--print-paper-aspect": `${widthMm} / ${heightMm}`,
    "--print-paper-max-width": `${Math.min(80, 56 * (widthMm / heightMm))}vh`,
  } as CSSProperties;

  useEffect(() => {
    if (!file) {
      setSourceUrl(null);
      setPdfData(null);
      setSourceKind(null);
      setError(null);
      return;
    }
    let disposed = false;
    let objectUrl: string | null = null;
    setLoading(true);
    setError(null);
    setSourceUrl(null);
    setPdfData(null);
    setSourceKind(null);
    api.download(`/job-orders/${orderId}/files/${file.id}`)
      .then(async (blob) => {
        if (disposed) return;
        const kind = fileKind(blob.type, file.originalFilename);
        if (kind === "pdf") {
          // pdf.js loading a blob: URL by string depends on it being able to
          // fetch/range-request that URL, which is exactly the path that
          // failed here — handing it the bytes directly (the same approach
          // PdfViewer already uses successfully) sidesteps that entirely.
          const buffer = await blob.arrayBuffer();
          if (disposed) return;
          setPdfData(new Uint8Array(buffer));
        } else if (kind === "image") {
          objectUrl = URL.createObjectURL(blob);
          setSourceUrl(objectUrl);
        }
        setSourceKind(kind);
      })
      .catch(() => {
        if (!disposed) setError("The retained print file could not be loaded. Retry before submitting the job.");
      })
      .finally(() => {
        if (!disposed) setLoading(false);
      });
    return () => {
      disposed = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [file, loadVersion, orderId]);

  useEffect(() => {
    if (!pdfData || sourceKind !== "pdf" || !canvasRef.current) return;
    const data = pdfData;
    let disposed = false;
    let loadingTask: PDFDocumentLoadingTask | null = null;
    let renderTask: RenderTask | null = null;
    async function renderFirstPage() {
      try {
        loadingTask = getDocument({ data });
        const document = await loadingTask.promise;
        const page = await document.getPage(1);
        if (disposed || !canvasRef.current) return;
        const viewport = page.getViewport({ scale: 1.5 });
        const canvas = canvasRef.current;
        const context = canvas.getContext("2d", { alpha: false });
        if (!context) throw new Error("Canvas unavailable");
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        renderTask = page.render({ canvasContext: context, viewport });
        await renderTask.promise;
      } catch (caught) {
        if (!disposed && !(caught instanceof Error && caught.name === "RenderingCancelledException")) {
          setError("The first PDF page could not be rendered for this print proof.");
        }
      }
    }
    void renderFirstPage();
    return () => {
      disposed = true;
      renderTask?.cancel();
      void loadingTask?.destroy();
    };
  }, [sourceKind, pdfData]);

  const scalingLabel = scaling === "fill"
    ? "Fill paper · cropped edges"
    : scaling === "fit"
      ? "Fit · entire image"
      : scaling === "actual_size"
        ? "Actual size · clipping possible"
        : "Automatic · preserve source";

  return (
    <section className="printer-output-preview" aria-labelledby="printer-output-preview-title">
      <header>
        <div>
          <span className="numeric">LIVE OUTPUT PROOF</span>
          <strong id="printer-output-preview-title">{file?.originalFilename ?? "Select a print-ready file"}</strong>
        </div>
        <output>{paperLabel}</output>
      </header>

      <div className="printer-output-preview__stage" style={previewStyle}>
        <div className={`printer-output-preview__paper is-${scaling}${borderless ? " is-borderless" : ""}`}>
          {sourceKind === "image" && sourceUrl ? (
            <img src={sourceUrl} alt={`Output preview of ${file?.originalFilename ?? "the selected file"}`} />
          ) : null}
          {sourceKind === "pdf" && pdfData ? (
            <canvas ref={canvasRef} aria-label={`First-page output preview of ${file?.originalFilename ?? "the selected PDF"}`} />
          ) : null}
          {sourceKind === "unsupported" ? (
            <div className="printer-output-preview__message">
              <span aria-hidden="true">FILE</span>
              <strong>Visual proof unavailable</strong>
              <p>This format can still be submitted, but it cannot be shown inside the paper outline.</p>
            </div>
          ) : null}
          {!file && !loading ? (
            <div className="printer-output-preview__message">
              <span aria-hidden="true">01</span>
              <strong>No file selected</strong>
              <p>Choose the retained print-ready file to build the output proof.</p>
            </div>
          ) : null}
          {loading ? <div className="printer-output-preview__loading" role="status"><span />Preparing output proof…</div> : null}
          {error ? (
            <div className="printer-output-preview__message is-error" role="alert">
              <span aria-hidden="true">!</span>
              <strong>Preview unavailable</strong>
              <p>{error}</p>
              <Button type="button" size="sm" variant="secondary" onClick={() => setLoadVersion((current) => current + 1)}>Retry proof</Button>
            </div>
          ) : null}
          {!borderless && sourceKind && sourceKind !== "unsupported" && !loading && !error ? <span className="printer-output-preview__margin-guide" aria-hidden="true" /> : null}
        </div>
      </div>

      <footer>
        <span><b>{widthMm.toLocaleString(undefined, { maximumFractionDigits: 1 })} × {heightMm.toLocaleString(undefined, { maximumFractionDigits: 1 })} mm</b>{resolvedOrientation}</span>
        <span><b>{scalingLabel}</b>{borderless ? "Borderless requested" : "Driver margin guide shown"}</span>
        {file && (file.detectedPageCount ?? 1) > 1 ? <span><b>Page 1 of {file.detectedPageCount}</b>First page shown in proof</span> : null}
      </footer>
    </section>
  );
}

function resolveOrientation(orientation: PrintOrientation, detected?: DocumentOrientation | null): "portrait" | "landscape" {
  if (orientation !== "auto") return orientation;
  return detected === "landscape" ? "landscape" : "portrait";
}

function fileKind(mimeType: string, filename: string): "image" | "pdf" | "unsupported" {
  const normalized = filename.toLowerCase();
  if (mimeType === "application/pdf" || normalized.endsWith(".pdf")) return "pdf";
  if (mimeType.startsWith("image/") && !mimeType.includes("tiff") && !/\.tiff?$/.test(normalized)) return "image";
  return "unsupported";
}
