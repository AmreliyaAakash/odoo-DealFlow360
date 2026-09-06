"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";

/**
 * The 3D "deal engine" beside the sign-in card.
 *
 * A slowly turning core with three gyroscope rings. Around it, the five
 * pipeline stages orbit, and a bright pulse (a deal) travels the loop, lighting
 * each stage as it passes. When `ignite` flips to true — the moment Clerk
 * reports a session — every stage lights in sequence and the flow speeds up.
 *
 * Purely decorative: `aria-hidden`, honours `prefers-reduced-motion` (a single
 * still frame), and falls back to a CSS-only ring pair if WebGL is missing.
 */
export function DealEngine({
  ignite = false,
  className,
  fallbackClassName,
}: {
  ignite?: boolean;
  className?: string;
  fallbackClassName?: string;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const igniteRef = useRef<() => void>(() => {});

  useEffect(() => {
    const panel = panelRef.current;
    const canvas = canvasRef.current;
    if (!panel || !canvas) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        canvas,
        antialias: true,
        alpha: true,
        powerPreference: "high-performance",
      });
    } catch {
      if (fallbackClassName) panel.classList.add(fallbackClassName);
      igniteRef.current = () => {};
      return;
    }

    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x000000, 0);

    const TAU = Math.PI * 2;
    const TEAL = 0x33c8e8;
    const VIOLET = 0x8b7cf6;
    const MIST = 0x98a2b3;
    const cTeal = new THREE.Color(TEAL);
    const cDim = new THREE.Color(0x1f6b7c);
    const cWhite = new THREE.Color(0xffffff);
    const cBg = new THREE.Color(0x06080b);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
    // Looking slightly below centre lifts the scene, leaving the bottom of the
    // panel to the headline and chips.
    const LOOK_Y = -0.35;
    camera.position.set(0, 0.3, 11);
    camera.lookAt(0, LOOK_Y, 0);

    const root = new THREE.Group();
    scene.add(root);

    // ---- lights ----
    // Newer three.js uses physically-based point lights (inverse-square decay),
    // so decay is switched off to keep the original look.
    scene.add(new THREE.AmbientLight(0x6b7f99, 0.55));
    const lightA = new THREE.PointLight(TEAL, 1.6, 30, 0);
    lightA.position.set(4, 3, 5);
    scene.add(lightA);
    const lightB = new THREE.PointLight(VIOLET, 1.1, 30, 0);
    lightB.position.set(-5, -2, 3);
    scene.add(lightB);

    // ---- core ----
    const coreSolidMat = new THREE.MeshStandardMaterial({
      color: 0x0b1a20,
      emissive: 0x0b3742,
      emissiveIntensity: 0.9,
      roughness: 0.3,
      metalness: 0.7,
      flatShading: true,
    });
    const coreSolid = new THREE.Mesh(new THREE.IcosahedronGeometry(1.15, 1), coreSolidMat);
    const coreWireMat = new THREE.MeshBasicMaterial({
      color: TEAL,
      wireframe: true,
      transparent: true,
      opacity: 0,
    });
    const coreWire = new THREE.Mesh(new THREE.IcosahedronGeometry(1.42, 1), coreWireMat);
    coreSolid.scale.setScalar(0.6);
    root.add(coreSolid, coreWire);

    // ---- gyroscope rings (each inside its own holder so it can precess) ----
    type Ring = { holder: THREE.Group; mat: THREE.MeshBasicMaterial; target: number };
    function makeRing(radius: number, color: number, opacity: number, rx: number, ry: number, rz: number): Ring {
      const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0 });
      const mesh = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.012, 8, 180), mat);
      mesh.rotation.set(rx, ry, rz);
      const holder = new THREE.Group();
      holder.add(mesh);
      root.add(holder);
      return { holder, mat, target: opacity };
    }
    const rings = [
      makeRing(2.35, TEAL, 0.45, Math.PI / 2, 0, 0),
      makeRing(2.85, VIOLET, 0.35, Math.PI / 3, Math.PI / 5, 0),
      makeRing(3.55, MIST, 0.16, Math.PI / 7, 0, Math.PI / 4),
    ];

    // ---- pipeline orbit ----
    const ORBIT_R = 3.0;
    const orbit = new THREE.Group();
    orbit.rotation.set(0.62, 0, -0.18);
    root.add(orbit);

    const circlePts: THREE.Vector3[] = [];
    for (let i = 0; i <= 128; i++) {
      const a0 = (i / 128) * TAU;
      circlePts.push(new THREE.Vector3(Math.cos(a0) * ORBIT_R, Math.sin(a0) * ORBIT_R, 0));
    }
    const orbitLineMat = new THREE.LineBasicMaterial({ color: TEAL, transparent: true, opacity: 0 });
    const orbitLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints(circlePts), orbitLineMat);
    orbit.add(orbitLine);

    function makeLabel(text: string) {
      const c = document.createElement("canvas");
      c.width = 512;
      c.height = 128;
      const ctx = c.getContext("2d");
      if (ctx) {
        ctx.font = "500 52px Inter, system-ui, -apple-system, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = "rgba(242,244,247,0.92)";
        ctx.fillText(text, 256, 68);
      }
      const tex = new THREE.CanvasTexture(c);
      tex.minFilter = THREE.LinearFilter;
      tex.colorSpace = THREE.SRGBColorSpace;
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
      sprite.scale.set(1.5, 0.375, 1);
      sprite.center.set(0.5, -0.45); // draw the label above its anchor, in screen space
      return sprite;
    }

    type StageNode = {
      group: THREE.Group;
      angle: number;
      dot: THREE.MeshBasicMaterial;
      halo: THREE.MeshBasicMaterial;
      lit: boolean;
    };
    const stages = ["Quote", "Approval", "Margin", "Fulfilment", "Billing"];
    const nodes: StageNode[] = stages.map((name, idx) => {
      const ang = (idx / stages.length) * TAU + Math.PI / 2;
      const g = new THREE.Group();
      g.position.set(Math.cos(ang) * ORBIT_R, Math.sin(ang) * ORBIT_R, 0);
      const dotMat = new THREE.MeshBasicMaterial({ color: idx === 0 ? TEAL : 0x1f6b7c });
      const haloMat = new THREE.MeshBasicMaterial({ color: TEAL, transparent: true, opacity: 0, depthWrite: false });
      const dot = new THREE.Mesh(new THREE.SphereGeometry(0.11, 24, 24), dotMat);
      const halo = new THREE.Mesh(new THREE.SphereGeometry(0.24, 24, 24), haloMat);
      g.add(dot, halo, makeLabel(name));
      g.scale.setScalar(0.001);
      orbit.add(g);
      return { group: g, angle: ang, dot: dotMat, halo: haloMat, lit: idx === 0 };
    });

    // ---- the travelling pulse (a deal moving through the pipeline) ----
    const pulse = new THREE.Mesh(new THREE.SphereGeometry(0.075, 16, 16), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    const pulseGlow = new THREE.Mesh(
      new THREE.SphereGeometry(0.2, 16, 16),
      new THREE.MeshBasicMaterial({ color: TEAL, transparent: true, opacity: 0.35, depthWrite: false }),
    );
    pulse.add(pulseGlow);
    orbit.add(pulse);

    const TRAIL_N = 44;
    const trailPos = new Float32Array(TRAIL_N * 3);
    const trailCol = new Float32Array(TRAIL_N * 3);
    const tmpColor = new THREE.Color();
    for (let k = 0; k < TRAIL_N; k++) {
      tmpColor.copy(cTeal).lerp(cBg, k / (TRAIL_N - 1));
      trailCol[k * 3] = tmpColor.r;
      trailCol[k * 3 + 1] = tmpColor.g;
      trailCol[k * 3 + 2] = tmpColor.b;
    }
    const trailGeo = new THREE.BufferGeometry();
    const trailPosAttr = new THREE.BufferAttribute(trailPos, 3);
    trailGeo.setAttribute("position", trailPosAttr);
    trailGeo.setAttribute("color", new THREE.BufferAttribute(trailCol, 3));
    const trail = new THREE.Line(trailGeo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9 }));
    orbit.add(trail);

    // ---- particle field ----
    const P_N = 700;
    const pPos = new Float32Array(P_N * 3);
    for (let p = 0; p < P_N; p++) {
      const r = 4 + Math.random() * 3.2;
      const th = Math.random() * TAU;
      const ph = Math.acos(2 * Math.random() - 1);
      pPos[p * 3] = r * Math.sin(ph) * Math.cos(th);
      pPos[p * 3 + 1] = r * Math.sin(ph) * Math.sin(th) * 0.7;
      pPos[p * 3 + 2] = r * Math.cos(ph) * 0.75;
    }
    const pGeo = new THREE.BufferGeometry();
    pGeo.setAttribute("position", new THREE.BufferAttribute(pPos, 3));
    const particles = new THREE.Points(
      pGeo,
      new THREE.PointsMaterial({ color: MIST, size: 0.04, transparent: true, opacity: 0.55, sizeAttenuation: true, depthWrite: false }),
    );
    scene.add(particles);

    // ---- sizing ----
    function render() {
      renderer.render(scene, camera);
    }
    function resize() {
      const w = panel!.clientWidth;
      const h = panel!.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      // Back the camera off until the orbit (radius 3, plus labels) fits the
      // shorter side, so a short laptop viewport does not clip the ring.
      camera.position.z = Math.min(13, Math.max(11, 11 / camera.aspect));
      camera.updateProjectionMatrix();
      if (reduced) render();
    }
    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(resize);
      observer.observe(panel);
    } else {
      window.addEventListener("resize", resize);
    }
    resize();

    // ---- pointer parallax ----
    const target = { x: 0, y: 0 };
    const cur = { x: 0, y: 0 };
    const onMove = (e: PointerEvent) => {
      const rect = panel.getBoundingClientRect();
      target.x = ((e.clientX - rect.left) / rect.width - 0.5) * 2;
      target.y = ((e.clientY - rect.top) / rect.height - 0.5) * 2;
    };
    const onLeave = () => {
      target.x = 0;
      target.y = 0;
    };
    panel.addEventListener("pointermove", onMove);
    panel.addEventListener("pointerleave", onLeave);

    // ---- tiny tween helper ----
    type Tween = { t0: number; dur: number; fn: (p: number) => void; ease: (x: number) => number };
    const tweens: Tween[] = [];
    const easeOut = (x: number) => 1 - Math.pow(1 - x, 3);
    const easeOutBack = (x: number) => {
      const c1 = 1.70158;
      const c3 = c1 + 1;
      return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
    };
    function tween(dur: number, fn: (p: number) => void, delay = 0, ease = easeOut) {
      tweens.push({ t0: performance.now() + delay, dur, fn, ease });
    }
    function runTweens(now: number) {
      for (let t = tweens.length - 1; t >= 0; t--) {
        const tw = tweens[t];
        if (now < tw.t0) continue;
        const prog = Math.min(1, (now - tw.t0) / tw.dur);
        tw.fn(tw.ease(prog));
        if (prog >= 1) tweens.splice(t, 1);
      }
    }
    function angDist(a: number, b: number) {
      let d = (a - b) % TAU;
      if (d > Math.PI) d -= TAU;
      if (d < -Math.PI) d += TAU;
      return Math.abs(d);
    }

    // ---- animation state ----
    const clock = new THREE.Clock();
    let speed = 1;
    let speedTarget = 1;
    let pulseAngle = Math.PI / 2;
    let raf = 0;
    let disposed = false;

    function frame() {
      if (disposed) return;
      const dt = Math.min(clock.getDelta(), 0.05);
      const now = performance.now();
      runTweens(now);

      speed += (speedTarget - speed) * 0.04;
      cur.x += (target.x - cur.x) * 0.05;
      cur.y += (target.y - cur.y) * 0.05;

      root.rotation.y += dt * 0.12 * speed;
      root.rotation.x = cur.y * 0.16;
      root.rotation.z = cur.x * -0.06;
      camera.position.x = cur.x * 0.6;
      camera.lookAt(0, LOOK_Y, 0);

      coreWire.rotation.x -= dt * 0.18 * speed;
      coreWire.rotation.y += dt * 0.25 * speed;
      coreSolid.rotation.y -= dt * 0.1 * speed;

      rings[0].holder.rotation.y += dt * 0.1 * speed;
      rings[1].holder.rotation.x += dt * 0.07 * speed;
      rings[2].holder.rotation.z -= dt * 0.05 * speed;

      orbit.rotation.z += dt * 0.09 * speed;
      pulseAngle += dt * 0.55 * speed;
      pulse.position.set(Math.cos(pulseAngle) * ORBIT_R, Math.sin(pulseAngle) * ORBIT_R, 0);
      for (let k = 0; k < TRAIL_N; k++) {
        const a = pulseAngle - k * 0.022;
        trailPos[k * 3] = Math.cos(a) * ORBIT_R;
        trailPos[k * 3 + 1] = Math.sin(a) * ORBIT_R;
        trailPos[k * 3 + 2] = 0;
      }
      trailPosAttr.needsUpdate = true;

      particles.rotation.y += dt * 0.02 * speed;

      // light each stage as the pulse passes it
      for (const nd of nodes) {
        const near = Math.max(0, 1 - angDist(pulseAngle, nd.angle) / 0.35);
        nd.halo.opacity = (nd.lit ? 0.2 : 0) + near * 0.4;
        nd.dot.color.copy(nd.lit ? cTeal : cDim).lerp(cWhite, near * 0.75);
      }

      render();
      if (!reduced) raf = requestAnimationFrame(frame);
    }

    // ---- page-load assembly: the one orchestrated moment ----
    function assemble() {
      tween(1000, (p) => {
        coreWireMat.opacity = 0.32 * p;
      });
      tween(1100, (p) => {
        coreSolid.scale.setScalar(0.6 + 0.4 * p);
      });
      rings.forEach((rg, idx) => {
        tween(
          900,
          (p) => {
            rg.mat.opacity = rg.target * p;
          },
          200 + idx * 150,
        );
      });
      tween(
        900,
        (p) => {
          orbitLineMat.opacity = 0.28 * p;
        },
        400,
      );
      nodes.forEach((nd, idx) => {
        tween(
          700,
          (p) => {
            nd.group.scale.setScalar(0.001 + 0.999 * p);
          },
          500 + idx * 120,
          easeOutBack,
        );
      });
    }

    function setFinalState() {
      coreWireMat.opacity = 0.32;
      coreSolid.scale.setScalar(1);
      rings.forEach((rg) => {
        rg.mat.opacity = rg.target;
      });
      orbitLineMat.opacity = 0.28;
      nodes.forEach((nd) => {
        nd.group.scale.setScalar(1);
      });
    }

    let ignited = false;
    let igniteTimer: ReturnType<typeof setTimeout> | undefined;
    igniteRef.current = () => {
      if (ignited) return;
      ignited = true;
      nodes.forEach((nd, idx) => {
        tween(
          520,
          (p) => {
            nd.lit = true;
            nd.group.scale.setScalar(1 + Math.sin(p * Math.PI) * 0.45);
          },
          idx * 240,
        );
      });
      tween(1200, (p) => {
        coreSolidMat.emissiveIntensity = 0.9 + p * 1.4;
      });
      tween(900, (p) => {
        coreWireMat.opacity = 0.32 + p * 0.38;
      });
      if (reduced) {
        nodes.forEach((nd) => {
          nd.lit = true;
          nd.group.scale.setScalar(1);
        });
        frame();
        return;
      }
      speedTarget = 2.6;
      igniteTimer = setTimeout(() => {
        speedTarget = 1.15;
      }, 2600);
    };

    function start() {
      if (disposed) return;
      if (reduced) {
        setFinalState();
        frame();
      } else {
        assemble();
        raf = requestAnimationFrame(frame);
      }
    }
    // wait for Inter so the 3D labels are drawn in the right typeface
    if (document.fonts?.ready) document.fonts.ready.then(start, start);
    else start();

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      if (igniteTimer) clearTimeout(igniteTimer);
      observer?.disconnect();
      window.removeEventListener("resize", resize);
      panel.removeEventListener("pointermove", onMove);
      panel.removeEventListener("pointerleave", onLeave);
      igniteRef.current = () => {};
      scene.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        mesh.geometry?.dispose?.();
        const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
        else mat?.dispose?.();
      });
      renderer.dispose();
    };
  }, [fallbackClassName]);

  useEffect(() => {
    if (ignite) igniteRef.current();
  }, [ignite]);

  return (
    <div ref={panelRef} className={className} aria-hidden="true">
      <canvas ref={canvasRef} />
    </div>
  );
}
