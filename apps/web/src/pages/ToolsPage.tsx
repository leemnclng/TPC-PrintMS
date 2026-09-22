import { Link } from "react-router-dom";
import { PageHeader } from "../components/PageHeader/PageHeader";
import "./ToolsPage.css";

export function ToolsPage() {
  return <>
    <PageHeader eyebrow="PRODUCTION UTILITIES" title="Tools" description="Prepare customer files before they enter a job, without changing the original source." />
    <section className="tools-library" aria-labelledby="tools-library-title">
      <div className="tools-library__intro"><span className="numeric">01 / FILE PREPARATION</span><h2 id="tools-library-title">A cleaner source makes a cleaner print.</h2><p>Utilities live here independently from job orders, so the owner can repair, inspect, and export a file before deciding how it will be produced.</p></div>
      <Link className="tool-card" to="/tools/enhancer">
        <div className="tool-card__visual" aria-hidden="true"><div className="tool-card__before"><i /><i /><i /></div><span>→</span><div className="tool-card__after"><i /><i /><i /></div></div>
        <div className="tool-card__copy"><span className="numeric">PDF + IMAGE</span><h2>File Enhancer</h2><p>Clean scan backgrounds, reduce noise, recover contrast, sharpen details, upscale, and export a new print-ready copy.</p><b>Open enhancement studio <span aria-hidden="true">→</span></b></div>
      </Link>
      <article className="tool-card tool-card--future" aria-label="Future tools"><span className="numeric">NEXT / OPEN SLOT</span><h3>More production tools can live here.</h3><p>Converters, crop utilities, watermarking, compression, and batch preparation can be added without crowding Templates or Print Center.</p></article>
    </section>
  </>;
}
