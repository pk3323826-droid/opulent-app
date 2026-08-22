import { supabase } from "@/integrations/supabase/client";
import { signPublicPanoramas } from "@/lib/panorama.functions";
import type { PipelineResult, QualityReport } from "@/lib/pipeline";

export interface Room {
  id: string;
  name: string;
  panorama_url: string;
  position: number;
  coverage_degrees: number | null;
  frame_count: number | null;
}

export interface Hotspot {
  id: string;
  room_id: string;
  title: string;
  description: string | null;
  kind: string;
  yaw: number;
  pitch: number;
  link_url: string | null;
  target_room_id: string | null;
}

export interface Tour {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  cover_url: string | null;
  status: string;
  is_public: boolean;
  share_slug: string;
  video_duration: number | null;
  video_size: number | null;
  quality_report: QualityReport | Record<string, never>;
  created_at: string;
}

export interface TourBundle {
  tour: Tour;
  rooms: Room[];
  hotspots: Hotspot[];
  panoramaUrls: Record<string, string>;
}

export async function listTours(userId: string) {
  const { data, error } = await supabase
    .from("tours")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as Tour[];
}

async function resolvePanoramaUrls(tour: Tour, rooms: Room[]) {
  const { data: session } = await supabase.auth.getSession();
  const isOwner = session.session?.user.id === tour.user_id;

  if (isOwner) {
    const urls: Record<string, string> = {};
    for (const room of rooms) {
      const signed = await supabase.storage
        .from("panoramas")
        .createSignedUrl(room.panorama_url, 60 * 60 * 6);
      if (signed.data?.signedUrl) urls[room.id] = signed.data.signedUrl;
    }
    return urls;
  }
  const result = await signPublicPanoramas({ data: { tourId: tour.id } });
  return result.urls;
}

export async function getTourBySlug(slug: string): Promise<TourBundle> {
  const { data: tour, error } = await supabase
    .from("tours")
    .select("*")
    .eq("share_slug", slug)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!tour) throw new Error("Tour not found or no longer shared.");

  const typedTour = tour as unknown as Tour;

  const { data: rooms, error: roomsError } = await supabase
    .from("tour_rooms")
    .select("*")
    .eq("tour_id", typedTour.id)
    .order("position", { ascending: true });
  if (roomsError) throw new Error(roomsError.message);
  const typedRooms = (rooms ?? []) as unknown as Room[];

  const { data: hotspots } = await supabase
    .from("hotspots")
    .select("*")
    .in("room_id", typedRooms.length ? typedRooms.map((r) => r.id) : ["00000000-0000-0000-0000-000000000000"]);

  return {
    tour: typedTour,
    rooms: typedRooms,
    hotspots: (hotspots ?? []) as unknown as Hotspot[],
    panoramaUrls: await resolvePanoramaUrls(typedTour, typedRooms),
  };
}

export async function saveTour(params: {
  userId: string;
  title: string;
  description: string;
  file: File;
  result: PipelineResult;
}) {
  const { userId, title, description, file, result } = params;

  const { data: tour, error } = await supabase
    .from("tours")
    .insert({
      user_id: userId,
      title,
      description,
      status: "ready",
      video_duration: result.duration,
      video_size: file.size,
      quality_report: result.report as unknown as Record<string, unknown>,
    })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  const typedTour = tour as unknown as Tour;

  let coverPath: string | null = null;
  for (let i = 0; i < result.rooms.length; i++) {
    const room = result.rooms[i];
    const path = `${userId}/${typedTour.id}/room-${i + 1}.jpg`;
    const upload = await supabase.storage
      .from("panoramas")
      .upload(path, room.blob, { contentType: "image/jpeg", upsert: true });
    if (upload.error) throw new Error(upload.error.message);
    if (i === 0) coverPath = path;

    const { error: roomError } = await supabase.from("tour_rooms").insert({
      tour_id: typedTour.id,
      name: room.name,
      panorama_url: path,
      position: i,
      coverage_degrees: room.coverageDegrees,
      frame_count: room.frameCount,
    });
    if (roomError) throw new Error(roomError.message);
  }

  if (coverPath) {
    await supabase.from("tours").update({ cover_url: coverPath }).eq("id", typedTour.id);
  }
  return typedTour;
}

export async function deleteTour(id: string) {
  const { error } = await supabase.from("tours").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

export async function updateTour(id: string, patch: Partial<Pick<Tour, "title" | "description" | "is_public">>) {
  const { error } = await supabase.from("tours").update(patch).eq("id", id);
  if (error) throw new Error(error.message);
}

export async function renameRoom(id: string, name: string) {
  const { error } = await supabase.from("tour_rooms").update({ name }).eq("id", id);
  if (error) throw new Error(error.message);
}

export async function addHotspot(hotspot: {
  room_id: string;
  title: string;
  description?: string;
  kind: string;
  yaw: number;
  pitch: number;
  link_url?: string | null;
  target_room_id?: string | null;
}) {
  const { data, error } = await supabase.from("hotspots").insert(hotspot).select("*").single();
  if (error) throw new Error(error.message);
  return data as unknown as Hotspot;
}

export async function deleteHotspot(id: string) {
  const { error } = await supabase.from("hotspots").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

export async function signedCover(path: string | null) {
  if (!path) return null;
  const { data } = await supabase.storage.from("panoramas").createSignedUrl(path, 60 * 60);
  return data?.signedUrl ?? null;
}
