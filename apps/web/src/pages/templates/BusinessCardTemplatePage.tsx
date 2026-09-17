import { FormEvent, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { Link } from "react-router-dom";
import { Button } from "../../components/Button/Button";
import { Modal } from "../../components/Modal/Modal";
import { PdfViewer } from "../../components/PdfViewer/PdfViewer";
import { ApiError, api } from "../../lib/apiClient";
import "./BusinessCardTemplatePage.css";

type Side = "front" | "back";
type Layout = { columns: number; rows: number; count: number; error: string | null };
type Placement = { x: number; y: number; scale: number };

const defaults = {
  cardWidth: 90,
  cardHeight: 54,
  margin: 5,
  gap: 4,
  bleed: 3,
  safeMargin: 4,
  offsetX: 0,
  offsetY: 0,
};

export function BusinessCardTemplatePage() {
  const [sheet, setSheet] = useState("a4-portrait");
  const [cardWidth, setCardWidth] = useState(defaults.cardWidth);
  const [cardHeight, setCardHeight] = useState(defaults.cardHeight);
  const [margin, setMargin] = useState(defaults.margin);
  const [gap, setGap] = useState(defaults.gap);
  const [bleed, setBleed] = useState(defaults.bleed);
  const [safeMargin, setSafeMargin] = useState(defaults.safeMargin);
  const [offsetX, setOffsetX] = useState(defaults.offsetX);
  const [offsetY, setOffsetY] = useState(defaults.offsetY);
  const [cropMarks, setCropMarks] = useState(true);
  const [front, setFront] = useState<File | null>(null);
  const [back, setBack] = useState<File | null>(null);
  const [frontUrl, setFrontUrl] = useState<string | null>(null);
  const [backUrl, setBackUrl] = useState<string | null>(null);
  const [frontAspect, setFrontAspect] = useState(90 / 54);
  const [backAspect, setBackAspect] = useState(90 / 54);
  const [frontPlacement, setFrontPlacement] = useState<Placement>({ x: 0.5, y: 0.5, scale: 70 });
  const [backPlacement, setBackPlacement] = useState<Placement>({ x: 0.5, y: 0.5, scale: 70 });
  const [activeSide, setActiveSide] = useState<Side>("front");
  const [submitted, setSubmitted] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [canvasZoom, setCanvasZoom] = useState(1);
  const [pdfPreview, setPdfPreview] = useState<{ file: File; url: string } | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const dragRef = useRef<{ pointerId: number; startX: number; startY: number; placement: Placement; side: Side; width: number; height: number } | null>(null);

  const [sheetWidth, sheetHeight] = sheet === "a4-landscape" ? [297, 210] : sheet === "letter-portrait" ? [215.9, 279.4] : sheet === "letter-landscape" ? [279.4, 215.9] : [210, 297];
  const layout = useMemo(() => calculateLayout(sheetWidth, sheetHeight, cardWidth, cardHeight, margin, gap, bleed), [sheetWidth, sheetHeight, cardWidth, cardHeight, margin, gap, bleed]);
  const safeMarginError = !Number.isFinite(safeMargin) || safeMargin < 0 || safeMargin * 2 >= Math.min(cardWidth, cardHeight)
    ? "The safe margin must leave usable space inside the finished card."
    : null;
  const workspaceError = layout.error ?? safeMarginError;
  const placement = activeSide === "front" ? frontPlacement : backPlacement;
  const aspect = activeSide === "front" ? frontAspect : backAspect;
  const placementMetrics = artworkMetrics(placement, aspect, cardWidth, cardHeight, safeMargin);

  useEffect(() => {
    if (!front || front.type === "application/pdf") { setFrontUrl(null); return; }
    const url = URL.createObjectURL(front);
    setFrontUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [front]);
  useEffect(() => {
    if (!back || back.type === "application/pdf") { setBackUrl(null); return; }
    const url = URL.createObjectURL(back);
    setBackUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [back]);
  useEffect(() => {
    const url = pdfPreview?.url;
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [pdfPreview?.url]);

  async function generate(event: FormEvent) {
    event.preventDefault();
    setSubmitted(true);
    setError(null);
    if (!front || !back || workspaceError) return;
    setGenerating(true);
    const body = new FormData();
    body.append("front", front);
    body.append("back", back);
    body.append("sheet_width_mm", String(sheetWidth));
    body.append("sheet_height_mm", String(sheetHeight));
    body.append("card_width_mm", String(cardWidth));
    body.append("card_height_mm", String(cardHeight));
    body.append("margin_mm", String(margin));
    body.append("gap_mm", String(gap));
    body.append("bleed_mm", String(bleed));
    body.append("safe_margin_mm", String(safeMargin));
    body.append("back_offset_x_mm", String(offsetX));
    body.append("back_offset_y_mm", String(offsetY));
    body.append("crop_marks", String(cropMarks));
    body.append("front_position_x", String(frontPlacement.x));
    body.append("front_position_y", String(frontPlacement.y));
    body.append("front_scale_percent", String(frontPlacement.scale));
    body.append("back_position_x", String(backPlacement.x));
    body.append("back_position_y", String(backPlacement.y));
    body.append("back_scale_percent", String(backPlacement.scale));
    try {
      const blob = await api.uploadDownload("/templates/business-card/pdf", body);
      const url = URL.createObjectURL(blob);
      setPdfPreview({ file: new File([blob], "business-card-print-ready.pdf", { type: "application/pdf" }), url });
      setPreviewOpen(true);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "The print-ready PDF could not be generated.");
    } finally {
      setGenerating(false);
    }
  }

  const previewImage = activeSide === "front" ? frontUrl : backUrl;
  const previewFile = activeSide === "front" ? front : back;
  const previewStyle = {
    "--sheet-ratio": `${sheetWidth} / ${sheetHeight}`,
    "--grid-columns": layout.columns,
    "--grid-rows": layout.rows,
    "--grid-width": `${Math.max(0, ((layout.columns * (cardWidth + bleed * 2) + Math.max(0, layout.columns - 1) * gap) / sheetWidth) * 100)}%`,
    "--grid-height": `${Math.max(0, ((layout.rows * (cardHeight + bleed * 2) + Math.max(0, layout.rows - 1) * gap) / sheetHeight) * 100)}%`,
    "--grid-gap-x": `${(gap / sheetWidth) * 100}%`,
    "--grid-gap-y": `${(gap / sheetHeight) * 100}%`,
    "--back-offset-x": `${(offsetX / sheetWidth) * 100}%`,
    "--back-offset-y": `${(offsetY / sheetHeight) * 100}%`,
    "--trim-inset-x": `${(bleed / (cardWidth + bleed * 2)) * 100}%`,
    "--trim-inset-y": `${(bleed / (cardHeight + bleed * 2)) * 100}%`,
    "--safe-inset-x": `${((bleed + safeMargin) / (cardWidth + bleed * 2)) * 100}%`,
    "--safe-inset-y": `${((bleed + safeMargin) / (cardHeight + bleed * 2)) * 100}%`,
    "--artwork-left": `${placementMetrics.left}%`,
    "--artwork-top": `${placementMetrics.top}%`,
    "--artwork-width": `${placementMetrics.width}%`,
    "--artwork-height": `${placementMetrics.height}%`,
    "--canvas-height": `${35 * canvasZoom}rem`,
  } as CSSProperties;

  function downloadPreview() {
    if (!pdfPreview) return;
    const anchor = document.createElement("a");
    anchor.href = pdfPreview.url;
    anchor.download = pdfPreview.file.name;
    anchor.click();
  }

  function updatePlacement(side: Side, change: Partial<Placement>) {
    const setter = side === "front" ? setFrontPlacement : setBackPlacement;
    setter((current) => ({ ...current, ...change }));
  }

  function startDrag(event: ReactPointerEvent<HTMLButtonElement>, side: Side) {
    const safeArea = event.currentTarget.parentElement;
    if (!safeArea) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setActiveSide(side);
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      placement: side === "front" ? frontPlacement : backPlacement,
      side,
      width: safeArea.clientWidth,
      height: safeArea.clientHeight,
    };
  }

  function moveArtwork(event: ReactPointerEvent<HTMLButtonElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const currentAspect = drag.side === "front" ? frontAspect : backAspect;
    const metrics = artworkMetrics(drag.placement, currentAspect, cardWidth, cardHeight, safeMargin);
    const availableX = drag.width * ((100 - metrics.width) / 100);
    const availableY = drag.height * ((100 - metrics.height) / 100);
    updatePlacement(drag.side, {
      x: availableX > 0 ? clamp(drag.placement.x + (event.clientX - drag.startX) / availableX, 0, 1) : 0.5,
      y: availableY > 0 ? clamp(drag.placement.y + (event.clientY - drag.startY) / availableY, 0, 1) : 0.5,
    });
  }

  function nudgeArtwork(side: Side, key: string) {
    const current = side === "front" ? frontPlacement : backPlacement;
    const step = 0.025;
    if (key === "ArrowLeft") updatePlacement(side, { x: clamp(current.x - step, 0, 1) });
    if (key === "ArrowRight") updatePlacement(side, { x: clamp(current.x + step, 0, 1) });
    if (key === "ArrowUp") updatePlacement(side, { y: clamp(current.y - step, 0, 1) });
    if (key === "ArrowDown") updatePlacement(side, { y: clamp(current.y + step, 0, 1) });
  }

  return (
    <form className="business-card-studio" onSubmit={generate} noValidate>
      <header className="business-card-studio__header">
        <div><Link to="/templates">← Templates</Link><span className="numeric">BUSINESS CARD / IMPOSITION 01</span><h1>Business Card</h1><p>Front and back share one measured grid and page orientation, ready to print as two separate sheets.</p></div>
        <Button type="submit" variant="primary" loading={generating} disabled={Boolean(workspaceError)}>Preview print-ready PDF</Button>
      </header>

      <div className="business-card-studio__workspace">
        <aside className="business-card-controls" aria-label="Business card layout settings">
          <section><h2><span>01</span> Artwork</h2><ArtworkField label="Front image" file={front} onChange={(file) => { setFront(file); setFrontPlacement({ x: .5, y: .5, scale: 70 }); }} invalid={submitted && !front} /><ArtworkField label="Back image" file={back} onChange={(file) => { setBack(file); setBackPlacement({ x: .5, y: .5, scale: 70 }); }} invalid={submitted && !back} /></section>
          <section><h2><span>02</span> Finished size</h2><div className="business-card-fields business-card-fields--two"><NumberField label="Width" value={cardWidth} min={40} max={220} onChange={setCardWidth} /><NumberField label="Height" value={cardHeight} min={25} max={220} onChange={setCardHeight} /></div><button className="business-card-preset" type="button" onClick={() => { setCardWidth(90); setCardHeight(54); }}>Use 90 × 54 mm standard</button></section>
          <section><h2><span>03</span> Sheet & spacing</h2><label className="form-field"><span>Sheet</span><select value={sheet} onChange={(event) => setSheet(event.target.value)}><option value="a4-portrait">A4 · portrait</option><option value="a4-landscape">A4 · landscape</option><option value="letter-portrait">Letter · portrait</option><option value="letter-landscape">Letter · landscape</option></select></label><div className="business-card-fields business-card-fields--two"><NumberField label="Sheet margin" value={margin} min={0} max={50} onChange={setMargin} /><NumberField label="Card gap" value={gap} min={0} max={30} onChange={setGap} /><NumberField label="Bleed" value={bleed} min={0} max={10} onChange={setBleed} /><NumberField label="Safe margin" value={safeMargin} min={0} max={20} step={0.5} onChange={setSafeMargin} /></div></section>
          <section className="business-card-position"><h2><span>04</span> Position image</h2><p className="business-card-controls__hint">Editing the {activeSide}. Drag the outlined image on the first card, use arrow keys for fine movement, or align it precisely. Both exported pages keep this same upright orientation.</p><label className="form-field"><span>Image size <output>{Math.round(placement.scale)}%</output></span><input type="range" min="10" max="100" value={placement.scale} onChange={(event) => updatePlacement(activeSide, { scale: Number(event.target.value) })} /></label><div className="business-card-align" aria-label="Align image"><button type="button" onClick={() => updatePlacement(activeSide, { x: 0 })}>Left</button><button type="button" onClick={() => updatePlacement(activeSide, { x: .5 })}>Center</button><button type="button" onClick={() => updatePlacement(activeSide, { x: 1 })}>Right</button><button type="button" onClick={() => updatePlacement(activeSide, { y: 0 })}>Top</button><button type="button" onClick={() => updatePlacement(activeSide, { y: .5 })}>Middle</button><button type="button" onClick={() => updatePlacement(activeSide, { y: 1 })}>Bottom</button></div></section>
          <section><h2><span>05</span> Back alignment</h2><p className="business-card-controls__hint">Both pages use the same grid. Apply a small correction only if a separately printed test sheet shows a consistent back-side shift.</p><div className="business-card-fields business-card-fields--two"><NumberField label="Horizontal" value={offsetX} min={-10} max={10} step={0.1} onChange={setOffsetX} /><NumberField label="Vertical" value={offsetY} min={-10} max={10} step={0.1} onChange={setOffsetY} /></div><label className="business-card-check"><input type="checkbox" checked={cropMarks} onChange={(event) => setCropMarks(event.target.checked)} /><span><strong>Crop marks</strong><small>Print trim guides on both pages</small></span></label></section>
        </aside>

        <main className="business-card-proof">
          <header><div><span className="numeric">LIVE SHEET PROOF</span><h2>{workspaceError ?? `${layout.columns} × ${layout.rows} grid · ${layout.count} cards per sheet`}</h2></div><div className="business-card-proof-tools"><div className="business-card-zoom" role="group" aria-label="Canvas zoom"><button type="button" onClick={() => setCanvasZoom((value) => clamp(value - .25, .5, 2.5))} disabled={canvasZoom <= .5} aria-label="Zoom canvas out">−</button><output>{Math.round(canvasZoom * 100)}%</output><button type="button" onClick={() => setCanvasZoom((value) => clamp(value + .25, .5, 2.5))} disabled={canvasZoom >= 2.5} aria-label="Zoom canvas in">+</button><button type="button" onClick={() => setCanvasZoom(1)}>Fit</button></div><div className="business-card-side-tabs" role="group" aria-label="Preview side"><button type="button" className={activeSide === "front" ? "is-active" : ""} onClick={() => setActiveSide("front")}>Front</button><button type="button" className={activeSide === "back" ? "is-active" : ""} onClick={() => setActiveSide("back")}>Back</button></div></div></header>
          <div className="business-card-proof__stage" style={previewStyle}>
            <div className={`business-card-sheet is-${activeSide}${cropMarks ? " has-marks" : ""}`}>
              {layout.count > 0 && <div className="business-card-grid">{Array.from({ length: layout.count }, (_, index) => <div className="business-card-cell" key={index}><span className="business-card-trim" /><div className="business-card-safe">{previewImage ? index === 0 ? <button className="business-card-artwork is-editable" type="button" aria-label={`Move ${activeSide} image. Use drag or arrow keys.`} onPointerDown={(event) => startDrag(event, activeSide)} onPointerMove={moveArtwork} onPointerUp={() => { dragRef.current = null; }} onPointerCancel={() => { dragRef.current = null; }} onKeyDown={(event) => { if (event.key.startsWith("Arrow")) { event.preventDefault(); nudgeArtwork(activeSide, event.key); } }}><img src={previewImage} alt="" onLoad={(event) => (activeSide === "front" ? setFrontAspect : setBackAspect)(event.currentTarget.naturalWidth / event.currentTarget.naturalHeight)} draggable={false} /></button> : <span className="business-card-artwork" aria-hidden="true"><img src={previewImage} alt="" draggable={false} /></span> : <div className="business-card-placeholder"><span>{activeSide.toUpperCase()}</span><strong>{index + 1}</strong><small>{previewFile?.name ?? "Image required"}</small></div>}</div></div>)}</div>}
            </div>
          </div>
          <footer><span><b>{sheetWidth} × {sheetHeight} mm</b>Sheet</span><span><b>{cardWidth} × {cardHeight} mm</b>Finished card</span><span><b>{safeMargin} mm</b>Safe margin</span><span><b>{offsetX >= 0 ? "+" : ""}{offsetX} / {offsetY >= 0 ? "+" : ""}{offsetY} mm</b>Back X / Y</span></footer>
          {(submitted && (!front || !back)) && <p className="business-card-error" role="alert">Choose both front and back artwork before generating the PDF.</p>}
          {workspaceError && <p className="business-card-error" role="alert">{workspaceError}</p>}
          {error && <p className="business-card-error" role="alert">{error} Your layout and artwork are still here; correct the issue and retry.</p>}
        </main>
      </div>
      <Modal open={previewOpen && Boolean(pdfPreview)} title="Print-ready PDF preview" description="Review both same-orientation pages before downloading the final file." onClose={() => setPreviewOpen(false)} className="business-card-pdf-modal">
        {pdfPreview ? <div className="business-card-pdf-preview"><PdfViewer file={pdfPreview.file} filename={pdfPreview.file.name} downloadUrl={null} /><footer><Button type="button" variant="ghost" onClick={() => setPreviewOpen(false)}>Return to layout</Button><Button type="button" variant="primary" onClick={downloadPreview}>Download PDF</Button></footer></div> : null}
      </Modal>
    </form>
  );
}

function ArtworkField({ label, file, onChange, invalid }: { label: string; file: File | null; onChange: (file: File | null) => void; invalid: boolean }) {
  return <label className={`business-card-upload${file ? " has-file" : ""}${invalid ? " is-error" : ""}`}><input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => onChange(event.target.files?.[0] ?? null)} /><span><strong>{label}</strong><small>{file?.name ?? "PNG, JPG, or WebP · 25 MB max"}</small></span><b>{file ? "Replace" : "Add image"}</b></label>;
}

function NumberField({ label, value, min, max, step = 1, onChange }: { label: string; value: number; min: number; max: number; step?: number; onChange: (value: number) => void }) {
  return <label className="form-field"><span>{label} <small>(mm)</small></span><input type="number" value={Number.isFinite(value) ? value : ""} min={min} max={max} step={step} onChange={(event) => onChange(event.target.valueAsNumber)} /></label>;
}

export function calculateLayout(sheetWidth: number, sheetHeight: number, cardWidth: number, cardHeight: number, margin: number, gap: number, bleed: number): Layout {
  const values = [sheetWidth, sheetHeight, cardWidth, cardHeight, margin, gap, bleed];
  if (values.some((value) => !Number.isFinite(value))) return { columns: 0, rows: 0, count: 0, error: "Enter valid numeric dimensions." };
  if (cardWidth < 40 || cardWidth > 220 || cardHeight < 25 || cardHeight > 220) return { columns: 0, rows: 0, count: 0, error: "Use a card size between 40 × 25 mm and 220 × 220 mm." };
  if (margin < 0 || gap < 0 || bleed < 0 || bleed > 10) return { columns: 0, rows: 0, count: 0, error: "Margins, gaps, and bleed must use valid non-negative dimensions." };
  const slotWidth = cardWidth + bleed * 2;
  const slotHeight = cardHeight + bleed * 2;
  const columns = Math.max(0, Math.floor((sheetWidth - margin * 2 + gap) / (slotWidth + gap)));
  const rows = Math.max(0, Math.floor((sheetHeight - margin * 2 + gap) / (slotHeight + gap)));
  if (!columns || !rows) return { columns, rows, count: 0, error: "The card does not fit on this sheet. Reduce its size, margin, or bleed." };
  return { columns, rows, count: columns * rows, error: null };
}

function artworkMetrics(placement: Placement, aspect: number, cardWidth: number, cardHeight: number, safeMargin: number) {
  const safeWidth = Math.max(1, cardWidth - safeMargin * 2);
  const safeHeight = Math.max(1, cardHeight - safeMargin * 2);
  const safeRatio = safeWidth / safeHeight;
  const width = Math.min(placement.scale, (Math.max(.01, aspect) / safeRatio) * 100);
  const height = Math.min(100, width * safeRatio / Math.max(.01, aspect));
  return { width, height, left: (100 - width) * placement.x, top: (100 - height) * placement.y };
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}
