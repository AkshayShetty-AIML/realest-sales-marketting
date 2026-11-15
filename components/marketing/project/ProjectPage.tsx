import type { CSSProperties, ReactNode } from "react";
import type { ProjectPageModel } from "@/lib/marketing/project-page";
import { UnitGrid, UnitSelection } from "./Units";

/**
 * THE PROJECT PAGE — premium, editorial, on-brand. Every fact on it comes from
 * the live shared inventory (lib/marketing/project-page.ts); the look comes from
 * the building's builder's brand kit (colours, fonts, logo), so each builder's
 * pages are theirs — not one fixed look. Honest by construction: each image
 * says what it is (render / placeholder / photo), indicative units are
 * labelled, the RERA status is shown as the listing states it, and AI-written
 * copy carries its label.
 */

const inr = (n: number) => (n >= 1e7 ? `₹${(n / 1e7).toFixed(2).replace(/\.?0+$/, "")} Cr` : `₹${Math.round(n / 1e5)} L`);
const range = (a: number | null, b: number | null, f: (n: number) => string) => (a === null ? null : a === b ? f(a) : `${f(a)} – ${f(b as number)}`);
const sqft = (n: number) => `${n.toLocaleString("en-IN")} sq ft`;
const fontFamily = (name: string) => `"${name.replace(/[^A-Za-z0-9 ]/g, "")}"`;
const googleFonts = (fonts: string[]) => `https://fonts.googleapis.com/css2?${Array.from(new Set(fonts.map((f) => f.replace(/[^A-Za-z0-9 ]/g, "").trim()).filter(Boolean))).map((f) => `family=${encodeURIComponent(f).replace(/%20/g, "+")}:wght@400;500;600;700`).join("&")}&display=swap`;

export function ProjectPage({ model: m, enquiry, preview = false }: { model: ProjectPageModel; enquiry: ReactNode; preview?: boolean }) {
  const s = m.summary;
  const price = range(s.priceMin, s.priceMax, inr) ?? (m.property.listedPrice ? inr(m.property.listedPrice) : null);
  const carpet = range(s.carpetMin, s.carpetMax, sqft);
  const hero = m.media[0] ?? null;
  const theme = {
    "--pp-primary": m.brand.primary,
    "--pp-secondary": m.brand.secondary,
    "--pp-heading": `${fontFamily(m.brand.headingFont)}, Georgia, serif`,
    "--pp-body": `${fontFamily(m.brand.bodyFont)}, system-ui, sans-serif`,
  } as CSSProperties;
  const facts: [string, string][] = [
    ["Configuration", s.configs.join(" · ") || m.property.config || "—"],
    ["Carpet area", carpet ?? "Being confirmed"],
    [price && s.priceMin === null ? "Listed price" : "Price", price ?? "On request"],
    ["Possession", m.property.possession],
    ["Homes", s.total ? `${s.available} of ${s.total} available${s.indicative ? ` · ${s.indicative} being confirmed` : ""}` : s.indicative ? `${s.indicative} being confirmed` : "—"],
    m.property.architect ? ["Architect", m.property.architect] : ["Location", `${m.property.locality}, ${m.property.city}`],
  ];
  const osm = m.property.coords
    ? `https://www.openstreetmap.org/export/embed.html?bbox=${m.property.coords.lng - 0.012},${m.property.coords.lat - 0.008},${m.property.coords.lng + 0.012},${m.property.coords.lat + 0.008}&layer=mapnik&marker=${m.property.coords.lat},${m.property.coords.lng}`
    : null;

  return (
    <div className="pp" style={theme}>
      {/* The builder's fonts, by name from its brand kit. */}
      <link rel="stylesheet" href={googleFonts([m.brand.headingFont, m.brand.bodyFont])} precedence="default" />
      <UnitSelection>
        {/* ── Top bar ── */}
        <header className="pp-top">
          <div className="pp-wrap flex h-16 items-center justify-between gap-4">
            {m.brand.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={m.brand.logoUrl} alt={m.brand.builderName} className="h-9 w-auto" />
            ) : (
              <span className="pp-heading text-[20px] tracking-wide">{m.brand.builderName}</span>
            )}
            <nav aria-label="Sections" className="hidden items-center gap-6 text-[13px] md:flex">
              <a href="#homes">Homes</a>
              {m.media.length > 1 && <a href="#gallery">Gallery</a>}
              <a href="#location">Location</a>
              {m.amenities.length > 0 && <a href="#amenities">Amenities</a>}
              <a href="#enquire" className="pp-button pp-button-sm">Enquire</a>
            </nav>
          </div>
        </header>

        {/* ── Hero ── */}
        <section className="pp-hero" aria-label={m.property.name}>
          {hero && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={hero.url} alt={hero.caption || m.property.name} className="pp-hero-img" />
          )}
          <div className="pp-hero-shade" />
          <div className="pp-wrap pp-hero-body">
            <div className="flex flex-wrap items-center gap-2">
              <span className="pp-eyebrow">{m.property.builder} · {m.property.locality}, {m.property.city}</span>
              <span className="pp-chip-light">{m.rera.number ? `RERA ${m.rera.number}` : m.rera.status}</span>
            </div>
            <h1 className="pp-heading pp-h1">{m.copy.headline}</h1>
            {m.copy.subhead && <p className="pp-lede">{m.copy.subhead}</p>}
            {m.copy.aiLabel && <p className="mt-1 text-[11px] opacity-70">{m.copy.aiLabel}</p>}
            <div className="mt-6 flex flex-wrap gap-2">
              {s.configs.length > 0 && <span className="pp-chip-light">{s.configs.join(" · ")}</span>}
              {price && <span className="pp-chip-light">{s.priceMin === null ? `Listed at ${price}` : `From ${inr(s.priceMin)}`}</span>}
              <span className="pp-chip-light">{m.property.possession}</span>
              {s.total > 0 && <span className="pp-chip-light">{s.available} of {s.total} confirmed home{s.total === 1 ? "" : "s"} available</span>}
              {s.indicative > 0 && <span className="pp-chip-light">{s.indicative} more being confirmed</span>}
            </div>
            <div className="mt-7 flex flex-wrap gap-3">
              <a href="#enquire" className="pp-button">Book a visit or ask a question</a>
              <a href="#homes" className="pp-button-ghost">See available homes</a>
            </div>
          </div>
          {hero && <span className="pp-media-label pp-hero-label">{hero.label}</span>}
        </section>

        {/* ── Key facts ── */}
        <section className="pp-wrap" aria-label="Key facts">
          <dl className="pp-facts">
            {facts.map(([k, v]) => (
              <div key={k} className="pp-fact">
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
        </section>

        <div className="pp-wrap pp-main">
          <div className="min-w-0 space-y-16">
            {/* ── Homes & availability ── */}
            <section id="homes" className="pp-section">
              <p className="pp-kicker">Homes &amp; availability</p>
              <h2 className="pp-heading pp-h2">Choose your home</h2>
              <p className="pp-copy">
                {s.total} confirmed home{s.total === 1 ? "" : "s"} · {s.available} available{s.held ? ` · ${s.held} on hold` : ""}{s.sold ? ` · ${s.sold} sold` : ""}
                {s.indicative ? ` · plus ${s.indicative} still being confirmed` : ""}
                {m.building?.statedTotalUnits && m.building.statedTotalUnits !== s.total + s.indicative ? ` · the builder's documents state ${m.building.statedTotalUnits} in all` : ""}.
              </p>
              {s.indicative > 0 && <p className="pp-note mt-3"><strong>{s.indicative} indicative</strong> unit{s.indicative === 1 ? " is a layout placeholder" : "s are layout placeholders"} while details are confirmed with the builder — shown hatched, with no status, area, facing or price, and not counted above.</p>}
              <div className="mt-6">{m.units.length > 0 ? <UnitGrid units={m.units} lastVerified={s.lastVerifiedAt} /> : <p className="pp-copy">Unit-level availability isn&apos;t published for this building yet — enquire and the team will share it.</p>}</div>
            </section>

            {/* ── Gallery ── */}
            {m.media.length > 1 && (
              <section id="gallery" className="pp-section">
                <p className="pp-kicker">Gallery</p>
                <h2 className="pp-heading pp-h2">A closer look</h2>
                <div className="pp-gallery mt-6">
                  {m.media.slice(1, 7).map((img, i) => (
                    <figure key={img.url + i} className="pp-figure">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={img.url} alt={img.caption || `${m.property.name} image ${i + 2}`} loading="lazy" />
                      <figcaption className="pp-media-label">{img.label}</figcaption>
                    </figure>
                  ))}
                </div>
              </section>
            )}

            {/* ── Location ── */}
            <section id="location" className="pp-section">
              <p className="pp-kicker">Location</p>
              <h2 className="pp-heading pp-h2">{m.property.locality}, {m.property.city}</h2>
              {m.property.address && <p className="pp-copy">{m.property.address}</p>}
              <div className="mt-6 grid gap-6 lg:grid-cols-[1.4fr_1fr]">
                {osm ? <iframe title={`Map of ${m.property.name}`} src={osm} className="pp-map" loading="lazy" /> : <div className="pp-panel p-6 text-[14px] opacity-75">Map not available.</div>}
                {m.landmarks.length > 0 && (
                  <ul className="pp-landmarks">
                    {m.landmarks.map((l) => (
                      <li key={l.name}><span>{l.name}</span><span className="opacity-60">{l.km !== null ? `${l.km} km` : ""}</span></li>
                    ))}
                  </ul>
                )}
              </div>
            </section>

            {/* ── Amenities ── */}
            {m.amenities.length > 0 && (
              <section id="amenities" className="pp-section">
                <p className="pp-kicker">Amenities</p>
                <h2 className="pp-heading pp-h2">Life at {m.property.name}</h2>
                <ul className="pp-amenities mt-6">
                  {m.amenities.map((a) => (
                    <li key={a.name}>
                      <span className="font-medium">{a.name}</span>
                      {(a.detail || a.planned) && <span className="block text-[12px] opacity-60">{a.planned ? "Planned" : a.detail}</span>}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {/* ── Trust ── */}
            <section className="pp-section" aria-label="Trust and disclosures">
              <p className="pp-kicker">Trust</p>
              <h2 className="pp-heading pp-h2">What you can rely on</h2>
              <dl className="pp-trust mt-6">
                <div><dt>RERA</dt><dd>{m.rera.number ? <>Reg. No. {m.rera.number}<span className="block text-[12px] opacity-60">{m.rera.status}</span></> : m.rera.status}</dd></div>
                <div><dt>Listing</dt><dd>{m.property.verified ? "Independently verified" : "Not independently verified yet"}</dd></div>
                {m.property.grade && <div><dt>Honest grade</dt><dd>{m.property.grade}</dd></div>}
                <div><dt>Builder</dt><dd>{m.property.builder}{m.property.developerNote ? <span className="block text-[12px] opacity-60">{m.property.developerNote}</span> : null}</dd></div>
              </dl>
              {m.notes.map((n) => <p key={n} className="pp-note mt-3">{n}</p>)}
            </section>
          </div>

          {/* ── Enquiry (sticky) ── */}
          <aside id="enquire" className="pp-aside" aria-label="Enquire">
            <div className="pp-enquiry">{enquiry}</div>
            {preview && <p className="mt-2 text-[12px] opacity-60">Preview — a test enquiry goes to the sales team marked as a test.</p>}
          </aside>
        </div>

        <footer className="pp-footer">
          <div className="pp-wrap space-y-1 py-8 text-[12px] opacity-75">
            <p className="font-semibold">{m.rera.number ? `RERA Reg. No.: ${m.rera.number}` : `RERA: ${m.rera.status}`} · {m.property.builder}</p>
            <p>Availability and prices are read live from the builder&apos;s inventory{s.lastVerifiedAt ? ` (last status change ${new Date(s.lastVerifiedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })})` : ""}. Areas are carpet area unless stated. Images are labelled as renders, photos or placeholders.</p>
          </div>
        </footer>
      </UnitSelection>
    </div>
  );
}
