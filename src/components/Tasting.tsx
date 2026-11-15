import { useEffect, useRef, useState } from "react";
import type { Dish, Settings } from "../types";
import { playBiteAudio, primeBiteAudio, stopBiteAudio } from "../lib/sound";
import { modelForBites } from "../lib/tastingModel";
import ModelSurface from "./ModelSurface";

const lotusPetals = [
  "M30 35C16 36 7 27 6 15c12 1 22 8 24 20Z",
  "M31 35C21 27 22 14 31 5c9 10 10 23 0 30Z",
  "M32 35c14 1 23-8 24-20-12 1-22 8-24 20Z",
];

type Crumb = { x: number; y: number; vx: number; vy: number; size: number; tilt: number; born: number; color: string };

function useFoodCrumbs(dishId: string, reducedMotion: boolean) {
  const canvas = useRef<HTMLCanvasElement>(null), particles = useRef<Crumb[]>([]), frame = useRef(0);
  function clear() {
    cancelAnimationFrame(frame.current); frame.current = 0; particles.current = [];
    const target = canvas.current;
    if (target) { target.getContext("2d")?.clearRect(0, 0, target.width, target.height); target.dataset.live = "0"; }
  }
  useEffect(() => { clear(); return clear; }, [dishId, reducedMotion]);
  function emit(point?: { x: number; y: number }, finishing = false) {
    const target = canvas.current;
    if (!target || reducedMotion) return;
    const rect = target.getBoundingClientRect(), ratio = Math.min(devicePixelRatio || 1, 2);
    if (!rect.width || !rect.height) return;
    target.width = Math.round(rect.width * ratio); target.height = Math.round(rect.height * ratio);
    const ctx = target.getContext("2d"); if (!ctx) return;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    const colors = dishId === "mango-rice" ? ["#ead7a9", "#f4b434", "#fcf0cd"]
      : dishId === "satay" ? ["#c58d3d", "#8a5431", "#d9b574"]
      : dishId === "pad-thai" ? ["#c48d49", "#dfc088", "#9d793b"] : ["#d9853e", "#d7954c", "#b76a30"];
    const now = performance.now(), count = dishId === "tom-yum" ? 3 : finishing ? 7 : 5;
    const origin = point ? { x: point.x - rect.left, y: point.y - rect.top } : { x: rect.width * 0.5, y: rect.height * 0.48 };
    particles.current = particles.current.filter(p => now - p.born < 460).slice(-(32 - count));
    for (let i = 0; i < count; i++) particles.current.push({ x: origin.x, y: origin.y, vx: (Math.random() - 0.5) * 105, vy: -30 - Math.random() * 55, size: 1.1 + Math.random() * 1.1, tilt: Math.random() * Math.PI, born: now, color: colors[i % colors.length] });
    cancelAnimationFrame(frame.current);
    function draw(time: number) {
      if (!target || !ctx) return;
      ctx.clearRect(0, 0, rect.width, rect.height);
      particles.current = particles.current.filter(p => time - p.born < 460);
      for (const p of particles.current) {
        const age = Math.max(0, (time - p.born) / 1000), x = p.x + p.vx * age, y = p.y + p.vy * age + 145 * age * age;
        ctx.globalAlpha = Math.max(0, 1 - age / 0.46) * 0.9; ctx.fillStyle = p.color;
        ctx.beginPath(); ctx.ellipse(x, y, p.size * (dishId === "mango-rice" ? 1.65 : 1.2), p.size * 0.65, p.tilt + age, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 1; target.dataset.live = String(particles.current.length);
      frame.current = particles.current.length ? requestAnimationFrame(draw) : 0;
    }
    frame.current = requestAnimationFrame(draw);
  }
  return { canvas, emit };
}

export default function Tasting({ dish, settings, onExit, onSoundChange }: { dish: Dish; settings: Settings; onExit: () => void; onSoundChange: (enabled: boolean) => void }) {
  const crumbs = useFoodCrumbs(dish.id, settings.reducedMotion);
  useEffect(() => {
    if (settings.sound) primeBiteAudio(dish.id);
    const visibility = () => { if (document.hidden) stopBiteAudio(); };
    document.addEventListener("visibilitychange", visibility);
    return () => { stopBiteAudio(); document.removeEventListener("visibilitychange", visibility); };
  }, [dish.id, settings.sound]);
  const rotation = useRef(0);
  const pitch = useRef(0);
  const interactionAt = useRef(performance.now());
  const hitTest = useRef<((x: number, y: number) => boolean) | null>(null);
  const pointer = useRef<{ id: number; x: number; y: number; lastX: number; lastY: number; dragged: boolean } | null>(null);
  const [bites, setBites] = useState(0);
  const [readyModel, setReadyModel] = useState<string | null>(null);
  const modelSrc = dish.tastingModels ? modelForBites(dish.tastingModels, bites) : null;
  const nextSrc = dish.tastingModels?.[Math.floor(bites / 3) + 1];
  const ready = !!modelSrc && readyModel === modelSrc;

  function biteAt(point?: { x: number; y: number }) {
    if (!ready || bites >= 12) return;
    const next = bites + 1;
    setBites(next);
    playBiteAudio(settings.sound, dish.id, next);
    crumbs.emit(point, next % 3 === 0);
  }

  return <main className="tasting-page page-shell" data-screen="tasting" data-dish={dish.id}>
    <header className="simple-header"><button className="text-button" type="button" onClick={onExit}>← 返回</button>
      <button className="text-button tasting-sound" type="button" aria-label={settings.sound ? "关闭试吃声音" : "开启试吃声音"} aria-pressed={settings.sound} onClick={() => { stopBiteAudio(); onSoundChange(!settings.sound); }}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4Z" />{settings.sound ? <path d="M17 8c2 2 2 6 0 8m3-11c4 4 4 10 0 14" /> : <path d="m17 9 5 6m0-6-5 6" />}</svg>
      </button>
    </header>
    <section className="tasting-layout">
      <div className="tasting-copy"><h1>{dish.name}</h1>
        <div className="tasting-progress" role="progressbar" aria-label="试吃进度" aria-valuemin={0} aria-valuemax={12} aria-valuenow={bites} aria-valuetext={`${bites} / 12 口${bites === 12 ? "，试吃完成" : ""}`}>
          <div className="lotus-progress" aria-hidden="true">{[0, 1, 2, 3].map(group => <svg className="progress-lotus" viewBox="0 0 62 42" key={group}>{lotusPetals.map((shape, petal) => <path key={petal} className="lotus-petal" data-filled={group * 3 + petal < bites} d={shape} />)}</svg>)}</div>
          <span className="tasting-count" aria-hidden="true">{bites} / 12 口</span>
        </div>
      </div>
      <div className="tasting-paper"><div className="tasting-canvas-wrap">
        {modelSrc ? <ModelSurface src={modelSrc} preloadSrc={nextSrc} rotation={rotation} pitch={pitch} interactionAt={interactionAt} consumed={bites === 12} hitTest={hitTest} settings={settings} onState={state => setReadyModel(state.status === "ready" ? modelSrc : null)} /> : <p className="model-feedback" role="status">该菜品的 3D 试吃正在准备中</p>}
        <div className="tasting-interaction" role="button" tabIndex={0} aria-label={`咬一口${dish.name}，已吃${bites}口`} aria-disabled={!ready || bites >= 12}
          data-bites={bites} data-ready={ready}
          onPointerDown={event => {
            if (!ready || pointer.current || !event.isPrimary || event.button !== 0) return;
            pointer.current = { id: event.pointerId, x: event.clientX, y: event.clientY, lastX: event.clientX, lastY: event.clientY, dragged: false };
            event.currentTarget.setPointerCapture(event.pointerId);
            interactionAt.current = performance.now();
          }}
          onPointerMove={event => {
            const drag = pointer.current;
            if (!drag || drag.id !== event.pointerId) return;
            if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) > 5) drag.dragged = true;
            if (drag.dragged) {
              rotation.current += (event.clientX - drag.lastX) * 0.012;
              pitch.current += (event.clientY - drag.lastY) * 0.012;
            }
            drag.lastX = event.clientX; drag.lastY = event.clientY; interactionAt.current = performance.now();
          }}
          onPointerUp={event => {
            const drag = pointer.current;
            if (!drag || drag.id !== event.pointerId) return;
            pointer.current = null;
            if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
            if (drag.dragged) return;
            if (hitTest.current?.(event.clientX, event.clientY)) biteAt({ x: event.clientX, y: event.clientY });
          }}
          onPointerCancel={() => { pointer.current = null; }} onLostPointerCapture={() => { pointer.current = null; }}
          onKeyDown={event => {
            if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
              event.preventDefault(); interactionAt.current = performance.now();
              if (event.key === "ArrowLeft") rotation.current -= 0.18;
              if (event.key === "ArrowRight") rotation.current += 0.18;
              if (event.key === "ArrowUp") pitch.current -= 0.18;
              if (event.key === "ArrowDown") pitch.current += 0.18;
            } else if (event.key === "Enter" || event.key === " ") { event.preventDefault(); if (!event.repeat) { interactionAt.current = performance.now(); biteAt(); } }
          }} />
      <canvas ref={crumbs.canvas} className="bite-crumbs" data-live="0" aria-hidden="true" />
      </div></div>
    </section>
  </main>;
}
