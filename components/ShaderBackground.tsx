"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";

export default function BWDitheredGradient({
  lowRes = 480,
  targetFps = 60,
  motionAmp = 1.5,
  motionSpeed = 1.0,
  noiseStrength = 1.5, // ↓ slightly reduced for smoother pattern
  gradientTop = 0.018,
  gradientBottom = 0.55,
}) {
  const mountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const parent = mountRef.current!;
    parent.innerHTML = "";

    const screenW = window.innerWidth;
    const screenH = window.innerHeight;

    const renderer = new THREE.WebGLRenderer({ antialias: false });
    renderer.setSize(screenW, screenH);
    renderer.setPixelRatio(window.devicePixelRatio);
    parent.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    const geometry = new THREE.PlaneGeometry(2, 2);

    const colorTop = new THREE.Color(0x151515);
    const colorBottom = new THREE.Color(0xffffff);

    const material = new THREE.ShaderMaterial({
      uniforms: {
        u_resolution: { value: new THREE.Vector2(screenW, screenH) },
        u_time: { value: 0 },

        u_colorTop: { value: colorTop },
        u_colorBottom: { value: colorBottom },

        u_motionAmp: { value: motionAmp },
        u_motionSpeed: { value: motionSpeed },
        u_noiseStrength: { value: noiseStrength },

        u_top: { value: gradientTop },
        u_bottom: { value: gradientBottom },
      },

      // ---------------------------
      // VERTEX SHADER
      // ---------------------------
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = vec4(position, 1.0);
        }
      `,

      // ---------------------------
      // FRAGMENT SHADER
      // (Improved smoothness)
      // ---------------------------
      fragmentShader: `
        precision highp float;

        uniform vec2 u_resolution;
        uniform float u_time;

        uniform vec3 u_colorTop;
        uniform vec3 u_colorBottom;

        uniform float u_motionAmp;
        uniform float u_motionSpeed;
        uniform float u_noiseStrength;

        uniform float u_top;
        uniform float u_bottom;

        varying vec2 vUv;

        // -----------------------------
        // HASH & BASIC NOISE
        // -----------------------------
        float hash(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
        }

        float noise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);

          float a = hash(i);
          float b = hash(i + vec2(1.0, 0.0));
          float c = hash(i + vec2(0.0, 1.0));
          float d = hash(i + vec2(1.0, 1.0));

          vec2 u = f * f * (3.0 - 2.0 * f);

          return mix(a, b, u.x) +
                 (c - a) * u.y * (1.0 - u.x) +
                 (d - b) * u.x * u.y;
        }

        void main() {

          // --------------------------------------
          // Normalize to 0–1 screen UV
          // --------------------------------------
          vec2 uv = gl_FragCoord.xy / u_resolution.xy;

          // -----------------------------------------------------
          // IMPROVED NOISE (lower freq = smoother)
          // -----------------------------------------------------
          float n1 = noise(uv * 15.0 + u_time * 0.4);   // ↓ reduced from 50
          float n2 = noise(uv * 35.0 + u_time * 0.25);  // ↓ reduced from 90

          float combinedNoise =
              (n1 - 0.5) * 0.55 +
              (n2 - 0.5) * 0.45;

          // -----------------------------------------------------
          // VERTICAL GRADIENT  (smooth before dither)
          // -----------------------------------------------------
          float g = (uv.y - u_top) / (u_bottom - u_top);

          // subtle movement
          g += combinedNoise * (u_noiseStrength * 0.6);

          // soften gradient to avoid hard dither edges
          g = smoothstep(0.0, 1.0, g);

          g = clamp(g, 0.0, 1.0);

          // final black → white mapping
          vec3 col = mix(u_colorTop, u_colorBottom, g);

          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });

    const mesh = new THREE.Mesh(geometry, material);
    scene.add(mesh);

    // ---------------------------------------------
    // LOW RES DITHER TARGET (unchanged)
    // ---------------------------------------------
    const tw = Math.round((screenW / screenH) * lowRes);
    const th = lowRes;

    const target = new THREE.WebGLRenderTarget(tw, th, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      format: THREE.RGBAFormat,
    });

    const outCanvas = document.createElement("canvas");
    const outCtx = outCanvas.getContext("2d")!;
    outCanvas.width = tw;
    outCanvas.height = th;

    outCanvas.style.width = "100%";
    outCanvas.style.height = "100%";
    outCanvas.style.position = "fixed";
    outCanvas.style.top = "0";
    outCanvas.style.left = "0";

    parent.appendChild(outCanvas);

    const pixelBuf = new Uint8Array(tw * th * 4);

    // ----------------------------
    // DITHER (unchanged)
    // ----------------------------
    function dither(buf: Uint8Array, w: number, h: number) {
      const r = new Float32Array(w * h);
      const g = new Float32Array(w * h);
      const b = new Float32Array(w * h);

      for (let i = 0; i < w * h; i++) {
        r[i] = buf[i * 4 + 0];
        g[i] = buf[i * 4 + 1];
        b[i] = buf[i * 4 + 2];
      }

      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = y * w + x;

          const nr = r[i] < 128 ? 0 : 255;
          const ng = g[i] < 128 ? 0 : 255;
          const nb = b[i] < 128 ? 0 : 255;

          const er = r[i] - nr;
          const eg = g[i] - ng;
          const eb = b[i] - nb;

          r[i] = nr; g[i] = ng; b[i] = nb;

          const spread = (dx: number, dy: number, factor: number) => {
            const nx = x + dx;
            const ny = y + dy;
            if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
              const ni = ny * w + nx;
              r[ni] += er * factor;
              g[ni] += eg * factor;
              b[ni] += eb * factor;
            }
          };

          spread(1, 0, 7 / 16);
          spread(-1, 1, 3 / 16);
          spread(0, 1, 5 / 16);
          spread(1, 1, 1 / 16);
        }
      }

      for (let i = 0; i < w * h; i++) {
        buf[i * 4 + 0] = r[i];
        buf[i * 4 + 1] = g[i];
        buf[i * 4 + 2] = b[i];
        buf[i * 4 + 3] = 255;
      }
    }

    // ---------------------------
    // MAIN LOOP
    // ---------------------------
    let rafId = 0;
    let lastFrame = 0;
    const frameInterval = 1000 / targetFps;

    const loop = (t: number) => {
      material.uniforms.u_time.value = t * 0.001;

      renderer.setRenderTarget(target);
      renderer.render(scene, camera);

      if (t - lastFrame >= frameInterval) {
        lastFrame = t;

        renderer.readRenderTargetPixels(target, 0, 0, tw, th, pixelBuf);
        dither(pixelBuf, tw, th);

        const imgData = new ImageData(new Uint8ClampedArray(pixelBuf), tw, th);
        outCtx.putImageData(imgData, 0, 0);
      }

      rafId = requestAnimationFrame(loop);
    };

    rafId = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(rafId);
      renderer.dispose();
      target.dispose();
      parent.innerHTML = "";
    };
  }, [
    lowRes,
    targetFps,
    motionAmp,
    motionSpeed,
    noiseStrength,
    gradientTop,
    gradientBottom,
  ]);

  return <div ref={mountRef} className="fixed inset-0 -z-50" />;
}

