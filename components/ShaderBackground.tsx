"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";

export default function ShaderBackground() {
  const mountRef = useRef<HTMLDivElement>(null);

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
    mountRef.current.appendChild(renderer.domElement);

    // -----------------------------
    // Detect Dark Mode
    // -----------------------------
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const isDark = media.matches;

    // -----------------------------
    // Fullscreen Quad
    // -----------------------------
    const geometry = new THREE.PlaneGeometry(2, 2);

    // -----------------------------
    // Shader Material
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

        // Strength parameters
        u_noiseStrength: { value: 0.20 },
        u_motionStrength: { value: 0.15 },
        u_grainStrength: { value: 0.05 },

        // SPEED CONTROLS (easy to adjust)
        u_speed_scan: { value: 0.5 },     // SPEED: scanline wiggle
        u_speed_wobble: { value: 0.1 },   // SPEED: wobble distortion
        u_speed_tear: { value: 0.25 },    // SPEED: vertical tearing
        u_speed_noise: { value: 0.3 },    // SPEED: organic diffusion motion
        u_speed_snow: { value: 0.4 },    // SPEED: TV snow burst
        u_speed_flicker: { value: 1.0 }, // SPEED: brightness flicker
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

        // SPEED UNIFORMS
        uniform float u_speed_scan;
        uniform float u_speed_wobble;
        uniform float u_speed_tear;
        uniform float u_speed_noise;
        uniform float u_speed_snow;
        uniform float u_speed_flicker;

        // -----------------------------
        // Hash / Noise
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
          return mix(a, b, u.x)
               + (c - a) * u.y * (1.0 - u.x)
               + (d - b) * u.x * u.y;
        }

        // -----------------------------
        // Bayer Dither
        // -----------------------------
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

          // -----------------------------
          // Analog TV Effects (SPEED LABELS)
          // -----------------------------

          // Scanline wiggle (SPEED)
          float scan = sin(uv.y * 200.0 + u_time * u_speed_scan) * 0.0001;
          uv.x += scan;

          // Vertical sync wobble (SPEED)
          float wobble = sin(uv.y * 30.0 + u_time * u_speed_wobble) * 0.001;
          uv.x += wobble;

          // Vertical tearing (SPEED)
          float tearTrigger = step(0.98, fract(u_time * u_speed_tear));
          uv.y = mod(uv.y + tearTrigger * 0.08, 1.0);

          // -----------------------------
          // Static Gradient (no movement)
          // -----------------------------
          float g = uv.y;

          // -----------------------------
          // Organic diffusion noise (SPEED)
          // -----------------------------
          float organic = noise(uv * 3.0 + u_time * u_speed_noise);
          float n = (organic - 0.5) * u_noiseStrength;

          // -----------------------------
          // TV Snow Burst (SPEED)
          // -----------------------------
          float snow = hash(gl_FragCoord.xy * (u_time * u_speed_snow)) * 0.4;

          // Fine grain
          float grain = hash(gl_FragCoord.xy * u_time) * u_grainStrength;

          // Flicker (SPEED)
          float flick = sin(u_time * u_speed_flicker) * 0.10;

          float shade =
              g +
              n * u_motionStrength +
              grain +
              snow +
              flick;

          // -----------------------------
          // Bayer dithering
          // -----------------------------
          float threshold = bayer(gl_FragCoord.xy / u_dotsize);
          float bw = shade > threshold ? 0.0 : 1.0;

          // Light mode invert
          if (u_invert > 0.5) bw = 1.0 - bw;

          vec3 finalColor = mix(u_colorTop, u_colorBottom, bw);

          gl_FragColor = vec4(finalColor, 1.0);
        }
      `,
    });

    const mesh = new THREE.Mesh(geometry, material);
    scene.add(mesh);

    // -----------------------------
    // Animation Loop
    // -----------------------------
    const animate = (t: number) => {
      material.uniforms.u_time.value = t * 0.001;
      renderer.render(scene, camera);
      requestAnimationFrame(animate);
    };
    animate(0);

    // Resize
    const onResize = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      renderer.setSize(w, h);
      material.uniforms.u_resolution.value.set(w, h);
    };
    window.addEventListener("resize", onResize);

    return () => {
      window.removeEventListener("resize", onResize);
      mountRef.current?.removeChild(renderer.domElement);
    };
  }, []);

  return (
    <div ref={mountRef} className="fixed inset-0 -z-50 pointer-events-none" />
  );
}

