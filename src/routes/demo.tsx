import { createFileRoute, Link } from "@tanstack/react-router";
import { ClientOnly } from "@tanstack/react-router";
import { lazy, Suspense, useState } from "react";
import demoPanorama from "@/assets/demo-panorama.jpg";
import type { Hotspot, Room } from "@/lib/tours";
import { Button } from "@/components/ui/button";

const PanoramaViewer = lazy(() => import("@/components/PanoramaViewer"));

export const Route = createFileRoute("/demo")({
  head: () => ({
    meta: [
      { title: "Demo 360° Tour — RoomVerse AI" },
      {
        name: "description",
        content:
          "Explore a sample RoomVerse AI virtual tour: drag to look around a penthouse living room, open hotspots and enter VR mode.",
      },
      { property: "og:title", content: "Demo 360° Tour — RoomVerse AI" },
      {
        property: "og:description",
        content: "A sample immersive 360° walkthrough rendered in the RoomVerse viewer.",
      },
    ],
  }),
  component: DemoPage,
});

const rooms: Room[] = [
  {
    id: "demo-room",
    name: "Penthouse Living Room",
    panorama_url: "demo",
    position: 0,
    coverage_degrees: 360,
    frame_count: 48,
  },
];

const hotspots: Hotspot[] = [
  {
    id: "h1",
    room_id: "demo-room",
    title: "Skyline windows",
    description: "Floor-to-ceiling glazing across the west facade with motorised sheer curtains.",
    kind: "info",
    yaw: 10,
    pitch: 2,
    link_url: null,
    target_room_id: null,
  },
  {
    id: "h2",
    room_id: "demo-room",
    title: "Marble fireplace",
    description: "Book-matched marble surround with a linear gas insert.",
    kind: "info",
    yaw: 150,
    pitch: -4,
    link_url: null,
    target_room_id: null,
  },
  {
    id: "h3",
    room_id: "demo-room",
    title: "Dining area",
    description: "Seats ten under a hand-blown crystal chandelier.",
    kind: "info",
    yaw: -80,
    pitch: -2,
    link_url: null,
    target_room_id: null,
  },
];

function DemoPage() {
  const [activeRoomId, setActiveRoomId] = useState(rooms[0].id);

  return (
    <main className="mx-auto max-w-7xl px-5 py-12">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">Demo tour</p>
          <h1 className="mt-3 text-4xl">Penthouse Living Room</h1>
          <p className="mt-2 max-w-xl text-sm text-muted-foreground">
            This sample shows the finished viewer: drag to look around, scroll to zoom, tap a hotspot,
            or enter VR on a compatible headset.
          </p>
        </div>
        <Button variant="gold" asChild>
          <Link to="/create">Create your own</Link>
        </Button>
      </div>

      <div className="mt-8">
        <ClientOnly fallback={<div className="h-[62vh] rounded-2xl border border-border bg-surface" />}>
          <Suspense fallback={<div className="h-[62vh] rounded-2xl border border-border bg-surface" />}>
            <PanoramaViewer
              rooms={rooms}
              panoramaUrls={{ "demo-room": demoPanorama }}
              hotspots={hotspots}
              activeRoomId={activeRoomId}
              onRoomChange={setActiveRoomId}
            />
          </Suspense>
        </ClientOnly>
      </div>
    </main>
  );
}
