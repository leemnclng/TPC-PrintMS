import { Link } from "react-router-dom";
import { PageHeader } from "../components/PageHeader/PageHeader";
import "./TemplatesPage.css";

export function TemplatesPage() {
  return (
    <>
      <PageHeader
        eyebrow="PRODUCTION TEMPLATES"
        title="Templates"
        description="Reusable, calibrated layouts that turn finished artwork into press-ready sheets."
      />
      <section className="template-library" aria-labelledby="template-library-title">
        <header className="template-library__intro"><span className="numeric">LAYOUT CONTAINERS</span><div><h2 id="template-library-title">Start with the finished format.</h2><p>Every template opens a dedicated layout workspace with its own measurements, proofing, and export rules.</p></div><b>02 available</b></header>
        <div className="template-library__grid"><Link className="template-card template-card--wide" to="/templates/business-card">
          <div className="template-card__specimen" aria-hidden="true">
            <span className="template-card__crop template-card__crop--a" />
            <span className="template-card__crop template-card__crop--b" />
            <div><small>THE PAPER CLUB</small><strong>90 × 54</strong><span>FRONT / BACK</span></div>
          </div>
          <div className="template-card__body">
            <span className="numeric">SHEET IMPOSITION</span>
            <h2>Business Card</h2>
            <p>Arrange paired artwork on one shared grid, then choose manual upright pages or an automatically rotated reverse page.</p>
            <span className="template-card__action">Open layout studio <b aria-hidden="true">→</b></span>
          </div>
        </Link><Link className="template-card template-card--brochure" to="/templates/trifold-brochure"><div className="template-card__brochure" aria-hidden="true"><span>OUTSIDE</span><i/><i/><b>3 PANELS</b></div><div className="template-card__body"><span className="numeric">FOLDING LAYOUT</span><h2>Trifold Brochure</h2><p>Prepare outside and inside spreads with panel guides, calibration, and manual or automatic back-to-back orientation.</p><span className="template-card__action">Open brochure studio <b aria-hidden="true">→</b></span></div></Link><article className="template-card template-card--placeholder"><span className="numeric">COMING LATER</span><h3>Labels and stickers</h3><p>Sheet layouts with repeat grids, gutters, bleed, and cut guidance can live here next.</p></article></div>
      </section>
    </>
  );
}
