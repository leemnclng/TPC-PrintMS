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
        <header className="template-library__intro"><span className="numeric">LAYOUT CONTAINERS</span><div><h2 id="template-library-title">Start with the finished format.</h2><p>Every template opens a dedicated layout workspace with its own measurements, proofing, and export rules.</p></div><b>01 available</b></header>
        <div className="template-library__grid"><Link className="template-card template-card--wide" to="/templates/business-card">
          <div className="template-card__specimen" aria-hidden="true">
            <span className="template-card__crop template-card__crop--a" />
            <span className="template-card__crop template-card__crop--b" />
            <div><small>THE PAPER CLUB</small><strong>90 × 54</strong><span>FRONT / BACK</span></div>
          </div>
          <div className="template-card__body">
            <span className="numeric">SHEET IMPOSITION</span>
            <h2>Business Card</h2>
            <p>Arrange paired artwork on one shared grid, add bleed and crop marks, then export two same-orientation pages for separate printing.</p>
            <span className="template-card__action">Open layout studio <b aria-hidden="true">→</b></span>
          </div>
        </Link><article className="template-card template-card--placeholder"><span className="numeric">COMING LATER</span><h3>Flyers and invitations</h3><p>New calibrated formats will appear as separate containers without changing the Business Card workflow.</p></article><article className="template-card template-card--placeholder"><span className="numeric">COMING LATER</span><h3>Labels and stickers</h3><p>Sheet layouts with repeat grids, gutters, bleed, and cut guidance can live here next.</p></article></div>
      </section>
    </>
  );
}
