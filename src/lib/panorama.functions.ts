import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const input = z.object({ tourId: z.string().uuid() });

/**
 * Signs the panorama images of a PUBLIC tour so share links work for visitors
 * without an account. Private tours are never signed here — their owner signs
 * them client-side through their own authenticated session.
 */
export const signPublicPanoramas = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => input.parse(data))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: tour, error } = await supabaseAdmin
      .from("tours")
      .select("id, is_public")
      .eq("id", data.tourId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!tour || !tour.is_public) return { urls: {} as Record<string, string> };

    const { data: rooms, error: roomsError } = await supabaseAdmin
      .from("tour_rooms")
      .select("id, panorama_url")
      .eq("tour_id", data.tourId);
    if (roomsError) throw new Error(roomsError.message);

    const urls: Record<string, string> = {};
    for (const room of rooms ?? []) {
      const signed = await supabaseAdmin.storage
        .from("panoramas")
        .createSignedUrl(room.panorama_url, 60 * 60 * 6);
      if (signed.data?.signedUrl) urls[room.id] = signed.data.signedUrl;
    }
    return { urls };
  });
