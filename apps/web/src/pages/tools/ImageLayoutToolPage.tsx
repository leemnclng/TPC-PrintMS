import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { Link } from "react-router-dom";
import { Button } from "../../components/Button/Button";
import { Modal } from "../../components/Modal/Modal";
import { PdfViewer } from "../../components/PdfViewer/PdfViewer";
import { ApiError, api } from "../../lib/apiClient";
import "./ImageLayoutToolPage.css";

type LayoutMode = "single" | "one-per-page" | "two-up" | "four-up";
type FitMode = "contain" | "cover";
type Photo = { id: string; file: File; url: string; aspect: number };
type Placement = { id: string; photoId: string; page: number; x: number; y: number; width: number; height: number; fit: FitMode };
type DragState = { pointerId: number; action: "move" | "resize"; startX: number; startY: number; pageWidth: number; pageHeight: number; placement: Placement };

const PAGE_SIZES = {
  "a4-portrait": { label: "A4 portrait", width: 210, height: 297 },
  "a4-landscape": { label: "A4 landscape", width: 297, height: 210 },
  "letter-portrait": { label: "Letter portrait", width: 215.9, height: 279.4 },
  "letter-landscape": { label: "Letter landscape", width: 279.4, height: 215.9 },
} as const;

let photoSequence = 0;

export function ImageLayoutToolPage() {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [placements, setPlacements] = useState<Placement[]>([]);
  const [pageSizeKey, setPageSizeKey] = useState<keyof typeof PAGE_SIZES>("a4-portrait");
  const [layoutMode, setLayoutMode] = useState<LayoutMode>("single");
  const [pageCount, setPageCount] = useState(1);
  const [activePage, setActivePage] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ file: File; url: string } | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const photosRef = useRef<Photo[]>([]);
  const dragRef = useRef<DragState | null>(null);
  const pageSize = PAGE_SIZES[pageSizeKey];
  const selected = placements.find((placement) => placement.id === selectedId) ?? null;
  const activeItems = placements.filter((placement) => placement.page === activePage);

  useEffect(() => { photosRef.current = photos; }, [photos]);
  useEffect(() => () => {
    photosRef.current.forEach((photo) => URL.revokeObjectURL(photo.url));
  }, []);
  useEffect(() => {
    const url = preview?.url;
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [preview?.url]);

  async function addFiles(files: FileList | null) {
    if (!files?.length) return;
    setError(null);
    const accepted = Array.from(files).filter((file) => file.type.startsWith("image/")).slice(0, Math.max(0, 40 - photos.length));
    if (!accepted.length) { setError("Choose PNG, JPEG, WebP, BMP, or TIFF images."); return; }
    const added = await Promise.all(accepted.map(async (file) => {
      const url = URL.createObjectURL(file);
      return { id: `photo-${++photoSequence}`, file, url, aspect: await readAspect(url) };
    }));
    const next = [...photos, ...added];
    setPhotos(next);
    applyAutomaticLayout(next, layoutMode);
  }

  function applyAutomaticLayout(nextPhotos = photos, mode = layoutMode) {
    const result = createAutomaticLayout(nextPhotos, mode, pageSize.width / pageSize.height);
    setPlacements(result.placements);
    setPageCount(result.pageCount);
    setActivePage(0);
    setSelectedId(result.placements[0]?.id ?? null);
    setLayoutMode(mode);
    setPreview(null);
  }

  function updatePlacement(id: string, patch: Partial<Placement>) {
    setPlacements((current) => current.map((placement) => placement.id === id ? { ...placement, ...patch } : placement));
    setPreview(null);
  }

  function removePhoto(photoId: string) {
    const photo = photos.find((candidate) => candidate.id === photoId);
    if (photo) URL.revokeObjectURL(photo.url);
    const remaining = photos.filter((candidate) => candidate.id !== photoId);
    setPhotos(remaining);
    const remainingPlacements = placements.filter((placement) => placement.photoId !== photoId);
    setPlacements(remainingPlacements);
    setSelectedId((current) => remainingPlacements.some((placement) => placement.id === current) ? current : remainingPlacements[0]?.id ?? null);
    setPreview(null);
  }

  function addPage() {
    setPageCount((current) => current + 1);
    setActivePage(pageCount);
  }

  function startDrag(event: ReactPointerEvent<HTMLElement>, placement: Placement, action: "move" | "resize") {
    const page = event.currentTarget.closest(".image-layout-page");
    if (!(page instanceof HTMLElement)) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setSelectedId(placement.id);
    dragRef.current = { pointerId: event.pointerId, action, startX: event.clientX, startY: event.clientY, pageWidth: page.clientWidth, pageHeight: page.clientHeight, placement };
  }

  function moveDrag(event: ReactPointerEvent<HTMLElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dx = (event.clientX - drag.startX) / drag.pageWidth;
    const dy = (event.clientY - drag.startY) / drag.pageHeight;
    if (drag.action === "move") {
      updatePlacement(drag.placement.id, { x: clamp(drag.placement.x + dx, 0, 1 - drag.placement.width), y: clamp(drag.placement.y + dy, 0, 1 - drag.placement.height) });
    } else {
      updatePlacement(drag.placement.id, { width: clamp(drag.placement.width + dx, .08, 1 - drag.placement.x), height: clamp(drag.placement.height + dy, .08, 1 - drag.placement.y) });
    }
  }

  async function generatePdf() {
    if (!photos.length || !placements.length) { setError("Add at least one image to the page."); return; }
    setGenerating(true); setError(null);
    const imageIndex = new Map(photos.map((photo, index) => [photo.id, index]));
    const pages = Array.from({ length: pageCount }, (_, page) => ({ items: placements.filter((placement) => placement.page === page).map((placement) => ({
      image_index: imageIndex.get(placement.photoId), x: placement.x, y: placement.y, width: placement.width, height: placement.height, fit: placement.fit,
    })) }));
    const body = new FormData();
    photos.forEach((photo) => body.append("files", photo.file));
    body.append("layout_json", JSON.stringify({ page_width_mm: pageSize.width, page_height_mm: pageSize.height, pages }));
    try {
      const blob = await api.uploadDownload("/tools/image-layout/pdf", body);
      const url = URL.createObjectURL(blob);
      setPreview({ file: new File([blob], "image-layout.pdf", { type: "application/pdf" }), url });
      setPreviewOpen(true);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "The image PDF could not be generated.");
    } finally { setGenerating(false); }
  }

  function downloadPdf() {
    if (!preview) return;
    const anchor = document.createElement("a"); anchor.href = preview.url; anchor.download = preview.file.name; anchor.click();
  }

  const pageStyle = { "--page-ratio": `${pageSize.width} / ${pageSize.height}`, "--page-max-width": pageSize.width > pageSize.height ? "46rem" : "32rem" } as CSSProperties;

  return <div className="image-layout-tool">
    <header className="image-layout-hero"><div><Link to="/tools">← Tools</Link><span className="numeric">COMPOSITION DESK / 03</span><h1>Images to PDF</h1><p>Arrange several photos on one page or flow them across a complete PDF, then fine-tune every frame by hand.</p></div><Button type="button" variant="primary" disabled={!photos.length || generating} loading={generating} onClick={() => void generatePdf()}>Preview PDF</Button></header>
    <div className="image-layout-workbench">
      <aside className="image-layout-controls">
        <section><span className="numeric">01 / SOURCE</span><h2>Add pictures</h2><label className="image-layout-upload"><input type="file" multiple accept="image/png,image/jpeg,image/webp,image/bmp,image/tiff" onChange={(event) => void addFiles(event.target.files)} /><strong>Choose multiple images</strong><small>Up to 40 images · 25 MB each</small></label></section>
        <section><span className="numeric">02 / PAPER</span><h2>Page setup</h2><label><span>Paper and orientation</span><select value={pageSizeKey} onChange={(event) => { setPageSizeKey(event.target.value as keyof typeof PAGE_SIZES); setPreview(null); }}><option value="a4-portrait">A4 portrait</option><option value="a4-landscape">A4 landscape</option><option value="letter-portrait">Letter portrait</option><option value="letter-landscape">Letter landscape</option></select></label></section>
        <section><span className="numeric">03 / FLOW</span><h2>Automatic layout</h2><div className="image-layout-presets">{([['single','All on one page'],['one-per-page','One per page'],['two-up','2 per page'],['four-up','4 per page']] as [LayoutMode,string][]).map(([value,label]) => <button type="button" className={layoutMode===value?"is-active":""} key={value} onClick={() => applyAutomaticLayout(photos,value)} disabled={!photos.length}>{label}</button>)}</div><p>Applying a layout resets manual positioning.</p></section>
        <section className="image-layout-photo-list"><span className="numeric">04 / IMAGES</span><h2>{photos.length} selected</h2>{photos.map((photo) => { const placement = placements.find((item) => item.photoId===photo.id); return <article className={placement?.id===selectedId?"is-selected":""} key={photo.id} onClick={() => { if (placement) { setSelectedId(placement.id); setActivePage(placement.page); } }}><img src={photo.url} alt="" /><div><strong>{photo.file.name}</strong><span>Page {(placement?.page ?? 0)+1}</span></div><button type="button" aria-label={`Remove ${photo.file.name}`} onClick={(event) => { event.stopPropagation(); removePhoto(photo.id); }}>×</button></article>; })}</section>
      </aside>
      <main className="image-layout-stage">
        <header><div><span className="numeric">LIVE PAPER</span><h2>{PAGE_SIZES[pageSizeKey].label}</h2></div><div className="image-layout-page-actions"><button type="button" onClick={addPage}>+ Add page</button><span>{pageCount} {pageCount===1?"page":"pages"}</span></div></header>
        <nav className="image-layout-pages" aria-label="PDF pages">{Array.from({length:pageCount},(_,index)=><button type="button" className={activePage===index?"is-active":""} key={index} onClick={()=>setActivePage(index)}>Page {index+1}<small>{placements.filter((item)=>item.page===index).length} images</small></button>)}</nav>
        <div className="image-layout-canvas"><div className="image-layout-page" style={pageStyle}>{activeItems.length ? activeItems.map((placement) => { const photo=photos.find((candidate)=>candidate.id===placement.photoId); if(!photo)return null; const style={left:`${placement.x*100}%`,top:`${placement.y*100}%`,width:`${placement.width*100}%`,height:`${placement.height*100}%`} as CSSProperties; return <button type="button" className={`image-layout-frame${selectedId===placement.id?" is-selected":""}`} style={style} key={placement.id} onPointerDown={(event)=>startDrag(event,placement,"move")} onPointerMove={moveDrag} onPointerUp={()=>{dragRef.current=null;}} onPointerCancel={()=>{dragRef.current=null;}} onClick={()=>setSelectedId(placement.id)}><img src={photo.url} alt={photo.file.name} style={{objectFit:placement.fit}} draggable={false}/><span className="image-layout-resize" onPointerDown={(event)=>{event.stopPropagation();startDrag(event,placement,"resize");}} onPointerMove={moveDrag} onPointerUp={()=>{dragRef.current=null;}} aria-hidden="true" /></button>; }) : <div className="image-layout-empty"><strong>Empty page</strong><span>Add pictures or move one here.</span></div>}</div></div>
        {selected ? <section className="image-layout-inspector"><div><span className="numeric">SELECTED FRAME</span><strong>{photos.find((photo)=>photo.id===selected.photoId)?.file.name}</strong></div><label><span>Page</span><select value={selected.page} onChange={(event)=>{const page=Number(event.target.value);updatePlacement(selected.id,{page});setActivePage(page);}}>{Array.from({length:pageCount},(_,index)=><option value={index} key={index}>Page {index+1}</option>)}</select></label><div className="image-layout-fit"><span>Image fit</span><button type="button" className={selected.fit==="contain"?"is-active":""} onClick={()=>updatePlacement(selected.id,{fit:"contain"})}>Fit whole</button><button type="button" className={selected.fit==="cover"?"is-active":""} onClick={()=>updatePlacement(selected.id,{fit:"cover"})}>Fill frame</button></div><button type="button" onClick={()=>updatePlacement(selected.id,{x:.05,y:.05,width:.9,height:.9})}>Reset frame</button></section> : null}
        {error ? <p className="image-layout-error" role="alert">{error}</p> : null}
      </main>
    </div>
    <Modal className="image-layout-preview" open={previewOpen} title="Image layout PDF preview" description="Review every page before downloading the final PDF." onClose={()=>setPreviewOpen(false)}>{preview ? <div className="image-layout-preview__body"><PdfViewer file={preview.file} filename={preview.file.name} downloadUrl={null}/><footer><Button type="button" variant="secondary" onClick={()=>setPreviewOpen(false)}>Back to layout</Button><Button type="button" variant="primary" onClick={downloadPdf}>Download PDF</Button></footer></div> : null}</Modal>
  </div>;
}

function createAutomaticLayout(photos: Photo[], mode: LayoutMode, pageRatio: number) {
  if (!photos.length) return { placements: [] as Placement[], pageCount: 1 };
  if (mode === "one-per-page") return { pageCount: photos.length, placements: photos.map((photo,index)=>({id:`place-${photo.id}`,photoId:photo.id,page:index,x:.05,y:.05,width:.9,height:.9,fit:"contain" as FitMode})) };
  const perPage = mode === "two-up" ? 2 : mode === "four-up" ? 4 : photos.length;
  const pageCount = Math.max(1, Math.ceil(photos.length/perPage));
  const placements = photos.map((photo,index)=>{
    const page=Math.floor(index/perPage); const local=index%perPage; const count=mode==="single"?photos.length:perPage;
    const columns = count === 2 ? (pageRatio > 1 ? 2 : 1) : Math.ceil(Math.sqrt(count * pageRatio));
    const rows = Math.ceil(count/columns); const column=local%columns; const row=Math.floor(local/columns); const gap=.025; const margin=.04;
    const width=(1-margin*2-gap*(columns-1))/columns; const height=(1-margin*2-gap*(rows-1))/rows;
    return {id:`place-${photo.id}`,photoId:photo.id,page,x:margin+column*(width+gap),y:margin+row*(height+gap),width,height,fit:"contain" as FitMode};
  });
  return { placements, pageCount };
}

function readAspect(url: string): Promise<number> { return new Promise((resolve)=>{ const image=new Image(); image.onload=()=>resolve(image.naturalWidth/Math.max(1,image.naturalHeight)); image.onerror=()=>resolve(1); image.src=url; }); }
function clamp(value:number,minimum:number,maximum:number){return Math.min(maximum,Math.max(minimum,value));}
