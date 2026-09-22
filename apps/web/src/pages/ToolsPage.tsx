import { Link } from "react-router-dom";
import { PageHeader } from "../components/PageHeader/PageHeader";
import "./ToolsPage.css";

export function ToolsPage() {
  return <>
    <PageHeader eyebrow="PRODUCTION UTILITIES" title="Tools" description="Prepare customer files before they enter a job, without changing the original source." />
    <section className="tools-library" aria-labelledby="tools-library-title">
      <header className="tools-library__intro"><span className="numeric">UTILITY CONTAINERS</span><div><h2 id="tools-library-title">Choose a production workspace.</h2><p>Each tool stays in its own focused container, with room for more utilities as the operation grows.</p></div><b>03 tools</b></header>
      <div className="tools-library__grid"><Link className="tool-card tool-card--wide" to="/tools/enhancer">
        <div className="tool-card__visual" aria-hidden="true"><div className="tool-card__before"><i /><i /><i /></div><span>→</span><div className="tool-card__after"><i /><i /><i /></div></div>
        <div className="tool-card__copy"><span className="numeric">PDF + IMAGE</span><h2>File Enhancer</h2><p>Clean scan backgrounds, reduce noise, recover contrast, sharpen details, upscale, and export a new print-ready copy.</p><b>Open enhancement studio <span aria-hidden="true">→</span></b></div>
      </Link><Link className="tool-card tool-card--quotation" to="/tools/quotation"><div className="tool-card__quote-visual" aria-hidden="true"><span>QUOTATION</span><i /><i /><i /><strong>PHP 0,000.00</strong></div><div className="tool-card__copy"><span className="numeric">SALES DOCUMENT</span><h2>Quotation Builder</h2><p>Generate an itemized quotation without registering the prospect or saving a quotation record.</p><b>Create quotation <span aria-hidden="true">→</span></b></div></Link>
      <Link className="tool-card tool-card--image-layout" to="/tools/images-to-pdf"><div className="tool-card__layout-visual" aria-hidden="true"><span /><span /><span /><span /></div><div className="tool-card__copy"><span className="numeric">PAGE COMPOSER</span><h2>Images to PDF</h2><p>Place multiple pictures on one or several pages, move and resize their frames, then export one PDF.</p><b>Open composition desk <span aria-hidden="true">→</span></b></div></Link>
      <article className="tool-card tool-card--future" aria-label="Future tools"><span className="numeric">OPEN CONTAINER</span><h3>Reserved for the next utility.</h3><p>Converters, watermarking, compression, and batch preparation can join this library later.</p></article></div>
    </section>
  </>;
}
