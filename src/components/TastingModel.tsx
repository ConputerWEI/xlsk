import { useEffect, useRef } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import type { Settings } from "../types";
import { modelPlacement, cameraDistance } from "../lib/modelView";
import { createPaperInk } from "../lib/paperInk";

export type HitTest = (x: number, y: number) => boolean;
export type ModelState = { status: "loading" | "ready" | "error"; message?: string };
type Resources = {
  geometries: Set<THREE.BufferGeometry>;
  materials: Set<THREE.Material>;
  textures: Set<THREE.Texture>;
  bitmaps: Set<ImageBitmap>;
};
type Asset = { scene: THREE.Group; used: number; resources: Resources };
type Entry = { promise: Promise<Asset>; controller: AbortController; asset?: Asset; refs: number };
const assets = new Map<string, Entry>();
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const MAX_CACHED = 4;
const bitmapOwners = new WeakMap<ImageBitmap, number>();

function ownAsset(scene: THREE.Group): Asset {
  const resources: Resources = { geometries: new Set(), materials: new Set(), textures: new Set(), bitmaps: new Set() };
  scene.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    resources.geometries.add(object.geometry);
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      resources.materials.add(material);
      Object.values(material).forEach(value => { if (value instanceof THREE.Texture) resources.textures.add(value); });
    }
  });
  const collectBitmaps = (image: unknown) => {
    if (Array.isArray(image)) image.forEach(collectBitmaps);
    else if (typeof ImageBitmap !== "undefined" && image instanceof ImageBitmap) resources.bitmaps.add(image);
  };
  resources.textures.forEach(texture => collectBitmaps(texture.source.data));
  resources.bitmaps.forEach(bitmap => bitmapOwners.set(bitmap, (bitmapOwners.get(bitmap) || 0) + 1));
  return { scene, used: performance.now(), resources };
}

function disposeAsset(asset: Asset) {
  asset.scene.traverse(object => { if (object instanceof THREE.InstancedMesh) object.dispose(); });
  const { geometries, materials, textures, bitmaps } = asset.resources;
  geometries.forEach(item => item.dispose());
  materials.forEach(item => item.dispose());
  textures.forEach(item => item.dispose());
  // Texture.dispose only releases GPU resources. Decoded images belong to the
  // cache, not viewers; close each only after its final cached asset is gone.
  bitmaps.forEach(bitmap => {
    const remaining = (bitmapOwners.get(bitmap) || 1) - 1;
    if (remaining) bitmapOwners.set(bitmap, remaining);
    else { bitmapOwners.delete(bitmap); bitmap.close(); }
  });
}

function trimCache() {
  const unused = [...assets.entries()].filter(([, entry]) => entry.asset && !entry.refs)
    .sort((a, b) => a[1].asset!.used - b[1].asset!.used);
  while (assets.size > MAX_CACHED && unused.length) {
    const [src, entry] = unused.shift()!;
    assets.delete(src);
    disposeAsset(entry.asset!);
  }
}

function acquire(src: string) {
  let entry = assets.get(src);
  if (!entry) {
    const controller = new AbortController();
    const fresh: Entry = { controller, refs: 0, promise: undefined! };
    fresh.promise = fetch(src, { signal: controller.signal })
      .then(response => { if (!response.ok) throw new Error("model request failed"); return response.arrayBuffer(); })
      .then(buffer => loader.parseAsync(buffer, new URL(".", new URL(src, location.href)).href))
      .then(gltf => {
        const asset = ownAsset(gltf.scene);
        try {
          const box = new THREE.Box3().setFromObject(gltf.scene);
          const size = box.getSize(new THREE.Vector3());
          const largest = Math.max(size.x, size.y, size.z);
          if (!Number.isFinite(largest) || largest <= 0) throw new Error("invalid model bounds");
          if (controller.signal.aborted) throw new Error("model cancelled");
        } catch (error) { disposeAsset(asset); throw error; }
        fresh.asset = asset;
        trimCache();
        return asset;
      }).catch(error => { if (assets.get(src) === fresh) assets.delete(src); throw error; });
    assets.set(src, fresh);
    entry = fresh;
  }
  const held = entry;
  held.refs += 1;
  if (held.asset) held.asset.used = performance.now();
  let released = false;
  return {
    promise: held.promise,
    release() {
      if (released) return;
      released = true;
      held.refs -= 1;
      // StrictMode immediately remounts effects. Allow it to reclaim a pending
      // request before cancelling work abandoned by a genuine navigation.
      queueMicrotask(() => {
        if (!held.refs && !held.asset) {
          held.controller.abort();
          if (assets.get(src) === held) assets.delete(src);
        }
      });
      trimCache();
    },
  };
}

type Lease = ReturnType<typeof acquire>;
type Layer = { root: THREE.Group; materials: Map<THREE.Material, THREE.Material>; lease: Lease; radius: number; src: string };
type ViewerOptions = { settings: Pick<Settings, "autoRotate" | "reducedMotion">; onState: (state: ModelState) => void; interactionAt?: React.RefObject<number>; consumed?: boolean; hitTest?: React.RefObject<HitTest | null> };

function makeLayer(asset: Asset, lease: Lease, src: string): Layer {
  const subject = asset.scene.clone(true), materials = new Map<THREE.Material, THREE.Material>();
  subject.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    const local = (source: THREE.Material) => {
      let material = materials.get(source);
      if (!material) {
        material = source.clone();
        if (material instanceof THREE.MeshStandardMaterial) { material.roughness = 1; material.metalness = 0; }
        materials.set(source, material);
      }
      return material;
    };
    object.material = Array.isArray(object.material) ? object.material.map(local) : local(object.material);
  });
  const box = new THREE.Box3().setFromObject(subject);
  const placement = modelPlacement({ min: box.min.toArray(), max: box.max.toArray() }, asset.scene.userData.paperFood?.referenceBounds);
  subject.scale.multiplyScalar(placement.scale);
  subject.position.set(...placement.center.map(value => -value * placement.scale) as [number, number, number]);
  const root = new THREE.Group(); root.add(subject);
    const bakedRadius = asset.scene.userData.paperFood?.referenceRadius;
  const radius = Number.isFinite(bakedRadius) && bakedRadius > 0 ? Math.min(placement.radius, bakedRadius * placement.scale) : placement.radius;
  return { root, materials, lease, radius, src };
}
function disposeLayer(layer: Layer) {
  layer.root.traverse(object => { if (object instanceof THREE.InstancedMesh) object.dispose(); });
  layer.root.removeFromParent();
  layer.materials.forEach(material => material.dispose());
  layer.materials.clear(); layer.lease.release();
}

function createViewer(host: HTMLDivElement, rotation: React.RefObject<number>, pitch: React.RefObject<number>, zoom: React.RefObject<number>, latest: React.RefObject<ViewerOptions>) {
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0, 0); renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.domElement.dataset.engine = "paper-three"; host.appendChild(renderer.domElement);
  const scene = new THREE.Scene(), turntable = new THREE.Group(); scene.add(turntable);
  const camera = new THREE.PerspectiveCamera(35, 1, 0.01, 100);
  scene.add(new THREE.HemisphereLight(0xfff7e8, 0x81735e, 2));
  const key = new THREE.DirectionalLight(0xfff3df, 2.2); key.position.set(-3, 5, 4); scene.add(key);
  const fill = new THREE.DirectionalLight(0xffffff, 0.7); fill.position.set(3, 2, -4); scene.add(fill);
  const ink = createPaperInk();
  let active = true, failed = false, frame = 0, epoch = 0, radius = 1.6, incoming: Layer | undefined;
  let pending: Lease | undefined, shownSrc = "", requestedSrc = "", ready = false;
  let warmTimer = 0, warmLease: Lease | undefined, nextSrc: string | undefined, previousTime = performance.now();
  const raycaster = new THREE.Raycaster(), point = new THREE.Vector2();
  const ownedHit: HitTest = (x, y) => {
    if (!incoming || !ready || failed) return false;
    const rect = renderer.domElement.getBoundingClientRect();
    point.set((x - rect.left) / rect.width * 2 - 1, -(y - rect.top) / rect.height * 2 + 1);
    raycaster.setFromCamera(point, camera);
    return raycaster.intersectObject(incoming.root, true).some(hit => {
      let object: THREE.Object3D | null = hit.object;
      while (object && object !== turntable) { if (!object.visible) return false; object = object.parent; }
      return true;
    });
  };
  if (latest.current.hitTest) latest.current.hitTest.current = ownedHit;
  const fit = () => {
    const distance = cameraDistance(radius, camera.aspect);
    camera.position.set(0, distance * Math.sin(36 * Math.PI / 180), distance * Math.cos(36 * Math.PI / 180));
    camera.lookAt(0, 0, 0); camera.updateProjectionMatrix();
  };
  const resize = () => {
    if (!host.clientWidth || !host.clientHeight) return;
    renderer.setSize(host.clientWidth, host.clientHeight, false);
    camera.aspect = host.clientWidth / host.clientHeight; fit();
  };
  const observer = new ResizeObserver(resize); observer.observe(host); resize();
  const stopWarm = () => { clearTimeout(warmTimer); warmLease?.release(); warmLease = undefined; };
  const warmNext = () => {
    stopWarm();
    if (!nextSrc || nextSrc === shownSrc) return;
    warmTimer = window.setTimeout(() => {
      if (!active || failed || !nextSrc) return;
      const lease = acquire(nextSrc); warmLease = lease;
      lease.promise.then(lease.release, lease.release);
    }, 250);
  };
  const fail = (message: string) => {
    if (!active || failed) return; failed = true; cancelAnimationFrame(frame); stopWarm();
    latest.current.onState({ status: "error", message });
  };
  const lost = (event: Event) => { event.preventDefault(); fail("3D 画面已中断，请重试加载。"); };
  renderer.domElement.addEventListener("webglcontextlost", lost);
  const render = (now: number) => {
    if (!active || failed) return;
    const dt = Math.min(0.05, Math.max(0, (now - previousTime) / 1000)); previousTime = now;
    const options = latest.current;
    if (options.settings.autoRotate && !options.settings.reducedMotion && now - (options.interactionAt?.current ?? 0) > 1800) rotation.current += dt * 0.24;
    turntable.rotation.set(pitch.current, rotation.current, 0, "YXZ");
    camera.zoom = Math.max(0.7, Math.min(1.6, zoom.current)); camera.updateProjectionMatrix();
    host.dataset.rotation = rotation.current.toFixed(4); host.dataset.pitch = pitch.current.toFixed(4); host.dataset.zoom = camera.zoom.toFixed(3);
    if (incoming) {
      incoming.root.traverse(object => { if (object.userData.edible) object.visible = !options.consumed; });
      try { ink.render(renderer, scene, camera, host.clientWidth); }
      catch { fail("3D 画面加载失败，请重试。"); return; }
      host.dataset.stageTransition = "frame-swap";
      if (!ready && !requestedSrc) {
        ready = true;
        latest.current.onState({ status: "ready" }); warmNext();
      }
    }
    frame = requestAnimationFrame(render);
  };
  frame = requestAnimationFrame(render);
  return {
    show(src: string, preloadSrc?: string) {
      nextSrc = preloadSrc;
      if (requestedSrc === src || (shownSrc === src && incoming)) { if (ready) warmNext(); return; }
      const token = ++epoch; requestedSrc = src; ready = false; stopWarm(); pending?.release();
      latest.current.onState({ status: "loading" });
      const lease = acquire(src); pending = lease;
      lease.promise.then(asset => {
        if (!active || token !== epoch) { lease.release(); return; }
        const layer = makeLayer(asset, lease, src); pending = undefined;
        const previous = incoming;
        incoming = layer; turntable.add(layer.root);
        // Swap complete opaque scenes; overlapping transparent vessels expose hidden surfaces.
        if (previous) disposeLayer(previous);
        radius = layer.radius; fit(); shownSrc = src; requestedSrc = "";
        host.dataset.modelSrc = src; host.dataset.paperStyle = String(!!asset.scene.userData.paperFood);
      }).catch(() => { lease.release(); if (active && token === epoch) fail("3D 菜品加载失败，请检查网络后重试。"); });
    },
    dispose() {
      active = false; epoch++; if (latest.current.hitTest?.current === ownedHit) latest.current.hitTest.current = null; cancelAnimationFrame(frame); stopWarm(); pending?.release(); pending = undefined;
      observer.disconnect(); renderer.domElement.removeEventListener("webglcontextlost", lost);
      if (incoming) disposeLayer(incoming);
      ink.dispose(); renderer.dispose(); renderer.domElement.remove();
    },
  };
}

export default function TastingModel({ src, preloadSrc, rotation, pitch, zoom, settings, interactionAt, consumed, hitTest, onState }: {
  src: string; preloadSrc?: string; rotation: React.RefObject<number>; pitch?: React.RefObject<number>; zoom?: React.RefObject<number>;
  settings: Pick<Settings, "autoRotate" | "reducedMotion">; interactionAt?: React.RefObject<number>; consumed?: boolean; hitTest?: React.RefObject<HitTest | null>; onState: (state: ModelState) => void;
}) {
  const container = useRef<HTMLDivElement>(null), fallbackPitch = useRef(0), fallbackZoom = useRef(1);
  const pitchValue = pitch ?? fallbackPitch, zoomValue = zoom ?? fallbackZoom;
  const latest = useRef<ViewerOptions>({ settings, onState, interactionAt, consumed, hitTest }); latest.current = { settings, onState, interactionAt, consumed, hitTest };
  const viewer = useRef<ReturnType<typeof createViewer> | null>(null);
  useEffect(() => {
    const host = container.current; if (!host) return;
    try { const next = createViewer(host, rotation, pitchValue, zoomValue, latest); viewer.current = next;
      return () => { viewer.current = null; next.dispose(); };
    } catch { latest.current.onState({ status: "error", message: "当前浏览器无法开启 3D，请检查图形加速后重试。" }); }
  }, [rotation, pitchValue, zoomValue]);
  useEffect(() => { viewer.current?.show(src, preloadSrc); }, [src, preloadSrc, rotation, pitchValue, zoomValue]);
  return <div ref={container} className="tasting-model" aria-hidden="true" />;
}
