import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { ClientOnly } from "@tanstack/react-router";
import { toast } from "sonner";
import { z } from "zod";
import {
  AlertTriangle,
  CheckCircle2,
  CircleDot,
  Circle,
  Film,
  Loader2,
  Sparkles,
  Square,
  Upload,
  Video,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { processVideo, prescreen, type Progress, type Stage, type PipelineResult } from "@/lib/pipeline";
import { saveTour, type Room } from "@/lib/tours";
import { refinePanorama, narrateWalkthrough } from "@/lib/ai.functions";
import { blobToDataUrl, toEquirectangularBlob } from "@/lib/ai-preview";
import PanoramaViewer from "@/components/PanoramaViewer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Progress as ProgressBar } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/create")({
  validateSearch: z.object({ record: z.boolean().optional() }),
  head: () => ({
    meta: [
      { title: "Create a 360° Tour — RoomVerse AI" },
      {
        name: "description",
        content:
          "Upload or record a room video, run the RoomVerse capture-quality check, and generate an AI-refined interactive 360° virtual tour.",
      },
      { property: "og:title", content: "Create a 360° Tour — RoomVerse AI" },
      {
        property: "og:description",
        content: "Upload MP4, MOV or WebM footage and build an AI-refined immersive walkthrough in minutes.",
      },
    ],
  }),
  component: CreatePage,
});

type UiStage = Stage | "ai";

const STAGES: { key: UiStage; label: string }[] = [
  { key: "decode", label: "Video uploaded" },
  { key: "keyframes", label: "Extracting key frames" },
  { key: "tracking", label: "Analysing camera movement" },
  { key: "segmentation", label: "Detecting room transitions" },
  { key: "panorama", label: "Compositing 360° panoramas" },
  { key: "optimize", label: "Optimising for VR" },
  { key: "ai", label: "AI refining the walkthrough" },
  { key: "publish", label: "Creating virtual tour" },
];

interface AiPreview {
  refined: (Blob | null)[];
  /** AI depth maps (data URLs) that drive the volumetric 3D preview. */
  depth: (string | null)[];

  narrative: {
    title: string;
    description: string;
    rooms: { name: string; caption: string }[];
    tips: string[];
  } | null;
  failure: string | null;
}


const TIPS = [
  "Walk slowly and keep the camera at chest height.",
  "Keep camera movement smooth — no fast whips.",
  "Capture every corner of the room, panning a full circle.",
  "Move around furniture where possible.",
  "Avoid fast movement and motion blur.",
  "Capture doorways if several rooms are connected.",
  "Make sure the room is well lit.",
];

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function CreatePage() {
  const { record } = Route.useSearch();
  const { user, loading } = useAuth();
  const navigate = useNavigate();

  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [check, setCheck] = useState<{ duration: number; warnings: string[] } | null>(null);
  const [checking, setChecking] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [progress, setProgress] = useState<{ stage: UiStage; percent: number; message: string } | null>(
    null,
  );
  const [review, setReview] = useState<{ result: PipelineResult; ai: AiPreview } | null>(null);
  const [useAi, setUseAi] = useState(true);
  const [previews, setPreviews] = useState<{ raw: string[]; ai: (string | null)[] }>({ raw: [], ai: [] });
  const [activeRoom, setActiveRoom] = useState(0);

  const [dragOver, setDragOver] = useState(false);
  const [recording, setRecording] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const liveRef = useRef<HTMLVideoElement>(null);

  useEffect(() => () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    streamRef.current?.getTracks().forEach((t) => t.stop());
  }, [previewUrl]);

  const accept = async (next: File) => {
    if (!next.type.startsWith("video/")) {
      toast.error("Please choose an MP4, MOV or WebM video.");
      return;
    }
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setFile(next);
    setPreviewUrl(URL.createObjectURL(next));
    setTitle((current) => current || next.name.replace(/\.[^.]+$/, ""));
    setCheck(null);
    setChecking(true);
    try {
      const result = await prescreen(next);
      setCheck({ duration: result.duration, warnings: result.warnings });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not analyse this video.");
    } finally {
      setChecking(false);
    }
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 } },
        audio: false,
      });
      streamRef.current = stream;
      if (liveRef.current) {
        liveRef.current.srcObject = stream;
        await liveRef.current.play();
      }
      const chunks: Blob[] = [];
      const recorder = new MediaRecorder(stream, { mimeType: "video/webm" });
      recorder.ondataavailable = (event) => event.data.size && chunks.push(event.data);
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        const blob = new Blob(chunks, { type: "video/webm" });
        await accept(new File([blob], `capture-${Date.now()}.webm`, { type: "video/webm" }));
      };
      recorder.start();
      recorderRef.current = recorder;
      setRecording(true);
    } catch {
      toast.error("Camera access was blocked. Upload a file instead.");
    }
  };

  const stopRecording = () => {
    recorderRef.current?.stop();
    setRecording(false);
  };

  const runAi = async (result: PipelineResult): Promise<AiPreview> => {
    const rooms = result.rooms.slice(0, 4);
    const refined: (Blob | null)[] = result.rooms.map(() => null);
    let failure: string | null = null;

    for (let i = 0; i < rooms.length; i++) {
      setProgress({
        stage: "ai",
        percent: 84 + (i / Math.max(1, rooms.length)) * 10,
        message: `AI refining panorama ${i + 1} of ${rooms.length}…`,
      });
      try {
        const image = await blobToDataUrl(rooms[i].blob);
        const out = await refinePanorama({
          data: {
            image,
            roomName: rooms[i].name,
            coverageDegrees: rooms[i].coverageDegrees,
          },
        });
        refined[i] = await toEquirectangularBlob(out.image);
      } catch (error) {
        failure = error instanceof Error ? error.message : "AI refinement failed.";
        break;
      }
    }

    let narrative: AiPreview["narrative"] = null;
    if (!failure) {
      setProgress({ stage: "ai", percent: 94, message: "AI writing your walkthrough copy…" });
      try {
        narrative = await narrateWalkthrough({
          data: {
            fileName: file?.name ?? "capture.mp4",
            coverageDegrees: result.report.coverageDegrees,
            score: result.report.score,
            issues: result.report.issues,
            rooms: result.rooms.map((r) => ({ name: r.name, coverageDegrees: r.coverageDegrees })),
          },
        });
      } catch (error) {
        failure = error instanceof Error ? error.message : "AI copywriting failed.";
      }
    }

    return { refined, narrative, failure };
  };

  const generate = async () => {
    if (!file) return;
    if (!user) {
      toast.error("Sign in to save your tour.");
      navigate({ to: "/auth", search: { mode: "signup" } });
      return;
    }
    setProgress({ stage: "decode", percent: 2, message: "Starting pipeline…" });
    try {
      const result = await processVideo(file, (p: Progress) => setProgress(p));
      const ai = await runAi(result);

      previews.raw.forEach((url) => URL.revokeObjectURL(url));
      previews.ai.forEach((url) => url && URL.revokeObjectURL(url));
      setPreviews({
        raw: result.rooms.map((r) => URL.createObjectURL(r.blob)),
        ai: ai.refined.map((blob) => (blob ? URL.createObjectURL(blob) : null)),
      });

      if (ai.narrative) {
        setTitle((current) => (current.trim() ? current : ai.narrative!.title));
        setDescription((current) => (current.trim() ? current : ai.narrative!.description));
      }
      if (ai.failure) toast.warning(`AI preview unavailable: ${ai.failure}`);
      setUseAi(!ai.failure && ai.refined.some(Boolean));
      setActiveRoom(0);
      setReview({ result, ai });
      setProgress(null);
    } catch (error) {
      setProgress(null);
      toast.error(error instanceof Error ? error.message : "Processing failed.");
    }
  };

  const publish = async () => {
    if (!review || !file || !user) return;
    const { result, ai } = review;
    setProgress({ stage: "publish", percent: 97, message: "Publishing your walkthrough…" });
    try {
      const tour = await saveTour({
        userId: user.id,
        title: title.trim() || ai.narrative?.title || "Untitled Tour",
        description: description.trim(),
        file,
        result: {
          ...result,
          rooms: result.rooms.map((room, index) => ({
            ...room,
            name: ai.narrative?.rooms[index]?.name || room.name,
            blob: useAi && ai.refined[index] ? ai.refined[index]! : room.blob,
          })),
        },
      });
      toast.success("Your virtual tour is ready.");
      navigate({ to: "/tour/$slug", params: { slug: tour.share_slug } });
    } catch (error) {
      setProgress(null);
      toast.error(error instanceof Error ? error.message : "Publishing failed.");
    }
  };

  const currentIndex = progress ? STAGES.findIndex((s) => s.key === progress.stage) : -1;

  const reviewRooms: Room[] = (review?.result.rooms ?? []).map((room, index) => ({
    id: String(index),
    name: review?.ai.narrative?.rooms[index]?.name || room.name,
    panorama_url: "",
    position: index,
    coverage_degrees: room.coverageDegrees,
    frame_count: room.frameCount,
  }));

  const reviewUrls: Record<string, string> = {};
  reviewRooms.forEach((room, index) => {
    const url = useAi ? previews.ai[index] ?? previews.raw[index] : previews.raw[index];
    if (url) reviewUrls[room.id] = url;
  });

  if (loading) {
    return (
      <main className="flex min-h-[60vh] items-center justify-center">

        <Loader2 className="h-5 w-5 animate-spin text-primary" />
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-6xl px-5 py-14">
      <p className="eyebrow">Capture studio</p>
      <h1 className="mt-3 text-4xl sm:text-5xl">Create a new virtual tour</h1>
      <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground">
        Your footage is analysed locally in this browser. Only the finished panoramas are uploaded to
        your account.
      </p>

      {!user && (
        <div className="mt-8 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-primary/40 bg-primary/5 px-5 py-4">
          <p className="text-sm text-muted-foreground">
            You can analyse a video without an account, but saving and sharing needs a free account.
          </p>
          <Button variant="gold" size="sm" asChild>
            <Link to="/auth" search={{ mode: "signup" }}>
              Create account
            </Link>
          </Button>
        </div>
      )}

      {progress ? (
        <section className="mt-10 grid gap-8 lg:grid-cols-[1.1fr_1fr]">
          <div className="glass-panel rounded-2xl p-7">
            <p className="eyebrow">AI processing</p>
            <h2 className="mt-3 text-3xl">{progress.message}</h2>
            <ProgressBar value={progress.percent} className="mt-6" />
            <p className="mt-3 font-mono text-xs text-muted-foreground">
              {Math.round(progress.percent)}% complete · keep this tab open
            </p>
            <ol className="mt-8 space-y-3">
              {STAGES.map((stage, index) => (
                <li key={stage.key} className="flex items-center gap-3 text-sm">
                  {index < currentIndex ? (
                    <CheckCircle2 className="h-4 w-4 text-success" />
                  ) : index === currentIndex ? (
                    <CircleDot className="h-4 w-4 animate-pulse text-primary" />
                  ) : (
                    <Circle className="h-4 w-4 text-muted-foreground/50" />
                  )}
                  <span
                    className={cn(
                      index <= currentIndex ? "text-foreground" : "text-muted-foreground/70",
                    )}
                  >
                    {stage.label}
                  </span>
                </li>
              ))}
            </ol>
          </div>
          <div className="relative overflow-hidden rounded-2xl border border-border bg-surface p-7">
            <div className="pointer-events-none absolute inset-x-0 top-0 h-24 animate-sweep bg-[image:var(--gradient-glass)]" />
            <p className="eyebrow">Live signal</p>
            <div className="mt-6 grid gap-4">
              {["Frame decode", "Yaw estimation", "Panorama blend"].map((label, index) => (
                <div key={label}>
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>{label}</span>
                    <span className="font-mono">
                      {Math.min(100, Math.max(0, Math.round(progress.percent - index * 18)))}%
                    </span>
                  </div>
                  <div className="mt-2 h-1 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full bg-[image:var(--gradient-gold)] transition-[width] duration-500"
                      style={{
                        width: `${Math.min(100, Math.max(0, progress.percent - index * 18))}%`,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      ) : review ? (
        <section className="mt-10 space-y-8">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="eyebrow">AI walkthrough preview</p>
              <h2 className="mt-2 text-3xl">Step inside before you publish</h2>
              <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
                {review.ai.failure
                  ? `Showing your raw stitched panoramas — ${review.ai.failure}`
                  : "AI closed the seams and completed the ceiling and floor bands. Toggle it off to compare with the raw stitch."}
              </p>
            </div>
            <div className="flex items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3">
              <Sparkles className="h-4 w-4 text-primary" />
              <span className="text-sm">AI refined</span>
              <Switch
                checked={useAi}
                disabled={!review.ai.refined.some(Boolean)}
                onCheckedChange={setUseAi}
              />
            </div>
          </div>

          <ClientOnly fallback={<div className="h-[58vh] rounded-2xl border border-border bg-surface" />}>
            {reviewRooms.length > 0 && (
              <PanoramaViewer
                rooms={reviewRooms}
                panoramaUrls={reviewUrls}
                hotspots={[]}
                activeRoomId={String(activeRoom)}
                onRoomChange={(id) => setActiveRoom(Number(id))}
              />
            )}
          </ClientOnly>

          {review.ai.narrative?.rooms.some((room) => room.caption) && (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {review.ai.narrative.rooms.map((room, index) => (
                <div key={`${room.name}-${index}`} className="rounded-xl border border-border bg-surface p-4">
                  <p className="eyebrow">{room.name}</p>
                  <p className="mt-2 text-sm text-muted-foreground">{room.caption}</p>
                </div>
              ))}
            </div>
          )}

          {review.ai.narrative?.tips.length ? (
            <div className="glass-panel rounded-2xl p-6">
              <p className="eyebrow">AI capture coaching</p>
              <ul className="mt-4 space-y-2 text-sm text-muted-foreground">
                {review.ai.narrative.tips.map((tip) => (
                  <li key={tip} className="flex gap-3">
                    <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                    {tip}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="space-y-4 rounded-2xl border border-border bg-surface p-6">
            <div className="space-y-2">
              <Label htmlFor="review-title">Tour title</Label>
              <Input id="review-title" value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="review-description">Description</Label>
              <Textarea
                id="review-description"
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
            <div className="flex flex-wrap gap-3">
              <Button variant="gold" size="lg" onClick={publish}>
                Publish walkthrough
              </Button>
              <Button variant="glass" size="lg" onClick={() => setReview(null)}>
                Start over
              </Button>
            </div>
          </div>
        </section>
      ) : (

        <section className="mt-10 grid gap-8 lg:grid-cols-[1.15fr_1fr]">
          <div>
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                const dropped = e.dataTransfer.files?.[0];
                if (dropped) void accept(dropped);
              }}
              className={cn(
                "rounded-2xl border border-dashed p-10 text-center transition-colors",
                dragOver ? "border-primary bg-primary/5" : "border-border bg-surface",
              )}
            >
              <Film className="mx-auto h-7 w-7 text-primary" />
              <h2 className="mt-4 text-2xl">Drop your room video here</h2>
              <p className="mt-2 text-sm text-muted-foreground">MP4, MOV or WebM · up to a few minutes</p>
              <div className="mt-6 flex flex-wrap justify-center gap-3">
                <Button variant="gold" onClick={() => inputRef.current?.click()}>
                  <Upload className="mr-2 h-4 w-4" /> Select video
                </Button>
                {recording ? (
                  <Button variant="destructive" onClick={stopRecording}>
                    <Square className="mr-2 h-4 w-4" /> Stop recording
                  </Button>
                ) : (
                  <Button variant="glass" onClick={startRecording}>
                    <Video className="mr-2 h-4 w-4" /> {record ? "Start recording" : "Record now"}
                  </Button>
                )}
              </div>
              <input
                ref={inputRef}
                type="file"
                accept="video/mp4,video/quicktime,video/webm,video/*"
                className="hidden"
                onChange={(e) => {
                  const chosen = e.target.files?.[0];
                  if (chosen) void accept(chosen);
                }}
              />
            </div>

            {recording && (
              <div className="mt-6 overflow-hidden rounded-2xl border border-destructive/50">
                <video ref={liveRef} muted playsInline className="w-full" />
              </div>
            )}

            {previewUrl && !recording && (
              <div className="mt-6 overflow-hidden rounded-2xl border border-border">
                <video src={previewUrl} controls playsInline className="w-full" />
              </div>
            )}

            {file && (
              <div className="mt-6 grid gap-4 sm:grid-cols-2">
                <div className="rounded-xl border border-border bg-surface p-4">
                  <p className="eyebrow">File</p>
                  <p className="mt-2 truncate text-sm">{file.name}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {formatBytes(file.size)}
                    {check ? ` · ${check.duration.toFixed(1)}s` : ""}
                  </p>
                </div>
                <div className="rounded-xl border border-border bg-surface p-4">
                  <p className="eyebrow">Quality pre-check</p>
                  {checking ? (
                    <p className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" /> Sampling frames…
                    </p>
                  ) : check?.warnings.length ? (
                    <ul className="mt-2 space-y-1.5 text-xs text-muted-foreground">
                      {check.warnings.map((warning) => (
                        <li key={warning} className="flex gap-2">
                          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
                          {warning}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-2 flex items-center gap-2 text-sm text-success">
                      <CheckCircle2 className="h-4 w-4" /> Looks good to process
                    </p>
                  )}
                </div>
              </div>
            )}

            {file && (
              <div className="mt-6 space-y-4 rounded-2xl border border-border bg-surface p-6">
                <div className="space-y-2">
                  <Label htmlFor="title">Tour title</Label>
                  <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Riverside Apartment" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="description">Description</Label>
                  <Textarea
                    id="description"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Two-bedroom apartment, west-facing, captured at golden hour."
                    rows={3}
                  />
                </div>
                <Button variant="gold" size="lg" className="w-full" onClick={generate} disabled={checking}>
                  Generate virtual tour
                </Button>
              </div>
            )}
          </div>

          <aside className="glass-panel h-fit rounded-2xl p-7">
            <p className="eyebrow">Recording instructions</p>
            <h2 className="mt-3 text-2xl">Capture like a pro</h2>
            <ol className="mt-5 space-y-3 text-sm text-muted-foreground">
              {TIPS.map((tip, index) => (
                <li key={tip} className="flex gap-3">
                  <span className="font-mono text-xs text-primary">{String(index + 1).padStart(2, "0")}</span>
                  {tip}
                </li>
              ))}
            </ol>
            <div className="my-6 hairline" />
            <p className="text-xs leading-relaxed text-muted-foreground">
              RoomVerse composites only the frames you captured. If part of the room was never filmed,
              it stays dark in the panorama rather than being imagined by a model.
            </p>
          </aside>
        </section>
      )}
    </main>
  );
}
