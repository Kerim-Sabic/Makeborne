import Link from "next/link";
import Image from "next/image";
import BrandMark from "@/components/brand-mark";
import {
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Layers3,
  PanelTop,
  Presentation,
} from "lucide-react";
export default function Home() {
  return (
    <main className="landing">
      <header className="marketing-nav">
        <Link className="wordmark" href="/">
          <BrandMark />
          Makeborne<span className="beta">EARLY ACCESS</span>
        </Link>
        <nav>
          <a href="#possibilities">The studio</a>
          <a href="#workflow">How it works</a>
          <Link className="button primary small" href="/studio">
            Open studio <ArrowUpRight size={15} />
          </Link>
        </nav>
      </header>
      <section className="hero">
        <div className="hero-copy">
          <div className="eyebrow">
            <span className="tiny-line" /> YOUR IDEAS. BEAUTIFULLY MADE.
          </div>
          <h1>
            Make something
            <br />
            <em>worth selling.</em>
          </h1>
          <p>
            A thoughtful home for your websites, books, and presentations. From
            the first idea to the final client approval.
          </p>
          <div className="hero-actions">
            <Link className="button primary" href="/studio">
              Start your first project <ArrowRight size={18} />
            </Link>
            <a className="text-link" href="#possibilities">
              Explore the possibilities ↓
            </a>
          </div>
          <div className="hero-note">
            <span className="status-dot" /> Explore the local studio. No account
            required.
          </div>
        </div>
        <div className="hero-art">
          <div className="art-caption">
            <span>ONE IDEA. MANY POSSIBILITIES.</span>
            <span>01 — 03</span>
          </div>
          <Image
            className="hero-generated"
            src="/artwork/makeborne-paper-studio.png"
            width={1536}
            height={1024}
            sizes="(max-width: 900px) 100vw, 55vw"
            fetchPriority="high"
            loading="eager"
            alt="Sculptural folded paper composition, original Makeborne artwork"
          />
          <div className="sample-book">
            <span className="book-kicker">A FIELD GUIDE TO</span>
            <h2>
              Good things
              <br />
              <em>take shape.</em>
            </h2>
            <span className="book-bottom">MAKEBORNE / DESIGN SAMPLE</span>
          </div>
          <div className="sample-slide">
            <span>STUDIO NOTES / 01</span>
            <h3>
              A sharper
              <br />
              point of view.
            </h3>
            <div className="slide-line" />
            <p>
              Ideas with substance.
              <br />
              Design with intention.
            </p>
          </div>
          <div className="art-label">
            Original generated artwork · authored design previews
          </div>
        </div>
      </section>
      <section className="format-strip">
        <span>
          One workspace.
          <br />
          <strong>Every kind of possibility.</strong>
        </span>
        <div>
          <PanelTop /> Websites
        </div>
        <div>
          <BookOpen /> Books
        </div>
        <div>
          <Presentation /> Presentations
        </div>
        <div>
          <Layers3 /> Client projects
        </div>
      </section>
      <section id="possibilities" className="marketing-section">
        <div className="section-heading">
          <div>
            <div className="eyebrow">THE CREATION STUDIO</div>
            <h2>
              Good work deserves
              <br />
              <em>a better workspace.</em>
            </h2>
          </div>
          <p>
            Create with a clear direction. Keep the details, revisions, and
            people connected to the work.
          </p>
        </div>
        <div className="feature-grid">
          {[
            [
              PanelTop,
              "Websites with character.",
              "Shape a responsive website in a focused editor. Keep content and client feedback together.",
              "website",
            ],
            [
              BookOpen,
              "Knowledge, given form.",
              "Organise chapters, refine your writing, and build a book with an intentional visual direction.",
              "book",
            ],
            [
              Presentation,
              "Ideas that land.",
              "Bring your own text or start with a brief. Shape a clear narrative before generating your slides.",
              "presentation",
            ],
          ].map(([Icon, title, description, kind]) => {
            const I = Icon as typeof PanelTop;
            return (
              <article key={String(kind)}>
                <div className="feature-icon">
                  <I />
                </div>
                <h3>{String(title)}</h3>
                <p>{String(description)}</p>
                <Link href={`/studio?create=${kind}`}>
                  Explore the editor <ArrowRight size={16} />
                </Link>
              </article>
            );
          })}
        </div>
      </section>
      <section id="workflow" className="workflow-section">
        <div>
          <div className="eyebrow">A CALMER WAY TO CREATE</div>
          <h2>
            From the first thought
            <br />
            to <em>“that’s the one.”</em>
          </h2>
          <p>
            Approve the direction first. Refine the details. Keep a record of
            every decision.
          </p>
          <Link className="button dark" href="/studio">
            Meet your workspace <ArrowRight size={18} />
          </Link>
        </div>
        <ol>
          {[
            [
              "01",
              "Give it a direction",
              "Add your material, audience, and intended outcome.",
            ],
            [
              "02",
              "Make it your own",
              "Choose a style or save a custom direction.",
            ],
            [
              "03",
              "Keep the work connected",
              "Organise clients, versions, feedback, and next steps.",
            ],
          ].map(([n, t, d]) => (
            <li key={n}>
              <span>{n}</span>
              <div>
                <h3>{t}</h3>
                <p>{d}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>
      <section className="closing">
        <span className="eyebrow">START WITH SOMETHING REAL</span>
        <h2>
          Your next idea
          <br />
          deserves <em>to exist.</em>
        </h2>
        <Link className="button primary" href="/studio">
          Open your studio <ArrowRight size={18} />
        </Link>
        <p>
          Local preview available now. Cloud services require configuration.
        </p>
      </section>
      <footer className="marketing-footer">
        <Link className="wordmark" href="/">
          <BrandMark />
          Makeborne
        </Link>
        <span>Make something worth selling.</span>
        <span>© 2026 Makeborne</span>
      </footer>
    </main>
  );
}
