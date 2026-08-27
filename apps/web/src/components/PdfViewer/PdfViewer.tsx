import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import {
  getDocument,
  GlobalWorkerOptions,
  type PDFDocumentLoadingTask,
  type PDFDocumentProxy,
  type RenderTask,
} from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import "./PdfViewer.css";

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

const MIN_SCALE = 0.35;
const MAX_SCALE = 3;
const SCALE_STEP = 0.2;

interface Props {
  file: File;
  filename: string;
  downloadUrl: string | null;
}

export function PdfViewer({ file, filename, downloadUrl }: Props) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null);
  const [manualScale, setManualScale] = useState(1);
  const [fitScale, setFitScale] = useState(1);
  const [fitToWidth, setFitToWidth] = useState(true);
  const [rotation, setRotation] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loadVersion, setLoadVersion] = useState(0);
  const scale = fitToWidth ? fitScale : manualScale;
  const pageCount = document?.numPages ?? 0;

  useEffect(() => {
    let disposed = false;
    let loadingTask: PDFDocumentLoadingTask | null = null;

    async function loadPdf() {
      setLoading(true);
      setError(null);
      setDocument(null);
      try {
        const data = new Uint8Array(await file.arrayBuffer());
        loadingTask = getDocument({ data });
        const nextDocument = await loadingTask.promise;
        if (disposed) return;
        setDocument(nextDocument);
      } catch {
        if (!disposed) setError("The PDF preview could not be loaded. Try again or download the original file.");
      } finally {
        if (!disposed) setLoading(false);
      }
    }

    void loadPdf();
    return () => {
      disposed = true;
      void loadingTask?.destroy();
    };
  }, [file, loadVersion]);

  const updateFitScale = useCallback(async () => {
    if (!document || !viewportRef.current) return;
    const page = await document.getPage(1);
    const baseViewport = page.getViewport({ scale: 1, rotation });
    const availableWidth = Math.max(viewportRef.current.clientWidth - 48, 160);
    setFitScale(clamp(availableWidth / baseViewport.width, MIN_SCALE, MAX_SCALE));
  }, [document, rotation]);

  useEffect(() => {
    if (!document || !viewportRef.current) return;
    void updateFitScale();
    const observer = new ResizeObserver(() => void updateFitScale());
    observer.observe(viewportRef.current);
    return () => observer.disconnect();
  }, [document, updateFitScale]);

  function changeScale(delta: number) {
    setFitToWidth(false);
    setManualScale(clamp(scale + delta, MIN_SCALE, MAX_SCALE));
  }

  function handleViewportKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "+" || event.key === "=") {
      event.preventDefault();
      changeScale(SCALE_STEP);
    } else if (event.key === "-") {
      event.preventDefault();
      changeScale(-SCALE_STEP);
    } else if (event.key === "0") {
      event.preventDefault();
      setFitToWidth(true);
    }
  }

  return (
    <div className="pdf-viewer">
      <div className="pdf-viewer__toolbar" aria-label="PDF preview controls">
        <div className="pdf-viewer__page-count numeric">
          {pageCount ? `${pageCount} ${pageCount === 1 ? "page" : "pages"}` : "Loading pages"}
        </div>

        <div className="pdf-viewer__group pdf-viewer__group--view">
          <button type="button" onClick={() => changeScale(-SCALE_STEP)} disabled={!document || scale <= MIN_SCALE} aria-label="Zoom out" title="Zoom out">−</button>
          <output aria-label="PDF zoom level">{Math.round(scale * 100)}%</output>
          <button type="button" onClick={() => changeScale(SCALE_STEP)} disabled={!document || scale >= MAX_SCALE} aria-label="Zoom in" title="Zoom in">+</button>
          <button
            type="button"
            className={fitToWidth ? "pdf-viewer__fit--active" : ""}
            onClick={() => setFitToWidth(true)}
            disabled={!document}
            aria-pressed={fitToWidth}
            title="Fit page width"
          >Fit</button>
          <button type="button" onClick={() => setRotation((current) => (current + 90) % 360)} disabled={!document} aria-label="Rotate clockwise" title="Rotate clockwise">↻</button>
          {downloadUrl ? <a href={downloadUrl} download={filename} aria-label="Download original PDF" title="Download original PDF">↓</a> : null}
        </div>
      </div>

      <div
        ref={viewportRef}
        className="pdf-viewer__viewport"
        tabIndex={0}
        onKeyDown={handleViewportKeyDown}
        aria-label={`Continuous preview of ${filename}. Scroll to read all pages and use plus or minus to zoom.`}
      >
        {document ? (
          <div className="pdf-viewer__pages">
            {Array.from({ length: pageCount }, (_, index) => (
              <PdfPage
                key={index + 1}
                document={document}
                pageNumber={index + 1}
                scale={scale}
                rotation={rotation}
                scrollRoot={viewportRef}
              />
            ))}
          </div>
        ) : null}
        {loading && !error ? (
          <div className="pdf-viewer__status" role="status">
            <span aria-hidden="true" />
            Loading PDF
          </div>
        ) : null}
        {error ? (
          <div className="pdf-viewer__error" role="alert">
            <strong>Preview unavailable</strong>
            <p>{error}</p>
            <div>
              <button type="button" onClick={() => setLoadVersion((current) => current + 1)}>Retry preview</button>
              {downloadUrl ? <a href={downloadUrl} download={filename}>Download original</a> : null}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function PdfPage({
  document,
  pageNumber,
  scale,
  rotation,
  scrollRoot,
}: {
  document: PDFDocumentProxy;
  pageNumber: number;
  scale: number;
  rotation: number;
  scrollRoot: RefObject<HTMLDivElement>;
}) {
  const shellRef = useRef<HTMLElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [visible, setVisible] = useState(pageNumber <= 2);
  const [rendering, setRendering] = useState(false);
  const [error, setError] = useState(false);
  const [renderVersion, setRenderVersion] = useState(0);

  useEffect(() => {
    if (!shellRef.current) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setVisible(true);
      },
      { root: scrollRoot.current, rootMargin: "1000px 0px" },
    );
    observer.observe(shellRef.current);
    return () => observer.disconnect();
  }, [scrollRoot]);

  useEffect(() => {
    if (!visible || !canvasRef.current) return;
    let renderTask: RenderTask | null = null;
    let disposed = false;

    async function renderPage() {
      setRendering(true);
      setError(false);
      try {
        const page = await document.getPage(pageNumber);
        if (disposed || !canvasRef.current) return;
        const viewport = page.getViewport({ scale, rotation });
        const outputScale = Math.min(window.devicePixelRatio || 1, 2);
        const canvas = canvasRef.current;
        const context = canvas.getContext("2d", { alpha: false });
        if (!context) throw new Error("Canvas is unavailable.");
        canvas.width = Math.floor(viewport.width * outputScale);
        canvas.height = Math.floor(viewport.height * outputScale);
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;
        renderTask = page.render({
          canvasContext: context,
          viewport,
          transform: outputScale === 1 ? undefined : [outputScale, 0, 0, outputScale, 0, 0],
        });
        await renderTask.promise;
      } catch (caught) {
        if (!disposed && !(caught instanceof Error && caught.name === "RenderingCancelledException")) {
          setError(true);
        }
      } finally {
        if (!disposed) setRendering(false);
      }
    }

    void renderPage();
    return () => {
      disposed = true;
      renderTask?.cancel();
    };
  }, [document, pageNumber, renderVersion, rotation, scale, visible]);

  return (
    <section ref={shellRef} className="pdf-viewer__page-sheet" aria-label={`Page ${pageNumber}`}>
      <span className="pdf-viewer__page-label numeric">Page {pageNumber}</span>
      <div className="pdf-viewer__canvas-shell">
        <canvas ref={canvasRef} aria-label={`Rendered page ${pageNumber}`} />
        {!visible || rendering ? <span className="pdf-viewer__page-status">{visible ? "Rendering" : "Preparing"}</span> : null}
        {error ? (
          <div className="pdf-viewer__page-error" role="alert">
            <span>Page {pageNumber} could not be rendered.</span>
            <button type="button" onClick={() => setRenderVersion((current) => current + 1)}>Retry page</button>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), maximum);
}
