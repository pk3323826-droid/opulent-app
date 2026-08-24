import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import {
  Boxes,
  Compass,
  Glasses,
  Loader2,
  Maximize2,
  MousePointerClick,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import type { Hotspot, Room } from "@/lib/tours";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface Props {
  rooms: Room[];
  panoramaUrls: Record<string, string>;
  /** Optional AI depth maps (grayscale equirectangular) keyed by room id — enables 3D parallax. */
  depthUrls?: Record<string, string | null>;
  hotspots: Hotspot[];
  activeRoomId: string;
  onRoomChange: (id: string) => void;
  editable?: boolean;
  onCreateHotspot?: (position: { yaw: number; pitch: number }) => void;
  onDeleteHotspot?: (id: string) => void;
}

interface Placed {
  hotspot: Hotspot;
  x: number;
  y: number;
  visible: boolean;
}

const DEG = Math.PI / 180;

const PANO_VERTEX = /* glsl */ `
  varying vec2 vUv;
  uniform sampler2D uDepth;
  uniform float uDepthAmount;
  void main() {
    vUv = uv;
    float depth = texture2D(uDepth, uv).r;
    // Bright = near: pull those vertices towards the viewer for real parallax.
    float scale = 1.0 - uDepthAmount * clamp(depth, 0.0, 1.0);
    vec3 displaced = position * scale;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(displaced, 1.0);
  }
`;

const PANO_FRAGMENT = /* glsl */ `
  varying vec2 vUv;
  uniform sampler2D uMap;
  uniform float uHasMap;
  void main() {
    vec3 color = mix(vec3(0.067, 0.075, 0.094), texture2D(uMap, vUv).rgb, uHasMap);
    gl_FragColor = vec4(color, 1.0);
  }
`;


export default function PanoramaViewer({
  rooms,
  panoramaUrls,
  depthUrls,
  hotspots,
  activeRoomId,
  onRoomChange,
  editable = false,
  onCreateHotspot,
  onDeleteHotspot,
}: Props) {
  const mountRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef({
    lon: 0,
    lat: 0,
    fov: 78,
    dragging: false,
    moved: false,
    px: 0,
    py: 0,
    parallaxX: 0,
    parallaxY: 0,
    depth3d: false,
  });
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const materialRef = useRef<THREE.ShaderMaterial | null>(null);

  const [loading, setLoading] = useState(true);
  const [placed, setPlaced] = useState<Placed[]>([]);
  const [openHotspot, setOpenHotspot] = useState<Hotspot | null>(null);
  const [vrSupported, setVrSupported] = useState(false);
  const [heading, setHeading] = useState(0);
  const [placing, setPlacing] = useState(false);
  const [depth3d, setDepth3d] = useState(true);

  const depthUrl = depthUrls?.[activeRoomId] ?? null;
  const roomHotspots = useMemo(
    () => hotspots.filter((h) => h.room_id === activeRoomId),
    [hotspots, activeRoomId],
  );
  const hotspotsRef = useRef(roomHotspots);
  hotspotsRef.current = roomHotspots;

  // Scene setup — runs once.
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(78, mount.clientWidth / mount.clientHeight, 0.1, 1100);
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    renderer.xr.enabled = true;
    mount.appendChild(renderer.domElement);

    // Dense sphere so the AI depth map can actually reshape the room in 3D.
    const geometry = new THREE.SphereGeometry(500, 240, 140);
    geometry.scale(-1, 1, 1);
    const material = new THREE.ShaderMaterial({
      vertexShader: PANO_VERTEX,
      fragmentShader: PANO_FRAGMENT,
      side: THREE.FrontSide,
      uniforms: {
        uMap: { value: null },
        uDepth: { value: new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1) },
        uHasMap: { value: 0 },
        uDepthAmount: { value: 0 },
      },
    });
    (material.uniforms['uDepth']!.value as THREE.DataTexture).needsUpdate = true;
    const mesh = new THREE.Mesh(geometry, material);
    scene.add(mesh);

    rendererRef.current = renderer;
    cameraRef.current = camera;
    materialRef.current = material;

    const rig = new THREE.Group();
    rig.add(camera);
    scene.add(rig);

    const target = new THREE.Vector3();
    const project = new THREE.Vector3();

    renderer.setAnimationLoop(() => {
      const s = stateRef.current;
      if (!renderer.xr.isPresenting) {
        s.lat = Math.max(-85, Math.min(85, s.lat));
        const phi = (90 - s.lat) * DEG;
        const theta = s.lon * DEG;
        target.setFromSphericalCoords(500, phi, theta);
        camera.fov = s.fov;
        camera.updateProjectionMatrix();
        // Off-centre the eye so the depth-displaced geometry produces parallax.
        const amount = s.depth3d ? 26 : 0;
        camera.position.x += (s.parallaxX * amount - camera.position.x) * 0.08;
        camera.position.y += (s.parallaxY * amount - camera.position.y) * 0.08;
        camera.lookAt(target);
      }
      renderer.render(scene, camera);

      // Project hotspot directions to screen space for the DOM overlay
      const next: Placed[] = hotspotsRef.current.map((hotspot) => {
        project.setFromSphericalCoords(400, (90 - hotspot.pitch) * DEG, hotspot.yaw * DEG);
        const v = project.clone().project(camera);
        return {
          hotspot,
          x: (v.x * 0.5 + 0.5) * 100,
          y: (-v.y * 0.5 + 0.5) * 100,
          visible: v.z < 1 && Math.abs(v.x) < 1.05 && Math.abs(v.y) < 1.05,
        };
      });
      setPlaced(next);
      setHeading(((stateRef.current.lon % 360) + 360) % 360);
    });

    const onResize = () => {
      if (!mount) return;
      camera.aspect = mount.clientWidth / mount.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(mount.clientWidth, mount.clientHeight);
    };
    window.addEventListener("resize", onResize);

    navigator.xr?.isSessionSupported?.("immersive-vr").then(setVrSupported).catch(() => setVrSupported(false));

    return () => {
      window.removeEventListener("resize", onResize);
      renderer.setAnimationLoop(null);
      renderer.dispose();
      geometry.dispose();
      material.dispose();
      mount.removeChild(renderer.domElement);
    };
  }, []);

  // Swap the panorama texture whenever the active room changes.
  useEffect(() => {
    const url = panoramaUrls[activeRoomId];
    const material = materialRef.current;
    if (!url || !material) return;
    setLoading(true);
    const loader = new THREE.TextureLoader();
    loader.setCrossOrigin("anonymous");
    loader.load(
      url,
      (texture) => {
        texture.colorSpace = THREE.SRGBColorSpace;
        (material.uniforms['uMap']!.value as THREE.Texture | null)?.dispose();
        material.uniforms['uMap']!.value = texture;
        material.uniforms['uHasMap']!.value = 1;
        stateRef.current.lon = 0;
        stateRef.current.lat = 0;
        setLoading(false);
      },
      undefined,
      () => setLoading(false),
    );
  }, [activeRoomId, panoramaUrls]);

  // Load the AI depth map for this room and drive the 3D displacement.
  useEffect(() => {
    const material = materialRef.current;
    if (!material) return;
    if (!depthUrl) {
      material.uniforms['uDepthAmount']!.value = 0;
      stateRef.current.depth3d = false;
      return;
    }
    const loader = new THREE.TextureLoader();
    loader.setCrossOrigin("anonymous");
    loader.load(depthUrl, (texture) => {
      texture.colorSpace = THREE.NoColorSpace;
      const previous = material.uniforms['uDepth']!.value as THREE.Texture | null;
      previous?.dispose();
      material.uniforms['uDepth']!.value = texture;
      material.uniforms['uDepthAmount']!.value = depth3d ? 0.35 : 0;
      stateRef.current.depth3d = depth3d;
    });
  }, [depthUrl, depth3d]);


  const pointerToAngles = (clientX: number, clientY: number) => {
    const camera = cameraRef.current;
    const mount = mountRef.current;
    if (!camera || !mount) return null;
    const rect = mount.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(ndc, camera);
    const dir = raycaster.ray.direction.clone().normalize();
    const yaw = Math.atan2(dir.x, dir.z) / DEG;
    const pitch = Math.asin(Math.max(-1, Math.min(1, dir.y))) / DEG;
    return { yaw, pitch };
  };

  const handlePointerDown = (event: React.PointerEvent) => {
    const s = stateRef.current;
    s.dragging = true;
    s.moved = false;
    s.px = event.clientX;
    s.py = event.clientY;
    (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
  };

  const handlePointerMove = (event: React.PointerEvent) => {
    const s = stateRef.current;
    const mount = mountRef.current;
    if (mount) {
      const rect = mount.getBoundingClientRect();
      s.parallaxX = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      s.parallaxY = -(((event.clientY - rect.top) / rect.height) * 2 - 1);
    }
    if (!s.dragging) return;
    const dx = event.clientX - s.px;
    const dy = event.clientY - s.py;
    if (Math.abs(dx) + Math.abs(dy) > 4) s.moved = true;
    s.lon -= dx * 0.16;
    s.lat += dy * 0.16;
    s.px = event.clientX;
    s.py = event.clientY;
  };


  const handlePointerUp = (event: React.PointerEvent) => {
    const s = stateRef.current;
    s.dragging = false;
    if (s.moved) return;
    if (placing && onCreateHotspot) {
      const angles = pointerToAngles(event.clientX, event.clientY);
      if (angles) {
        onCreateHotspot({
          yaw: Math.round(angles.yaw * 10) / 10,
          pitch: Math.round(angles.pitch * 10) / 10,
        });
        setPlacing(false);
      }
    }
  };

  const enterVr = async () => {
    const renderer = rendererRef.current;
    if (!renderer || !navigator.xr) return;
    const session = await navigator.xr.requestSession("immersive-vr", {
      optionalFeatures: ["local-floor"],
    });
    await renderer.xr.setSession(session);
  };

  const goFullscreen = () => {
    mountRef.current?.parentElement?.requestFullscreen?.();
  };

  const activeRoom = rooms.find((r) => r.id === activeRoomId);

  return (
    <div className="relative overflow-hidden rounded-2xl border border-border bg-surface shadow-luxe">
      <div
        ref={mountRef}
        className={cn("h-[62vh] min-h-[380px] w-full touch-none", placing ? "cursor-crosshair" : "cursor-grab")}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onWheel={(event) => {
          const s = stateRef.current;
          s.fov = Math.max(32, Math.min(96, s.fov + event.deltaY * 0.04));
        }}
      />

      {loading && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-background/70">
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
            Loading panorama…
          </div>
        </div>
      )}

      {/* Hotspot overlay */}
      {placed.map(
        ({ hotspot, x, y, visible }) =>
          visible && (
            <button
              key={hotspot.id}
              onClick={() => {
                if (hotspot.kind === "navigate" && hotspot.target_room_id) {
                  onRoomChange(hotspot.target_room_id);
                } else {
                  setOpenHotspot(hotspot);
                }
              }}
              style={{ left: `${x}%`, top: `${y}%` }}
              className="absolute -translate-x-1/2 -translate-y-1/2"
              aria-label={hotspot.title}
            >
              <span className="relative flex h-9 w-9 items-center justify-center">
                <span className="absolute inset-0 rounded-full border border-primary/70 animate-pulse-ring" />
                <span className="flex h-9 w-9 items-center justify-center rounded-full border border-primary/60 bg-background/70 backdrop-blur-md">
                  <span className="h-2 w-2 rounded-full bg-primary" />
                </span>
              </span>
              <span className="mt-1 block max-w-[8rem] truncate rounded-full bg-background/70 px-2 py-0.5 text-[10px] tracking-wide text-foreground backdrop-blur-md">
                {hotspot.title}
              </span>
            </button>
          ),
      )}

      {/* Room selector + minimap */}
      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-3 p-4">
        <div className="pointer-events-auto flex max-w-[60%] flex-wrap gap-2">
          {rooms.map((room) => (
            <button
              key={room.id}
              onClick={() => onRoomChange(room.id)}
              className={cn(
                "rounded-full border px-3 py-1.5 text-xs tracking-wide backdrop-blur-md transition-colors",
                room.id === activeRoomId
                  ? "border-primary/60 bg-primary/15 text-primary"
                  : "border-border bg-background/50 text-muted-foreground hover:text-foreground",
              )}
            >
              {room.name}
            </button>
          ))}
        </div>
        <div className="pointer-events-none flex items-center gap-2 rounded-full border border-border bg-background/55 px-3 py-1.5 text-xs text-muted-foreground backdrop-blur-md">
          <Compass className="h-3.5 w-3.5 text-primary" style={{ transform: `rotate(${heading}deg)` }} />
          {Math.round(heading)}°
          {activeRoom?.coverage_degrees ? <span className="hidden sm:inline">· {activeRoom.coverage_degrees}° captured</span> : null}
        </div>
      </div>

      {/* Controls */}
      <div className="absolute inset-x-0 bottom-0 flex flex-wrap items-center justify-between gap-2 p-4">
        <p className="hidden items-center gap-2 text-xs text-muted-foreground sm:flex">
          <MousePointerClick className="h-3.5 w-3.5" /> Drag to look around · scroll to zoom
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {editable && (
            <Button
              size="sm"
              variant={placing ? "gold" : "glass"}
              onClick={() => setPlacing((p) => !p)}
            >
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              {placing ? "Click the view…" : "Add hotspot"}
            </Button>
          )}
          <Button size="sm" variant="glass" onClick={goFullscreen}>
            <Maximize2 className="mr-1.5 h-3.5 w-3.5" /> Fullscreen
          </Button>
          <Button size="sm" variant={vrSupported ? "gold" : "glass"} disabled={!vrSupported} onClick={enterVr}>
            <Glasses className="mr-1.5 h-3.5 w-3.5" />
            {vrSupported ? "Enter VR" : "VR unavailable"}
          </Button>
        </div>
      </div>

      {/* Hotspot detail card */}
      {openHotspot && (
        <div className="absolute bottom-20 left-1/2 w-[min(22rem,90%)] -translate-x-1/2 glass-panel rounded-xl p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="eyebrow">{openHotspot.kind}</p>
              <h3 className="mt-1 text-xl">{openHotspot.title}</h3>
            </div>
            <div className="flex items-center gap-1">
              {editable && onDeleteHotspot && (
                <button
                  className="rounded-md p-1.5 text-muted-foreground transition-colors hover:text-destructive"
                  onClick={() => {
                    onDeleteHotspot(openHotspot.id);
                    setOpenHotspot(null);
                  }}
                  aria-label="Delete hotspot"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
              <button
                className="rounded-md p-1.5 text-muted-foreground transition-colors hover:text-foreground"
                onClick={() => setOpenHotspot(null)}
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
          {openHotspot.description && (
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{openHotspot.description}</p>
          )}
          {openHotspot.link_url && (
            <a
              href={openHotspot.link_url}
              target="_blank"
              rel="noreferrer"
              className="mt-3 inline-block text-sm text-primary underline-offset-4 hover:underline"
            >
              Open link
            </a>
          )}
        </div>
      )}
    </div>
  );
}
