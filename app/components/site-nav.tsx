import Link from "next/link";

export type SiteNavLink = {
  href: string;
  label: string;
  /** Renders as the filled call-to-action on desktop and in the mobile menu. */
  cta?: boolean;
  /** Extra classes for the desktop link only (the mobile menu keeps a consistent style). */
  className?: string;
};

/**
 * Shared top navigation. On wide screens the links sit in a single row; at
 * <=800px they collapse into a native, keyboard-accessible `<details>`
 * disclosure so navigation never disappears on small screens.
 */
export function SiteNav({ links = [] }: { links?: SiteNavLink[] }) {
  return (
    <nav className="nav nav-with-menu">
      <Link href="/" className="brand" aria-label="Blueprint home">
        <span className="brand-mark" aria-hidden="true">B</span> blueprint
      </Link>
      {links.length > 0 && (
        <>
          <div className="nav-links">
            {links.map((link) => (
              <Link key={`d-${link.href}-${link.label}`} href={link.href} className={link.className ?? (link.cta ? "nav-cta" : undefined)}>
                {link.label}
              </Link>
            ))}
          </div>
          <details className="nav-menu">
            <summary className="nav-menu-toggle">
              <svg className="nav-menu-icon" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
                <path d="M3 6h14M3 10h14M3 14h14" />
              </svg>
              <span>Menu</span>
            </summary>
            <div className="nav-menu-panel">
              {links.map((link) => (
                <Link key={`m-${link.href}-${link.label}`} href={link.href} className={link.cta ? "nav-menu-cta" : "nav-menu-link"}>
                  {link.label}
                </Link>
              ))}
            </div>
          </details>
        </>
      )}
    </nav>
  );
}
