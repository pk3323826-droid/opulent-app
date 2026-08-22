import { Link } from "@tanstack/react-router";

export function SiteFooter() {
  return (
    <footer className="mt-24 border-t border-border/70 bg-background/60">
      <div className="mx-auto flex max-w-7xl flex-col gap-6 px-5 py-10 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="font-display text-xl">
            Room<span className="text-gold-gradient">Verse</span> AI
          </p>
          <p className="mt-1 max-w-md text-xs leading-relaxed text-muted-foreground">
            Panoramas are composited from the frames you actually captured. Areas the camera never
            saw stay visibly uncaptured — we never invent architecture.
          </p>
        </div>
        <div className="flex gap-6 text-xs text-muted-foreground">
          <Link to="/create" className="hover:text-foreground">
            Create
          </Link>
          <Link to="/dashboard" className="hover:text-foreground">
            My tours
          </Link>
          <Link to="/auth" className="hover:text-foreground">
            Account
          </Link>
        </div>
      </div>
    </footer>
  );
}
