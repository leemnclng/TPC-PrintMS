import { FormEvent, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "../../components/Button/Button";
import { PdfViewer } from "../../components/PdfViewer/PdfViewer";
import { ApiError, api } from "../../lib/apiClient";
import { formatFileSize } from "../../lib/format";
import "./FileEnhancerPage.css";

type Adjustments = { brightness: number; contrast: number; saturation: number; warmth: number; sharpen: number; denoise: number; backgroundCleanup: number; autoCorrect: boolean; grayscale: boolean; outputDpi: 150 | 300; upscale: 1 | 2 };
const ORIGINAL: Adjustments = { brightness: 0, contrast: 0, saturation: 0, warmth: 0, sharpen: 0, denoise: 0, backgroundCleanup: 0, autoCorrect: false, grayscale: false, outputDpi: 300, upscale: 1 };
const PRESETS: Record<string, Adjustments> = {
  original: ORIGINAL,
  scan: { ...ORIGINAL, contrast: 12, sharpen: 38, denoise: 35, backgroundCleanup: 58, autoCorrect: true },
  photo: { ...ORIGINAL, contrast: 8, saturation: 8, sharpen: 28, denoise: 12, autoCorrect: true },
  soft: { ...ORIGINAL, contrast: 10, sharpen: 55, denoise: 20, upscale: 2 },
};

export function FileEnhancerPage() {
  const [source, setSource] = useState<File | null>(null);
  const [settings, setSettings] = useState<Adjustments>(PRESETS.scan);
  const [preset, setPreset] = useState("scan");
  const [result, setResult] = useState<File | null>(null);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sourceUrl = useMemo(() => source ? URL.createObjectURL(source) : null, [source]);
  const resultUrl = useMemo(() => result ? URL.createObjectURL(result) : null, [result]);
  useEffect(() => () => { if (sourceUrl) URL.revokeObjectURL(sourceUrl); }, [sourceUrl]);
  useEffect(() => () => { if (resultUrl) URL.revokeObjectURL(resultUrl); }, [resultUrl]);
  const isPdf = source?.type === "application/pdf" || source?.name.toLowerCase().endsWith(".pdf");

  function change<K extends keyof Adjustments>(key: K, value: Adjustments[K]) {
    setSettings((current) => ({ ...current, [key]: value }));
    setPreset("custom"); setResult(null); setError(null);
  }
  function choosePreset(value: string) {
    setPreset(value); setResult(null); setError(null);
    if (value !== "custom") setSettings(PRESETS[value]);
  }
  function chooseFile(file: File | null) {
    setSource(file); setResult(null); setError(null);
  }
  async function enhance(event: FormEvent) {
    event.preventDefault();
    if (!source) return;
    setProcessing(true); setError(null);
    const body = new FormData();
    body.append("file", source);
    Object.entries(settings).forEach(([key, value]) => body.append(key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`), String(value)));
    try {
      const blob = await api.uploadDownload("/tools/enhance", body);
      const name = `${source.name.replace(/\.[^.]+$/, "")}-enhanced.${isPdf ? "pdf" : "png"}`;
      setResult(new File([blob], name, { type: blob.type || (isPdf ? "application/pdf" : "image/png") }));
    } catch (caught) { setError(caught instanceof ApiError ? caught.message : "The file could not be enhanced."); }
    finally { setProcessing(false); }
  }

  return <div className="enhancer-page">
    <header className="enhancer-hero"><div><Link to="/tools">← Tools</Link><span className="numeric">FILE LAB / 01</span><h1>PDF &amp; Image Enhancer</h1><p>Restore a weak scan or soft image, compare the result, then export a new copy. Your original file is never modified.</p></div><div className="enhancer-hero__seal"><span>LOCAL</span><strong>01</strong><small>PRIVATE PROCESS</small></div></header>
    <form className="enhancer-workbench" onSubmit={enhance}>
      <aside className="enhancer-controls">
        <section><header><span className="numeric">01</span><div><h2>Source</h2><p>PDF or image · up to 25 MB</p></div></header><label className={`enhancer-drop${source ? " has-file" : ""}`}><input type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,.bmp,.tif,.tiff" onChange={(event) => chooseFile(event.target.files?.[0] ?? null)} /><span>{source ? "Replace file" : "Choose a file"}</span>{source ? <strong>{source.name}<small>{formatFileSize(source.size)}</small></strong> : <small>Drag from Explorer or browse</small>}</label></section>
        <section><header><span className="numeric">02</span><div><h2>Recipe</h2><p>Start with a purpose-built preset</p></div></header><label className="enhancer-select"><span>Preset</span><select value={preset} onChange={(event) => choosePreset(event.target.value)}><option value="scan">Clean document scan</option><option value="photo">Photo clarity</option><option value="soft">Upscale soft artwork</option><option value="original">No correction</option><option value="custom">Custom settings</option></select></label></section>
        <section className="enhancer-controls__adjust"><header><span className="numeric">03</span><div><h2>Adjust</h2><p>Fine control over the export</p></div></header>
          <Toggle label="Auto correction" note="Recover tonal range" checked={settings.autoCorrect} onChange={(value) => change("autoCorrect", value)} />
          <Range label="Background cleanup" value={settings.backgroundCleanup} min={0} max={100} onChange={(value) => change("backgroundCleanup", value)} />
          <Range label="Denoise" value={settings.denoise} min={0} max={100} onChange={(value) => change("denoise", value)} />
          <Range label="Sharpen" value={settings.sharpen} min={0} max={100} onChange={(value) => change("sharpen", value)} />
          <Range label="Brightness" value={settings.brightness} min={-50} max={50} onChange={(value) => change("brightness", value)} />
          <Range label="Contrast" value={settings.contrast} min={-50} max={50} onChange={(value) => change("contrast", value)} />
          <Range label="Saturation" value={settings.saturation} min={-100} max={100} onChange={(value) => change("saturation", value)} />
          <Range label="Warmth" value={settings.warmth} min={-100} max={100} onChange={(value) => change("warmth", value)} />
          <Toggle label="Grayscale" note="Remove all color" checked={settings.grayscale} onChange={(value) => change("grayscale", value)} />
        </section>
        <section className="enhancer-output"><header><span className="numeric">04</span><div><h2>Output</h2><p>Resolution and enlargement</p></div></header><div><label><span>Resolution</span><select value={settings.outputDpi} onChange={(event) => change("outputDpi", Number(event.target.value) as 150 | 300)}><option value={150}>150 DPI · smaller</option><option value={300}>300 DPI · print</option></select></label><label><span>Upscale</span><select value={settings.upscale} onChange={(event) => change("upscale", Number(event.target.value) as 1 | 2)}><option value={1}>Original dimensions</option><option value={2}>2× dimensions</option></select></label></div><p>{isPdf ? "Enhanced PDFs keep the original page size but are flattened into high-resolution page images." : "Images export as PNG to avoid adding JPEG compression."}</p></section>
        {error ? <p className="enhancer-error" role="alert">{error}</p> : null}
        <div className="enhancer-actions"><Button type="submit" variant="primary" disabled={!source || processing} loading={processing}>{processing ? "Enhancing…" : result ? "Enhance again" : "Create enhanced copy"}</Button>{result && resultUrl ? <a className="enhancer-download" href={resultUrl} download={result.name}>Download {result.name}</a> : null}</div>
      </aside>
      <main className="enhancer-preview" aria-live="polite"><header><div><span className="numeric">BEFORE / AFTER</span><h2>Proof the change</h2></div>{result ? <span className="enhancer-ready">EXPORT READY</span> : <span>{source ? "Choose settings, then enhance" : "Waiting for source"}</span>}</header>
        {!source ? <div className="enhancer-empty"><span aria-hidden="true">↗</span><strong>Place a customer file on the bench.</strong><p>The original and enhanced export will appear side by side here.</p></div> : <div className={`enhancer-comparison${result ? " has-result" : ""}`}><PreviewPane label="Original" file={source} url={sourceUrl} />{result ? <PreviewPane label="Enhanced" file={result} url={resultUrl} /> : <div className="enhancer-pending"><span>AFTER</span><strong>Not processed yet</strong><p>The enhanced proof will replace this panel.</p></div>}</div>}
      </main>
    </form>
  </div>;
}

function PreviewPane({ label, file, url }: { label: string; file: File; url: string | null }) {
  const pdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
  return <section className="enhancer-pane"><header><span>{label}</span><small>{file.name}</small></header><div>{pdf && url ? <PdfViewer file={file} filename={file.name} downloadUrl={null} /> : url ? <img src={url} alt={`${label} preview of ${file.name}`} /> : null}</div></section>;
}
function Range({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (value: number) => void }) {
  return <label className="enhancer-range"><span>{label}<output className="numeric">{value > 0 ? "+" : ""}{value}</output></span><input type="range" min={min} max={max} value={value} onChange={(event) => onChange(Number(event.target.value))} /></label>;
}
function Toggle({ label, note, checked, onChange }: { label: string; note: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return <label className="enhancer-toggle"><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /><span><strong>{label}</strong><small>{note}</small></span></label>;
}
