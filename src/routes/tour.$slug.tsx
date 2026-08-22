import { ClientOnly, createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { lazy, Suspense, useEffect, useState } from "react";
import { toast } from "sonner";
import { Check, Copy, Globe, Loader2, Lock, Pencil } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import {
  addHotspot,
  deleteHotspot,
  getTourBySlug,
  renameRoom,
  updateTour,
} from "@/lib/tours";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const PanoramaViewer = lazy(() => import("@/components/PanoramaViewer"));

export const Route = createFileRoute("/tour/$slug")({
  head: () => ({
    meta: [
      { title: "Virtual Tour — RoomVerse AI" },
      {
        name: "description",
        content:
          "Explore this interactive 360° virtual tour: look around each room, open hotspots and enter VR mode.",
      },
      { property: "og:title", content: "Virtual Tour — RoomVerse AI" },
      {
        property: "og:description",
        content: "An immersive 360° walkthrough generated with RoomVerse AI.",
      },
    ],
  }),
  component: TourPage,
});

function TourPage() {
  const { slug } = Route.useParams();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [activeRoomId, setActiveRoomId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, setPending] = useState<{ yaw: number; pitch: number } | null>(null);
  const [hotspotTitle, setHotspotTitle] = useState("");
  const [hotspotBody, setHotspotBody] = useState("");

  const tour = useQuery({ queryKey: ["tour", slug], queryFn: () => getTourBySlug(slug) });

  useEffect(() => {
    const first = tour.data?.rooms[0]?.id;
    if (first && !activeRoomId) setActiveRoomId(first);
  }, [tour.data, activeRoomId]);

  const isOwner = !!user && tour.data?.tour.user_id === user.id;
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["tour", slug] });

  const togglePublic = useMutation({
    mutationFn: async (next: boolean) => updateTour(tour.data!.tour.id, { is_public: next }),
    onSuccess: () => {
      invalidate();
      toast.success("Sharing updated.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const createHotspot = useMutation({
    mutationFn: async () => {
      if (!pending || !activeRoomId) return;
      await addHotspot({
        room_id: activeRoomId,
        title: hotspotTitle.trim() || "Hotspot",
        description: hotspotBody.trim(),
        kind: "info",
        yaw: pending.yaw,
        pitch: pending.pitch,
      });
    },
    onSuccess: () => {
      setPending(null);
      setHotspotTitle("");
      setHotspotBody("");
      invalidate();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const copyLink = async () => {
    await navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  if (tour.isLoading) {
    return (
      <main className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-primary" />
      </main>
    );
  }

  if (tour.isError || !tour.data) {
    return (
      <main className="mx-auto max-w-xl px-5 py-24 text-center">
        <h1 className="text-3xl">Tour unavailable</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          This tour doesn't exist, or the owner hasn't shared it publicly.
        </p>
        <Button variant="gold" className="mt-8" asChild>
          <Link to="/">Back home</Link>
        </Button>
      </main>
    );
  }

  const { tour: meta, rooms, hotspots, panoramaUrls } = tour.data;
  const activeRoom = rooms.find((room) => room.id === activeRoomId) ?? rooms[0];

  return (
    <main className="mx-auto max-w-7xl px-5 py-12">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">Virtual tour</p>
          <h1 className="mt-3 text-4xl">{meta.title}</h1>
          {meta.description && (
            <p className="mt-2 max-w-xl text-sm text-muted-foreground">{meta.description}</p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="glass" size="sm" onClick={copyLink}>
            {copied ? <Check className="mr-2 h-4 w-4" /> : <Copy className="mr-2 h-4 w-4" />}
            Copy share link
          </Button>
          {isOwner && (
            <Button
              variant={meta.is_public ? "gold" : "outlineGold"}
              size="sm"
              onClick={() => togglePublic.mutate(!meta.is_public)}
              disabled={togglePublic.isPending}
            >
              {meta.is_public ? <Globe className="mr-2 h-4 w-4" /> : <Lock className="mr-2 h-4 w-4" />}
              {meta.is_public ? "Public" : "Private"}
            </Button>
          )}
        </div>
      </div>

      {!rooms.length ? (
        <p className="mt-10 text-sm text-muted-foreground">This tour has no rooms yet.</p>
      ) : (
        <>
          <div className="mt-8">
            <ClientOnly
              fallback={<div className="h-[62vh] rounded-2xl border border-border bg-surface" />}
            >
              <Suspense
                fallback={<div className="h-[62vh] rounded-2xl border border-border bg-surface" />}
              >
                <PanoramaViewer
                  rooms={rooms}
                  panoramaUrls={panoramaUrls}
                  hotspots={hotspots}
                  activeRoomId={activeRoom.id}
                  onRoomChange={setActiveRoomId}
                  editable={isOwner}
                  onCreateHotspot={setPending}
                  onDeleteHotspot={async (id) => {
                    try {
                      await deleteHotspot(id);
                      invalidate();
                    } catch (error) {
                      toast.error(error instanceof Error ? error.message : "Delete failed.");
                    }
                  }}
                />
              </Suspense>
            </ClientOnly>
          </div>

          <section className="mt-10 grid gap-6 lg:grid-cols-[1fr_320px]">
            <div className="rounded-2xl border border-border bg-surface p-6">
              <p className="eyebrow">Rooms</p>
              <ul className="mt-4 divide-y divide-border">
                {rooms.map((room) => (
                  <li key={room.id} className="flex items-center justify-between gap-3 py-3">
                    <button
                      onClick={() => setActiveRoomId(room.id)}
                      className={
                        room.id === activeRoom.id
                          ? "text-left text-base text-primary"
                          : "text-left text-base text-foreground hover:text-primary"
                      }
                    >
                      {room.name}
                    </button>
                    <span className="flex items-center gap-3 text-xs text-muted-foreground">
                      {room.coverage_degrees ? `${Math.round(room.coverage_degrees)}° captured` : ""}
                      {isOwner && (
                        <button
                          aria-label={`Rename ${room.name}`}
                          onClick={async () => {
                            const name = window.prompt("Room name", room.name);
                            if (!name) return;
                            await renameRoom(room.id, name);
                            invalidate();
                          }}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            <aside className="glass-panel h-fit rounded-2xl p-6">
              <p className="eyebrow">Capture quality</p>
              <dl className="mt-4 space-y-3 text-sm">
                {[
                  ["Source length", meta.video_duration ? `${meta.video_duration.toFixed(1)}s` : "—"],
                  ["Rooms", String(rooms.length)],
                  ["Hotspots", String(hotspots.length)],
                  [
                    "Frames used",
                    String(rooms.reduce((sum, room) => sum + (room.frame_count ?? 0), 0)),
                  ],
                ].map(([label, value]) => (
                  <div key={label} className="flex justify-between gap-4">
                    <dt className="text-muted-foreground">{label}</dt>
                    <dd className="font-mono text-xs">{value}</dd>
                  </div>
                ))}
              </dl>
              {isOwner && (
                <p className="mt-5 text-xs leading-relaxed text-muted-foreground">
                  Double-click anywhere in the viewer to place a hotspot.
                </p>
              )}
            </aside>
          </section>
        </>
      )}

      <Dialog open={!!pending} onOpenChange={(open) => !open && setPending(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New hotspot</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="hotspot-title">Title</Label>
              <Input
                id="hotspot-title"
                value={hotspotTitle}
                onChange={(event) => setHotspotTitle(event.target.value)}
                placeholder="Marble fireplace"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="hotspot-body">Description</Label>
              <Textarea
                id="hotspot-body"
                value={hotspotBody}
                onChange={(event) => setHotspotBody(event.target.value)}
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="glass" onClick={() => setPending(null)}>
              Cancel
            </Button>
            <Button
              variant="gold"
              onClick={() => createHotspot.mutate()}
              disabled={createHotspot.isPending}
            >
              Add hotspot
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}
