"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS: [href: string, label: string][] = [
  ["/", "Dashboard"],
  ["/library", "Library"],
  ["/chat", "Chat"],
  ["/rate", "Rate"],
];

const isActive = (href: string, pathname: string) =>
  href === "/" ? pathname === "/" : pathname.startsWith(href);

export default function HeaderNav() {
  const pathname = usePathname();

  return (
    <>
      {/* Desktop: inline row */}
      <nav className="hidden sm:flex items-center gap-1">
        {LINKS.map(([href, label]) => (
          <Link
            key={href}
            href={href}
            aria-current={isActive(href, pathname) ? "page" : undefined}
            className={`btn btn-ghost btn-sm rounded-lg transition-colors hover:bg-primary/15 hover:text-primary ${
              isActive(href, pathname) ? "bg-primary/15 text-primary" : "text-base-content/80"
            }`}
          >
            {label}
          </Link>
        ))}
        <form action="/auth/signout" method="post">
          <button
            type="submit"
            className="btn btn-ghost btn-sm rounded-lg text-base-content/60 transition-colors hover:bg-error/15 hover:text-error"
          >
            Sign out
          </button>
        </form>
      </nav>

      {/* Mobile: hamburger dropdown */}
      <div className="dropdown dropdown-end sm:hidden">
        <div tabIndex={0} role="button" aria-label="Menu" className="btn btn-ghost btn-square">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-7 w-7" fill="none"
            viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </div>
        <ul
          tabIndex={0}
          className="dropdown-content menu mt-3 z-40 w-60 gap-1 rounded-box border border-base-content/10 bg-base-200 p-3 text-base shadow-xl"
        >
          {LINKS.map(([href, label]) => (
            <li key={href}>
              <Link
                href={href}
                aria-current={isActive(href, pathname) ? "page" : undefined}
                className={`py-3 ${
                  isActive(href, pathname) ? "bg-primary/15 text-primary font-semibold" : ""
                }`}
              >
                {label}
              </Link>
            </li>
          ))}
          <li className="mt-1 border-t border-base-content/10 pt-1">
            <form action="/auth/signout" method="post">
              <button type="submit" className="w-full py-3 text-left text-base-content/70">
                Sign out
              </button>
            </form>
          </li>
        </ul>
      </div>
    </>
  );
}
