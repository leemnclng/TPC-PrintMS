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
        <div className="template-library__intro">
          <span className="numeric">01 / AVAILABLE</span>
          <h2 id="template-library-title">Start with the cut.</h2>
          <p>Business Card is the first production template. Its front and back share one measured grid, so alignment stays inspectable before either side reaches the printer.</p>
        </div>
        <Link className="template-card" to="/templates/business-card">
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
        </Link>
      </section>
    </>
  );
}
