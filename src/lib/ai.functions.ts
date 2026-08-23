import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const refineInput = z.object({
  image: z.string(),
  roomName: z.string(),
  coverageDegrees: z.number(),
});

const narrateInput = z.object({
  fileName: z.string(),
  coverageDegrees: z.number(),
  score: z.number(),
  issues: z.array(z.string()),
  rooms: z.array(z.object({ name: z.string(), coverageDegrees: z.number() })),
});

/**
 * Refines a stitched equirectangular panorama with an AI image model so the
 * walkthrough preview reads as a continuous 360° space: seams are smoothed and
 * bands the camera never saw are completed from the surrounding room, without
 * inventing new furniture or architecture.
 */
export const refinePanorama = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => refineInput.parse(data))
  .handler(async ({ data }) => {
    const { callGateway, extractImage, extractText, AiGatewayError } = await import(
      "@/lib/ai-gateway.server"
    );

    const prompt = [
      "This is a 2:1 equirectangular 360° panorama stitched from a handheld room video.",
      `It covers roughly ${Math.round(data.coverageDegrees)}° of the room "${data.roomName}".`,
      "Return a refined version of the SAME panorama for VR playback:",
      "- keep the existing geometry, furniture, materials and lighting exactly where they are",
      "- smooth visible stitch seams and exposure jumps between frames",
      "- complete the dark ceiling and floor bands using the room's own surfaces",
      "- keep verticals straight and the horizon centred so it maps cleanly to a sphere",
      "- do not add furniture, doors, windows, people or text that is not already visible",
      "Output the image only.",
    ].join("\n");

    try {
      const payload = await callGateway({
        model: "google/gemini-2.5-flash-image",
        modalities: ["image", "text"],
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              { type: "image_url", image_url: { url: data.image } },
            ],
          },
        ],
      });
      return { image: extractImage(payload), note: extractText(payload).slice(0, 400) };
    } catch (error) {
      if (error instanceof AiGatewayError) {
        throw new Error(error.message);
      }
      throw error;
    }
  });

/**
 * Writes the listing copy for the walkthrough: title, description, per-room
 * captions and capture advice, grounded in the measured quality report.
 */
export const narrateWalkthrough = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => narrateInput.parse(data))
  .handler(async ({ data }) => {
    const { callGateway, extractText, AiGatewayError } = await import("@/lib/ai-gateway.server");

    const facts = [
      `Source file: ${data.fileName}`,
      `Capture score: ${data.score}/100`,
      `Widest room coverage: ${Math.round(data.coverageDegrees)}°`,
      `Detected spaces: ${data.rooms.map((r) => `${r.name} (${Math.round(r.coverageDegrees)}°)`).join(", ")}`,
      data.issues.length ? `Measured issues: ${data.issues.join("; ")}` : "No quality issues measured.",
    ].join("\n");

    try {
      const payload = await callGateway({
        model: "openai/gpt-5.6-sol",
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "You write concise, tasteful copy for real-estate style 360° virtual tours. Never invent rooms, amenities or measurements that are not in the supplied facts. Reply with json only.",
          },
          {
            role: "user",
            content: [
              "Write the copy for this virtual tour based only on the facts below.",
              "Return json with keys: title (max 60 chars), description (max 240 chars, 1-2 sentences),",
              "rooms (array of { name (max 28 chars), caption (max 90 chars) } in the same order as the detected spaces),",
              "tips (array of at most 3 short strings, each max 90 chars, on how to improve the next capture).",
              "",
              facts,
            ].join("\n"),
          },
        ],
      });

      const raw = extractText(payload);
      const parsed = JSON.parse(raw) as {
        title?: string;
        description?: string;
        rooms?: { name?: string; caption?: string }[];
        tips?: string[];
      };

      const clamp = (value: string | undefined, max: number, fallback: string) =>
        (value?.trim() || fallback).slice(0, max);

      return {
        title: clamp(parsed.title, 60, "Virtual Walkthrough"),
        description: clamp(parsed.description, 240, "An interactive 360° walkthrough of this space."),
        rooms: data.rooms.map((room, index) => ({
          name: clamp(parsed.rooms?.[index]?.name, 28, room.name),
          caption: clamp(parsed.rooms?.[index]?.caption, 90, ""),
        })),
        tips: (parsed.tips ?? []).slice(0, 3).map((tip) => String(tip).slice(0, 90)),
      };
    } catch (error) {
      if (error instanceof AiGatewayError) throw new Error(error.message);
      if (error instanceof SyntaxError) throw new Error("The AI returned copy we could not read.");
      throw error;
    }
  });
