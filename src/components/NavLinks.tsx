"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS: [href: string, label: string][] = [
  ["/", "Dashboard"],
  ["/library", "Library"],
  ["/chat", "Chat"],
  ["/rate", "Rate"],
];

export default function NavLinks() {
  const pathname = usePathname();
  return (
    <>
      {LINKS.map(([href, label]) => {
        const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={`btn btn-ghost btn-sm rounded-lg transition-colors hover:bg-primary/15 hover:text-primary ${
              active ? "bg-primary/15 text-primary" : "text-base-content/80"
            }`}
          >
            {label}
          </Link>
        );
      })}
    </>
  );
}
