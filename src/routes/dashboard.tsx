import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { toast } from "sonner";
import { Globe, Loader2, Lock, Plus, Trash2 } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { deleteTour, listTours, signedCover, type Tour } from "@/lib/tours";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/dashboard")({
  head: () => ({
    meta: [
      { title: "My Tours — RoomVerse AI" },
      {
        name: "description",
        content: "Manage your RoomVerse AI virtual tours: open, share or delete 360° walkthroughs.",
      },
      { property: "og:title", content: "My Tours — RoomVerse AI" },
      { property: "og:description", content: "Your library of generated 360° virtual tours." },
    ],
  }),
  component: Dashboard,
});

function Dashboard() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!loading && !user) navigate({ to: "/auth", search: { mode: "login" } });
  }, [loading, user, navigate]);

  const tours = useQuery({
    queryKey: ["tours", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const rows = await listTours(user!.id);
      return Promise.all(
        rows.map(async (tour) => ({ tour, cover: await signedCover(tour.cover_url) })),
      );
    },
  });

  const remove = async (tour: Tour) => {
    try {
      await deleteTour(tour.id);
      toast.success("Tour deleted.");
      queryClient.invalidateQueries({ queryKey: ["tours", user?.id] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not delete tour.");
    }
  };

  if (loading || !user) {
    return (
      <main className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-primary" />
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-7xl px-5 py-14">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">Library</p>
          <h1 className="mt-3 text-4xl sm:text-5xl">My tours</h1>
        </div>
        <Button variant="gold" asChild>
          <Link to="/create">
            <Plus className="mr-2 h-4 w-4" /> New tour
          </Link>
        </Button>
      </div>

      {tours.isLoading ? (
        <div className="mt-14 flex justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
        </div>
      ) : !tours.data?.length ? (
        <div className="mt-12 rounded-2xl border border-dashed border-border bg-surface p-14 text-center">
          <h2 className="text-2xl">No tours yet</h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
            Record or upload a walkthrough video and RoomVerse will build your first immersive 360°
            tour.
          </p>
          <Button variant="gold" className="mt-6" asChild>
            <Link to="/create">Capture a room</Link>
          </Button>
        </div>
      ) : (
        <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {tours.data.map(({ tour, cover }) => (
            <article
              key={tour.id}
              className="group overflow-hidden rounded-2xl border border-border bg-surface transition-colors hover:border-primary/40"
            >
              <Link to="/tour/$slug" params={{ slug: tour.share_slug }} className="block">
                <div className="aspect-[16/9] overflow-hidden bg-muted">
                  {cover ? (
                    <img
                      src={cover}
                      alt={`Panorama preview of ${tour.title}`}
                      className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-105"
                    />
                  ) : null}
                </div>
              </Link>
              <div className="p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-xl">{tour.title}</h2>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {new Date(tour.created_at).toLocaleDateString()} ·{" "}
                      {tour.video_duration ? `${tour.video_duration.toFixed(0)}s source` : "—"}
                    </p>
                  </div>
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    {tour.is_public ? <Globe className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5" />}
                    {tour.is_public ? "Public" : "Private"}
                  </span>
                </div>
                <div className="mt-5 flex gap-2">
                  <Button variant="glass" size="sm" className="flex-1" asChild>
                    <Link to="/tour/$slug" params={{ slug: tour.share_slug }}>
                      Open tour
                    </Link>
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`Delete ${tour.title}`}
                    onClick={() => remove(tour)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </main>
  );
}
