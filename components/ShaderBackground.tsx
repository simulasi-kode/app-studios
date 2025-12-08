"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";

/*
  Replacement ShaderBackground:
  - Renders your procedural shader into a low-res WebGLRenderTarget
  - Reads pixels (Uint8Array) from the renderTarget
  - Applies Floyd–Steinberg error diffusion per-channel (configurable quantization)
  - Writes the processed pixels into an offscreen 2D canvas and upscales that canvas to fill the screen
  - Uses CSS image-rendering: pixelated to keep blocky pixels

  Notes:
  - readRenderTargetPixels is synchronous and can be expensive; keep the low-res target small (e.g. 160-480 px tall depending on desired block size).
  - Throttle or skip frames if you need to reduce CPU usage.
*/

export default function ShaderBackground() {
  const mountRef = useRef<HTMLDivElement>(null);
  const outCanvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (!mountRef.current) return;

    const width = window.innerWidth;
    const height = window.innerHeight;

    // -----------------------------
    // Scene + Camera
    // -----------------------------
    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    // -----------------------------
    // Renderer
    // -----------------------------
    const renderer = new THREE.WebGLRenderer({ antialias: false });
    renderer.setSize(width, height);
    renderer.setPixelRatio(window.devicePixelRatio);
    // Keep the three canvas hidden: we'll copy processed pixels to a 2D canvas
    renderer.domElement.style.display = "none";
    mountRef.current.appendChild(renderer.domElement);

    // -----------------------------
    // Output canvas that will be visible and pixelated
    // -----------------------------
    const outCanvas = document.createElement("canvas");
    outCanvas.style.position = "fixed";
    outCanvas.style.inset = "0";
    outCanvas.style.width = "100%";
    outCanvas.style.height = "100%";
    outCanvas.style.pointerEvents = "none";
    // pixelated scaling for crisp blocks
    (outCanvas.style as any).imageRendering = "pixelated";
    outCanvasRef.current = outCanvas;
    mountRef.current.appendChild(outCanvas);

    // -----------------------------
    // Detect Dark Mode
    // -----------------------------
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const isDark = media.matches;

    // -----------------------------
    // Fullscreen Quad geometry
    // -----------------------------
    const geometry = new THREE.PlaneGeometry(2, 2);

    // -----------------------------
    // Shader Material (same logic as your shader, with uniforms)
    // -----------------------------
    const material = new THREE.ShaderMaterial({
      uniforms: {
        u_resolution: { value: new THREE.Vector2(width, height) },
        u_time: { value: 0.0 },

        u_dotsize: { value: 2.5 },

        u_colorTop: {
          value: isDark ? new THREE.Color("#000000") : new THREE.Color("#ffffff"),
        },
        u_colorBottom: {
          value: isDark ? new THREE.Color("#ffffff") : new THREE.Color("#1b1b1b"),
        },

        u_invert: { value: isDark ? 0.0 : 1.0 },

        u_noiseStrength: { value: 0.20 },
        u_motionStrength: { value: 0.15 },
        u_grainStrength: { value: 0.05 },

        u_speed_scan: { value: 0.5 },
        u_speed_wobble: { value: 0.1 },
        u_speed_tear: { value: 0.25 },
        u_speed_noise: { value: 0.3 },
        u_speed_snow: { value: 0.4 },
        u_speed_flicker: { value: 1.0 },
      },

      vertexShader: `
        void main() {
          gl_Position = vec4(position, 1.0);
        }
      `,

      fragmentShader: `
        precision highp float;

        uniform vec2 u_resolution;
        uniform float u_time;
        uniform float u_dotsize;

        uniform vec3 u_colorTop;
        uniform vec3 u_colorBottom;
        uniform float u_invert;

        uniform float u_noiseStrength;
        uniform float u_motionStrength;
        uniform float u_grainStrength;

        uniform float u_speed_scan;
        uniform float u_speed_wobble;
        uniform float u_speed_tear;
        uniform float u_speed_noise;
        uniform float u_speed_snow;
        uniform float u_speed_flicker;

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
          return mix(a, b, u.x)
               + (c - a) * u.y * (1.0 - u.x)
               + (d - b) * u.x * u.y;
        }

        float bayer(vec2 uv) {
          int x = int(mod(uv.x, 4.0));
          int y = int(mod(uv.y, 4.0));
          int idx = y * 4 + x;

          float m[16];
          m[0]=0.0; m[1]=8.0; m[2]=2.0; m[3]=10.0;
          m[4]=12.0; m[5]=4.0; m[6]=14.0; m[7]=6.0;
          m[8]=3.0; m[9]=11.0; m[10]=1.0; m[11]=9.0;
          m[12]=15.0; m[13]=7.0; m[14]=13.0; m[15]=5.0;

          return m[idx] / 16.0;
        }

        void main() {
          vec2 uv = gl_FragCoord.xy / u_resolution.xy;

          float scan = sin(uv.y * 200.0 + u_time * u_speed_scan) * 0.0001;
          uv.x += scan;

          float wobble = sin(uv.y * 30.0 + u_time * u_speed_wobble) * 0.001;
          uv.x += wobble;

          float tearTrigger = step(0.98, fract(u_time * u_speed_tear));
          uv.y = mod(uv.y + tearTrigger * 0.08, 1.0);

          float g = uv.y;

          float organic = noise(uv * 3.0 + u_time * u_speed_noise);
          float n = (organic - 0.5) * u_noiseStrength;

          float snow = hash(gl_FragCoord.xy * (u_time * u_speed_snow)) * 0.4;

          float grain = hash(gl_FragCoord.xy * u_time) * u_grainStrength;

          float flick = sin(u_time * u_speed_flicker) * 0.10;

          float shade = g + n * u_motionStrength + grain + snow + flick;

          float threshold = bayer(gl_FragCoord.xy / u_dotsize);
          float bw = shade > threshold ? 0.0 : 1.0;

          if (u_invert > 0.5) bw = 1.0 - bw;

          vec3 finalColor = mix(u_colorTop, u_colorBottom, bw);

          gl_FragColor = vec4(finalColor, 1.0);
        }
      `,
    });

    const mesh = new THREE.Mesh(geometry, material);
    scene.add(mesh);

    // -----------------------------
    // Low-res render target settings for CPU error-diffusion
    // -----------------------------
    // Use dotsize to compute low-res size; bigger dotsize -> smaller renderTarget -> bigger blocks
    function makeTargetSize(w: number, h: number, dotsize: number) {
      // choose a scale factor; you can tweak this formula to taste
      const scale = Math.max(1, Math.floor(dotsize)); // user-facing dotsize
      const tw = Math.max(2, Math.floor(w / scale));
      const th = Math.max(2, Math.floor(h / scale));
      return { tw, th };
    }

    let { tw: targetW, th: targetH } = makeTargetSize(width, height, material.uniforms.u_dotsize.value);

    const target = new THREE.WebGLRenderTarget(targetW, targetH, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
      depthBuffer: false,
      stencilBuffer: false,
    });

    // 2D canvas to draw processed pixels (low-res) and it will be CSS-scaled
    const outCtx = outCanvas.getContext("2d", { alpha: false })!;
    outCanvas.width = targetW;
    outCanvas.height = targetH;

    // CSS scaling is handled by setting the canvas CSS width/height to screen size already above

    // processing buffers
    const pixelBuf = new Uint8Array(targetW * targetH * 4);

    // quantization settings: for an 8-bit "3-3-2" palette you can use:
    const levelsR = 8; // 3 bits
    const levelsG = 8; // 3 bits
    const levelsB = 4; // 2 bits

    // To reduce CPU load we can process less often (throttle). Set to 1 for every frame.
    const framesBetweenProcess = 1;
    let frameCounter = 0;

    // Floyd–Steinberg (per-channel) on a float buffer
    function floydSteinbergRGBA(buf: Uint8Array, w: number, h: number) {
      const n = w * h;
      const r = new Float32Array(n);
      const g = new Float32Array(n);
      const b = new Float32Array(n);

      // fill float buffers
      for (let i = 0; i < n; i++) {
        r[i] = buf[i * 4 + 0];
        g[i] = buf[i * 4 + 1];
        b[i] = buf[i * 4 + 2];
      }

      const qR = 255 / (levelsR - 1);
      const qG = 255 / (levelsG - 1);
      const qB = 255 / (levelsB - 1);

      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const idx = y * w + x;

          // R channel
          const oldR = r[idx];
          const newR = Math.round(oldR / qR) * qR;
          const errR = oldR - newR;
          r[idx] = newR;

          // G
          const oldG = g[idx];
          const newG = Math.round(oldG / qG) * qG;
          const errG = oldG - newG;
          g[idx] = newG;

          // B
          const oldB = b[idx];
          const newB = Math.round(oldB / qB) * qB;
          const errB = oldB - newB;
          b[idx] = newB;

          // distribute errors
          // right
          if (x + 1 < w) {
            const idxr = idx + 1;
            r[idxr] += errR * (7 / 16);
            g[idxr] += errG * (7 / 16);
            b[idxr] += errB * (7 / 16);
          }
          // bottom-left
          if (x - 1 >= 0 && y + 1 < h) {
            const idxbl = idx + w - 1;
            r[idxbl] += errR * (3 / 16);
            g[idxbl] += errG * (3 / 16);
            b[idxbl] += errB * (3 / 16);
          }
          // bottom
          if (y + 1 < h) {
            const idxb = idx + w;
            r[idxb] += errR * (5 / 16);
            g[idxb] += errG * (5 / 16);
            b[idxb] += errB * (5 / 16);
          }
          // bottom-right
          if (x + 1 < w && y + 1 < h) {
            const idxbr = idx + w + 1;
            r[idxbr] += errR * (1 / 16);
            g[idxbr] += errG * (1 / 16);
            b[idxbr] += errB * (1 / 16);
          }
        }
      }

      // write back to byte buffer
      for (let i = 0; i < n; i++) {
        buf[i * 4 + 0] = Math.max(0, Math.min(255, Math.round(r[i])));
        buf[i * 4 + 1] = Math.max(0, Math.min(255, Math.round(g[i])));
        buf[i * 4 + 2] = Math.max(0, Math.min(255, Math.round(b[i])));
        buf[i * 4 + 3] = 255; // alpha
      }
    }

    // Animation loop: render to renderTarget, read pixels, apply FS, put to 2D canvas
    let mounted = true;

    const animate = (t: number) => {
      if (!mounted) return;

      material.uniforms.u_time.value = t * 0.001;
      material.uniforms.u_resolution.value.set(width, height);

      // render into low-res target
      renderer.setRenderTarget(target);
      renderer.render(scene, camera);
      renderer.setRenderTarget(null);

      // throttle processing
      frameCounter = (frameCounter + 1) % framesBetweenProcess;
      if (frameCounter === 0) {
        // readTargetPixels synchronous call
        try {
          renderer.readRenderTargetPixels(target, 0, 0, targetW, targetH, pixelBuf);
        } catch (e) {
          // Some contexts may throw if readRenderTargetPixels is unsupported; handle gracefully.
          // In that case, skip processing this frame.
          console.warn("readRenderTargetPixels failed:", e);
          requestAnimationFrame(animate);
          return;
        }

        // apply Floyd–Steinberg diffusion per-channel
        floydSteinbergRGBA(pixelBuf, targetW, targetH);

        // draw to outCanvas 2D
        const imageData = new ImageData(new Uint8ClampedArray(pixelBuf.buffer), targetW, targetH);
        outCtx.putImageData(imageData, 0, 0);
      }

      requestAnimationFrame(animate);
    };
    animate(0);

    // Resize handler (resizes renderTarget + outCanvas)
    const onResize = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      // recompute low-res target size
      const ds = material.uniforms.u_dotsize.value;
      const sizes = makeTargetSize(w, h, ds);
      targetW = sizes.tw;
      targetH = sizes.th;

      // dispose old target and create a replacement with new size
      target.dispose();
      const newTarget = new THREE.WebGLRenderTarget(targetW, targetH, {
        minFilter: THREE.NearestFilter,
        magFilter: THREE.NearestFilter,
        format: THREE.RGBAFormat,
        type: THREE.UnsignedByteType,
        depthBuffer: false,
        stencilBuffer: false,
      });
      // copy newTarget into variable used in animate (hacky but fine in this closure)
      (target as any) = newTarget;

      outCanvas.width = targetW;
      outCanvas.height = targetH;
      outCanvas.style.width = `${w}px`;
      outCanvas.style.height = `${h}px`;

      renderer.setSize(w, h);
      material.uniforms.u_resolution.value.set(w, h);
    };
    window.addEventListener("resize", onResize);

    // cleanup
    return () => {
      mounted = false;
      window.removeEventListener("resize", onResize);
      mountRef.current?.removeChild(renderer.domElement);
      mountRef.current?.removeChild(outCanvas);
      renderer.dispose();
      target.dispose();
    };
  }, []);

  return (
    <div ref={mountRef} className="fixed inset-0 -z-50 pointer-events-none" />
  );
}
