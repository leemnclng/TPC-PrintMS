import { FormEvent, useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { Link } from "react-router-dom";
import { Button } from "../../components/Button/Button";
import { DuplexModeControl } from "../../components/DuplexModeControl/DuplexModeControl";
import { Modal } from "../../components/Modal/Modal";
import { PdfViewer } from "../../components/PdfViewer/PdfViewer";
import { ApiError, api } from "../../lib/apiClient";
import "./TrifoldBrochureTemplatePage.css";

type Side = "outside" | "inside";
type Placement = { x: number; y: number; scale: number };

export function TrifoldBrochureTemplatePage() {
  const [sheet, setSheet] = useState("a4-landscape");
  const [outside, setOutside] = useState<File | null>(null);
  const [inside, setInside] = useState<File | null>(null);
  const [outsideUrl, setOutsideUrl] = useState<string | null>(null);
  const [insideUrl, setInsideUrl] = useState<string | null>(null);
  const [outsideAspect, setOutsideAspect] = useState(297 / 210);
  const [insideAspect, setInsideAspect] = useState(297 / 210);
  const [outsidePlacement, setOutsidePlacement] = useState<Placement>({ x: .5, y: .5, scale: 100 });
  const [insidePlacement, setInsidePlacement] = useState<Placement>({ x: .5, y: .5, scale: 100 });
  const [activeSide, setActiveSide] = useState<Side>("outside");
  const [margin, setMargin] = useState(5);
  const [safeMargin, setSafeMargin] = useState(5);
  const [offsetX, setOffsetX] = useState(0);
  const [offsetY, setOffsetY] = useState(0);
  const [foldMarks, setFoldMarks] = useState(true);
  const [manualDuplex, setManualDuplex] = useState(true);
  const [submitted, setSubmitted] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pdfPreview, setPdfPreview] = useState<{ file: File; url: string } | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const dragRef = useRef<{ pointerId:number; startX:number; startY:number; width:number; height:number; placement:Placement; side:Side } | null>(null);

  const [sheetWidth, sheetHeight] = sheet === "letter-landscape" ? [279.4, 215.9] : [297, 210];
  const placement = activeSide === "outside" ? outsidePlacement : insidePlacement;
  const activeUrl = activeSide === "outside" ? outsideUrl : insideUrl;
  const activeFile = activeSide === "outside" ? outside : inside;
  const activeAspect = activeSide === "outside" ? outsideAspect : insideAspect;
  const usableWidth = sheetWidth - margin * 2;
  const usableHeight = sheetHeight - margin * 2;
  const workspaceError = !Number.isFinite(margin) || !Number.isFinite(safeMargin) || margin < 0 || safeMargin < 0 || usableWidth <= 0 || usableHeight <= 0 || safeMargin * 2 >= Math.min(usableWidth, usableHeight)
    ? "Page and safe margins must leave usable space on the brochure."
    : null;

  useEffect(() => { if (!outside) { setOutsideUrl(null); return; } const url=URL.createObjectURL(outside); setOutsideUrl(url); return()=>URL.revokeObjectURL(url); }, [outside]);
  useEffect(() => { if (!inside) { setInsideUrl(null); return; } const url=URL.createObjectURL(inside); setInsideUrl(url); return()=>URL.revokeObjectURL(url); }, [inside]);
  useEffect(() => { const url=pdfPreview?.url; return()=>{if(url)URL.revokeObjectURL(url);}; }, [pdfPreview?.url]);

  function updatePlacement(side: Side, patch: Partial<Placement>) {
    const setter = side === "outside" ? setOutsidePlacement : setInsidePlacement;
    setter((current)=>({...current,...patch}));
    setPdfPreview(null);
  }

  function startDrag(event: ReactPointerEvent<HTMLButtonElement>, side: Side) {
    const safeArea=event.currentTarget.parentElement; if(!safeArea)return;
    event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); setActiveSide(side);
    dragRef.current={pointerId:event.pointerId,startX:event.clientX,startY:event.clientY,width:safeArea.clientWidth,height:safeArea.clientHeight,placement:side==="outside"?outsidePlacement:insidePlacement,side};
  }

  function moveArtwork(event: ReactPointerEvent<HTMLButtonElement>) {
    const drag=dragRef.current; if(!drag||drag.pointerId!==event.pointerId)return;
    const aspect=drag.side==="outside"?outsideAspect:insideAspect;
    const metrics=artworkMetrics(drag.placement,aspect,usableWidth,usableHeight);
    const availableX=drag.width*((100-metrics.width)/100); const availableY=drag.height*((100-metrics.height)/100);
    updatePlacement(drag.side,{x:availableX>0?clamp(drag.placement.x+(event.clientX-drag.startX)/availableX,0,1):.5,y:availableY>0?clamp(drag.placement.y+(event.clientY-drag.startY)/availableY,0,1):.5});
  }

  async function generate(event: FormEvent) {
    event.preventDefault(); setSubmitted(true); setError(null);
    if(!outside||!inside||workspaceError)return;
    setGenerating(true);
    const body=new FormData(); body.append("outside",outside); body.append("inside",inside);
    body.append("sheet_width_mm",String(sheetWidth)); body.append("sheet_height_mm",String(sheetHeight)); body.append("margin_mm",String(margin)); body.append("safe_margin_mm",String(safeMargin)); body.append("inside_offset_x_mm",String(offsetX)); body.append("inside_offset_y_mm",String(offsetY)); body.append("fold_marks",String(foldMarks)); body.append("manual_duplex",String(manualDuplex));
    body.append("outside_position_x",String(outsidePlacement.x)); body.append("outside_position_y",String(outsidePlacement.y)); body.append("outside_scale_percent",String(outsidePlacement.scale)); body.append("inside_position_x",String(insidePlacement.x)); body.append("inside_position_y",String(insidePlacement.y)); body.append("inside_scale_percent",String(insidePlacement.scale));
    try { const blob=await api.uploadDownload("/templates/trifold-brochure/pdf",body); const url=URL.createObjectURL(blob); setPdfPreview({file:new File([blob],"trifold-brochure-print-ready.pdf",{type:"application/pdf"}),url}); setPreviewOpen(true); }
    catch(caught){setError(caught instanceof ApiError?caught.message:"The brochure PDF could not be generated.");}
    finally{setGenerating(false);}
  }

  function downloadPreview(){if(!pdfPreview)return;const anchor=document.createElement("a");anchor.href=pdfPreview.url;anchor.download=pdfPreview.file.name;anchor.click();}
  const metrics=artworkMetrics(placement,activeAspect,usableWidth,usableHeight);
  const previewStyle={"--sheet-ratio":`${sheetWidth} / ${sheetHeight}`,"--page-margin-x":`${margin/sheetWidth*100}%`,"--page-margin-y":`${margin/sheetHeight*100}%`,"--safe-margin-x":`${safeMargin/(sheetWidth-margin*2)*100}%`,"--safe-margin-y":`${safeMargin/(sheetHeight-margin*2)*100}%`,"--art-left":`${metrics.left}%`,"--art-top":`${metrics.top}%`,"--art-width":`${metrics.width}%`,"--art-height":`${metrics.height}%`} as CSSProperties;

  return <form className="brochure-studio" onSubmit={generate} noValidate>
    <header className="brochure-studio__header"><div><Link to="/templates">← Templates</Link><span className="numeric">TRIFOLD / BROCHURE 02</span><h1>Trifold Brochure</h1><p>Compose complete outside and inside spreads with measured thirds, then choose manual or automatic back-to-back orientation.</p></div><Button type="submit" variant="primary" loading={generating} disabled={Boolean(workspaceError)}>Preview print-ready PDF</Button></header>
    <div className="brochure-workspace">
      <aside className="brochure-controls">
        <section><h2><span>01</span> Artwork spreads</h2><ArtworkField label="Outside spread" file={outside} onChange={(file)=>{setOutside(file);setOutsidePlacement({x:.5,y:.5,scale:100});}} invalid={submitted&&!outside}/><ArtworkField label="Inside spread" file={inside} onChange={(file)=>{setInside(file);setInsidePlacement({x:.5,y:.5,scale:100});}} invalid={submitted&&!inside}/></section>
        <section><h2><span>02</span> Paper and guides</h2><label className="form-field"><span>Sheet</span><select value={sheet} onChange={(event)=>setSheet(event.target.value)}><option value="a4-landscape">A4 · landscape</option><option value="letter-landscape">Letter · landscape</option></select></label><div className="brochure-fields"><NumberField label="Page margin" value={margin} min={0} max={30} onChange={setMargin}/><NumberField label="Safe margin" value={safeMargin} min={0} max={30} onChange={setSafeMargin}/></div><label className="brochure-check"><input type="checkbox" checked={foldMarks} onChange={(event)=>setFoldMarks(event.target.checked)}/><span><strong>Print fold marks</strong><small>Short guides at the top and bottom thirds</small></span></label></section>
        <section><h2><span>03</span> Position artwork</h2><p>Editing the {activeSide} spread. Drag the artwork inside the dotted safe area.</p><label className="form-field"><span>Image size <output>{Math.round(placement.scale)}%</output></span><input type="range" min="10" max="100" value={placement.scale} onChange={(event)=>updatePlacement(activeSide,{scale:Number(event.target.value)})}/></label><div className="brochure-align"><button type="button" onClick={()=>updatePlacement(activeSide,{x:0})}>Left</button><button type="button" onClick={()=>updatePlacement(activeSide,{x:.5})}>Center</button><button type="button" onClick={()=>updatePlacement(activeSide,{x:1})}>Right</button><button type="button" onClick={()=>updatePlacement(activeSide,{y:0})}>Top</button><button type="button" onClick={()=>updatePlacement(activeSide,{y:.5})}>Middle</button><button type="button" onClick={()=>updatePlacement(activeSide,{y:1})}>Bottom</button></div></section>
        <section><h2><span>04</span> Back-to-back</h2><DuplexModeControl manual={manualDuplex} onChange={setManualDuplex}/><p>Use calibration only after a test sheet shows a consistent inside-page shift.</p><div className="brochure-fields"><NumberField label="Inside X" value={offsetX} min={-10} max={10} step={.1} onChange={setOffsetX}/><NumberField label="Inside Y" value={offsetY} min={-10} max={10} step={.1} onChange={setOffsetY}/></div></section>
      </aside>
      <main className="brochure-proof"><header><div><span className="numeric">LIVE FOLD PROOF</span><h2>{sheetWidth} × {sheetHeight} mm · {manualDuplex?"manual upright sides":"inside auto-rotated 180°"}</h2></div><div className="brochure-side-tabs"><button type="button" className={activeSide==="outside"?"is-active":""} onClick={()=>setActiveSide("outside")}>Outside</button><button type="button" className={activeSide==="inside"?"is-active":""} onClick={()=>setActiveSide("inside")}>Inside</button></div></header>
        <div className="brochure-stage" style={previewStyle}><div className="brochure-sheet"><div className="brochure-printable"><div className="brochure-safe">{activeUrl?<button type="button" className={`brochure-artwork${activeSide==="inside"&&!manualDuplex?" is-auto-rotated":""}`} onPointerDown={(event)=>startDrag(event,activeSide)} onPointerMove={moveArtwork} onPointerUp={()=>{dragRef.current=null;}} onPointerCancel={()=>{dragRef.current=null;}}><img src={activeUrl} alt="" onLoad={(event)=>activeSide==="outside"?setOutsideAspect(event.currentTarget.naturalWidth/event.currentTarget.naturalHeight):setInsideAspect(event.currentTarget.naturalWidth/event.currentTarget.naturalHeight)} draggable={false}/></button>:<div className="brochure-placeholder"><span>{activeSide.toUpperCase()}</span><strong>Full three-panel spread</strong><small>{activeFile?.name??"Artwork required"}</small></div>}</div><div className="brochure-safe-guide"/><div className="brochure-fold brochure-fold--one"/><div className="brochure-fold brochure-fold--two"/><div className="brochure-panel-labels">{(activeSide==="outside"?["FOLD-IN FLAP","BACK COVER","FRONT COVER"]:["INSIDE LEFT","INSIDE CENTER","INSIDE RIGHT"]).map((label)=><span key={label}>{label}</span>)}</div></div></div></div>
        <footer><span><b>{sheetWidth} × {sheetHeight} mm</b>Open sheet</span><span><b>{(sheetWidth/3).toFixed(1)} mm</b>Nominal panel</span><span><b>{margin} / {safeMargin} mm</b>Page / safe margin</span><span><b>{manualDuplex?"MANUAL":"AUTO 180°"}</b>Reverse mode</span></footer>
        {submitted&&(!outside||!inside)?<p className="brochure-error">Choose both outside and inside artwork before generating the PDF.</p>:null}{workspaceError?<p className="brochure-error">{workspaceError}</p>:null}{error?<p className="brochure-error">{error} Your layout is still available; correct the issue and retry.</p>:null}
      </main>
    </div>
    <Modal open={previewOpen&&Boolean(pdfPreview)} title="Trifold brochure PDF preview" description={manualDuplex?"Review the upright Outside and Inside pages before printing them separately.":"Review the Outside page and the automatically rotated Inside page."} onClose={()=>setPreviewOpen(false)} className="brochure-pdf-modal">{pdfPreview?<div className="brochure-pdf-preview"><PdfViewer file={pdfPreview.file} filename={pdfPreview.file.name} downloadUrl={null}/><footer><Button type="button" variant="ghost" onClick={()=>setPreviewOpen(false)}>Return to layout</Button><Button type="button" variant="primary" onClick={downloadPreview}>Download PDF</Button></footer></div>:null}</Modal>
  </form>;
}

function ArtworkField({label,file,onChange,invalid}:{label:string;file:File|null;onChange:(file:File|null)=>void;invalid:boolean}){return <label className={`brochure-upload${file?" has-file":""}${invalid?" is-error":""}`}><input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event)=>onChange(event.target.files?.[0]??null)}/><span><strong>{label}</strong><small>{file?.name??"PNG, JPG, or WebP · 25 MB max"}</small></span><b>{file?"Replace":"Add image"}</b></label>;}
function NumberField({label,value,min,max,step=1,onChange}:{label:string;value:number;min:number;max:number;step?:number;onChange:(value:number)=>void}){return <label className="form-field"><span>{label} <small>(mm)</small></span><input type="number" value={Number.isFinite(value)?value:""} min={min} max={max} step={step} onChange={(event)=>onChange(event.target.valueAsNumber)}/></label>;}
function artworkMetrics(placement:Placement,aspect:number,safeWidth:number,safeHeight:number){const safeRatio=Math.max(1,safeWidth)/Math.max(1,safeHeight);const width=Math.min(placement.scale,(Math.max(.01,aspect)/safeRatio)*100);const height=Math.min(100,width*safeRatio/Math.max(.01,aspect));return{width,height,left:(100-width)*placement.x,top:(100-height)*placement.y};}
function clamp(value:number,minimum:number,maximum:number){return Math.min(maximum,Math.max(minimum,value));}
