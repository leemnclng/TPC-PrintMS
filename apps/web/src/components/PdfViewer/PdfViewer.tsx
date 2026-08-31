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
const MAX_OUTPUT_SCALE = 1.5;
const MAX_RENDERED_PAGE_PIXELS = 3_000_000;
const NEARBY_PAGE_MARGIN_PX = 600;

interface PageDimensions {
  width: number;
  height: number;
}

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
  const [referencePageDimensions, setReferencePageDimensions] = useState<PageDimensions | null>(null);
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
    setReferencePageDimensions({ width: baseViewport.width, height: baseViewport.height });
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
                estimatedDimensions={referencePageDimensions}
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
  estimatedDimensions,
}: {
  document: PDFDocumentProxy;
  pageNumber: number;
  scale: number;
  rotation: number;
  scrollRoot: RefObject<HTMLDivElement>;
  estimatedDimensions: PageDimensions | null;
}) {
  const shellRef = useRef<HTMLElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [nearViewport, setNearViewport] = useState(false);
  const [rendering, setRendering] = useState(false);
  const [rendered, setRendered] = useState(false);
  const [error, setError] = useState(false);
  const [renderVersion, setRenderVersion] = useState(0);
  const [measuredPage, setMeasuredPage] = useState<(PageDimensions & { rotation: number }) | null>(null);

  const activeDimensions = measuredPage?.rotation === rotation ? measuredPage : estimatedDimensions;
  const displayedWidth = activeDimensions ? Math.max(activeDimensions.width * scale, 160) : undefined;
  const displayedHeight = activeDimensions ? Math.max(activeDimensions.height * scale, 200) : undefined;
  const canvasStyle = displayedWidth && displayedHeight
    ? { width: `${Math.floor(displayedWidth)}px`, height: `${Math.floor(displayedHeight)}px` }
    : undefined;
  const shellStyle = displayedWidth && displayedHeight
    ? { width: `${Math.floor(displayedWidth)}px`, minWidth: 0, minHeight: `${Math.floor(displayedHeight)}px` }
    : undefined;

  useEffect(() => {
    if (!shellRef.current) return;
    const observer = new IntersectionObserver(
      (entries) => {
        setNearViewport(entries.some((entry) => entry.isIntersecting));
      },
      { root: scrollRoot.current, rootMargin: `${NEARBY_PAGE_MARGIN_PX}px 0px` },
    );
    observer.observe(shellRef.current);
    return () => observer.disconnect();
  }, [scrollRoot]);

  useEffect(() => {
    if (!canvasRef.current) return;
    if (!nearViewport) {
      // Width/height attributes own the canvas pixel buffer. Shrinking them
      // releases raster memory while the CSS-sized shell preserves scroll
      // position and page geometry.
      canvasRef.current.width = 1;
      canvasRef.current.height = 1;
      setRendering(false);
      setRendered(false);
      setError(false);
      return;
    }
    let renderTask: RenderTask | null = null;
    let disposed = false;

    async function renderPage() {
      setRendering(true);
      setError(false);
      try {
        const page = await document.getPage(pageNumber);
        if (disposed || !canvasRef.current) return;
        const viewport = page.getViewport({ scale, rotation });
        setMeasuredPage({
          rotation,
          width: viewport.width / scale,
          height: viewport.height / scale,
        });
        const cssPixelCount = Math.max(viewport.width * viewport.height, 1);
        const resolutionBudgetScale = Math.sqrt(MAX_RENDERED_PAGE_PIXELS / cssPixelCount);
        const outputScale = Math.min(window.devicePixelRatio || 1, MAX_OUTPUT_SCALE, resolutionBudgetScale);
        const canvas = canvasRef.current;
        const context = canvas.getContext("2d", { alpha: false });
        if (!context) throw new Error("Canvas is unavailable.");
        canvas.width = Math.max(1, Math.floor(viewport.width * outputScale));
        canvas.height = Math.max(1, Math.floor(viewport.height * outputScale));
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;
        renderTask = page.render({
          canvasContext: context,
          viewport,
          transform: outputScale === 1 ? undefined : [outputScale, 0, 0, outputScale, 0, 0],
        });
        await renderTask.promise;
        if (!disposed) setRendered(true);
      } catch (caught) {
        if (!disposed && !(caught instanceof Error && caught.name === "RenderingCancelledException")) {
          setRendered(false);
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
  }, [document, nearViewport, pageNumber, renderVersion, rotation, scale]);

  return (
    <section ref={shellRef} className="pdf-viewer__page-sheet" aria-label={`Page ${pageNumber}`}>
      <span className="pdf-viewer__page-label numeric">Page {pageNumber}</span>
      <div className="pdf-viewer__canvas-shell" style={shellStyle}>
        <canvas ref={canvasRef} style={canvasStyle} aria-label={`Rendered page ${pageNumber}`} />
        {(!nearViewport || rendering || !rendered) && !error ? (
          <span className="pdf-viewer__page-status" role="status">
            {nearViewport ? "Rendering page" : "Scroll nearby to render"}
          </span>
        ) : null}
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
