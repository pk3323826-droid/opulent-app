import { Link, useRouterState } from "@tanstack/react-router";
import { Menu, X } from "lucide-react";
import { useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const links = [
  { to: "/", label: "Home" },
  { to: "/create", label: "Create Tour" },
  { to: "/dashboard", label: "My Tours" },
] as const;

export function SiteHeader() {
  const { user, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const immersive = pathname.startsWith("/tour/");

  if (immersive) return null;

  return (
    <header className="sticky top-0 z-40 border-b border-border/70 bg-background/70 backdrop-blur-xl">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-4">
        <Link to="/" className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-full border border-primary/50 bg-[image:var(--gradient-gold)] text-sm font-semibold text-primary-foreground">
            R
          </span>
          <span className="font-display text-xl tracking-wide">
            Room<span className="text-gold-gradient">Verse</span>
          </span>
        </Link>

        <nav className="hidden items-center gap-8 md:flex">
          {links.map((link) => (
            <Link
              key={link.to}
              to={link.to}
              className={cn(
                "text-sm tracking-wide text-muted-foreground transition-colors hover:text-foreground",
                pathname === link.to && "text-primary",
              )}
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="hidden items-center gap-3 md:flex">
          {user ? (
            <>
              <span className="max-w-[12rem] truncate text-xs text-muted-foreground">{user.email}</span>
              <Button variant="glass" size="sm" onClick={() => signOut()}>
                Sign out
              </Button>
            </>
          ) : (
            <>
              <Button variant="ghost" size="sm" asChild>
                <Link to="/auth">Log in</Link>
              </Button>
              <Button variant="gold" size="sm" asChild>
                <Link to="/auth" search={{ mode: "signup" }}>
                  Sign up
                </Link>
              </Button>
            </>
          )}
        </div>

        <button className="md:hidden" onClick={() => setOpen((o) => !o)} aria-label="Menu">
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>

      {open && (
        <div className="border-t border-border/70 px-5 py-4 md:hidden">
          <div className="flex flex-col gap-4">
            {links.map((link) => (
              <Link
                key={link.to}
                to={link.to}
                onClick={() => setOpen(false)}
                className="text-sm text-muted-foreground"
              >
                {link.label}
              </Link>
            ))}
            {user ? (
              <Button variant="glass" size="sm" onClick={() => signOut()}>
                Sign out
              </Button>
            ) : (
              <Button variant="gold" size="sm" asChild>
                <Link to="/auth" onClick={() => setOpen(false)}>
                  Log in / Sign up
                </Link>
              </Button>
            )}
          </div>
        </div>
      )}
    </header>
  );
}
