/**
 * WebGPU Particle Flow — Generative Art
 *
 * GPGPU curl noise particle simulation via Three.js WebGPURenderer + TSL.
 * 65 536 particles flowing through a divergence-free curl noise field,
 * centered at the origin. Mouse interaction repels and deforms the shape.
 *
 * Inspired by The Spirit (edankwan) and waterball (matsuoka-601).
 */

import * as THREE from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
  Fn,
  instancedArray,
  instanceIndex,
  uniform,
  vec2,
  vec3,
  float,
  time,
  If,
  sin,
  cos,
  sqrt,
  pow,
  mix,
  hash,
  mx_noise_float,
} from 'three/tsl';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const COUNT = 256 * 256; // 65 536

// ---------------------------------------------------------------------------
// Capture Mode (thumbnail generation via ?capture)
// ---------------------------------------------------------------------------

const urlParams = new URLSearchParams(window.location.search);
const captureMode = urlParams.has('capture');
const captureFrames = parseInt(urlParams.get('capture') || '180', 10);
let frameCount = 0;

// ---------------------------------------------------------------------------
// Renderer (WebGPU)
// ---------------------------------------------------------------------------

const captureWidth = 1200;
const captureHeight = 630;
const renderer = new THREE.WebGPURenderer({ antialias: true });
if (captureMode) {
  renderer.setSize(captureWidth, captureHeight);
  renderer.setPixelRatio(1);
} else {
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
}
document.body.appendChild(renderer.domElement);

// ---------------------------------------------------------------------------
// Scene / Camera / Controls
// ---------------------------------------------------------------------------

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000);

const camera = new THREE.PerspectiveCamera(
  60,
  captureMode ? captureWidth / captureHeight : window.innerWidth / window.innerHeight,
  0.1,
  100,
);
camera.position.set(0, 0, 8);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;

// ---------------------------------------------------------------------------
// Storage Buffers
// ---------------------------------------------------------------------------

// vec4: xyz = world position, w = life [0..1]
const posBuffer = instancedArray(COUNT, 'vec4');

// ---------------------------------------------------------------------------
// Uniforms
// ---------------------------------------------------------------------------

const uDieSpeed = uniform(0.002);
const uSpeed = uniform(0.25);
const uCurlSize = uniform(0.45);
const uAttraction = uniform(0.8);
const uRadius = uniform(2.0);
const uMousePos = uniform(new THREE.Vector3(9999, 9999, 9999));
const uMouseRadius = uniform(2.5);
const uMouseStrength = uniform(3.0);

// ---------------------------------------------------------------------------
// Curl Noise — finite differences of Perlin noise
// ---------------------------------------------------------------------------

const curlNoise3D = Fn(([p_immutable, t_immutable]: [any, any]) => {
  const p = vec3(p_immutable);
  const t = float(t_immutable);
  const e = float(0.01);
  const o1 = vec3(31.416, 47.853, 12.679);
  const o2 = vec3(17.329, 63.241, 89.017);

  const pt = p.add(vec3(0, 0, t));
  const pt1 = p.add(o1).add(vec3(0, 0, t));
  const pt2 = p.add(o2).add(vec3(0, 0, t));

  // 6 pairs of finite differences → curl vector
  const dAz_dy = mx_noise_float(pt2.add(vec3(0, e, 0))).sub(
    mx_noise_float(pt2.sub(vec3(0, e, 0))),
  );
  const dAy_dz = mx_noise_float(pt1.add(vec3(0, 0, e))).sub(
    mx_noise_float(pt1.sub(vec3(0, 0, e))),
  );
  const dAx_dz = mx_noise_float(pt.add(vec3(0, 0, e))).sub(
    mx_noise_float(pt.sub(vec3(0, 0, e))),
  );
  const dAz_dx = mx_noise_float(pt2.add(vec3(e, 0, 0))).sub(
    mx_noise_float(pt2.sub(vec3(e, 0, 0))),
  );
  const dAy_dx = mx_noise_float(pt1.add(vec3(e, 0, 0))).sub(
    mx_noise_float(pt1.sub(vec3(e, 0, 0))),
  );
  const dAx_dy = mx_noise_float(pt.add(vec3(0, e, 0))).sub(
    mx_noise_float(pt.sub(vec3(0, e, 0))),
  );

  return vec3(
    dAz_dy.sub(dAy_dz),
    dAx_dz.sub(dAz_dx),
    dAy_dx.sub(dAx_dy),
  ).div(e.mul(2));
});

// ---------------------------------------------------------------------------
// Compute: Initialize particles (sphere distribution)
// ---------------------------------------------------------------------------

const computeInit = Fn(() => {
  const i = instanceIndex;
  const pos = posBuffer.element(i);

  // Unique seeds per particle (spaced by 4 to avoid collisions)
  const baseSeed = float(i).mul(4);
  const theta = hash(baseSeed).mul(Math.PI * 2);
  const cosPhi = hash(baseSeed.add(1)).mul(2).sub(1);
  const sinPhi = sqrt(float(1).sub(cosPhi.mul(cosPhi)));
  const r = pow(hash(baseSeed.add(2)), float(1 / 3)).mul(2);

  pos.x.assign(r.mul(sinPhi).mul(cos(theta)));
  pos.y.assign(r.mul(sinPhi).mul(sin(theta)));
  pos.z.assign(r.mul(cosPhi));
  pos.w.assign(hash(baseSeed.add(3))); // life
})().compute(COUNT);

// ---------------------------------------------------------------------------
// Compute: Update particles
// ---------------------------------------------------------------------------

const computeUpdate = Fn(() => {
  const i = instanceIndex;
  const pos = posBuffer.element(i);

  const life = pos.w.sub(uDieSpeed);

  If(life.lessThan(0), () => {
    // Respawn at random position in sphere around origin
    const baseSeed = float(i).mul(4).add(time.mul(137));
    const theta = hash(baseSeed).mul(Math.PI * 2);
    const cosPhi = hash(baseSeed.add(1)).mul(2).sub(1);
    const sinPhi = sqrt(float(1).sub(cosPhi.mul(cosPhi)));
    const r = pow(hash(baseSeed.add(2)), float(1 / 3)).mul(uRadius);

    pos.x.assign(r.mul(sinPhi).mul(cos(theta)));
    pos.y.assign(r.mul(sinPhi).mul(sin(theta)));
    pos.z.assign(r.mul(cosPhi));
    pos.w.assign(float(0.5).add(hash(baseSeed.add(3)).mul(0.5)));
  }).Else(() => {
    const px = pos.x;
    const py = pos.y;
    const pz = pos.z;
    const currentPos = vec3(px, py, pz);

    // Attraction toward origin (keeps shape centered)
    const delta = currentPos.negate(); // origin - currentPos
    const attractForce = float(0.003)
      .add(life.mul(0.006))
      .mul(uAttraction)
      .mul(uSpeed);

    // Curl noise displacement (slow evolution)
    const curl = curlNoise3D(currentPos.mul(uCurlSize), time.mul(0.08));
    const curlForce = uSpeed.mul(0.1);

    // Mouse repulsion — push particles away from cursor
    const toParticle = currentPos.sub(uMousePos);
    const mouseDist = toParticle.length();
    const mouseForce = mouseDist.lessThan(uMouseRadius).select(
      toParticle.normalize().mul(
        uMouseRadius.sub(mouseDist).div(uMouseRadius).mul(uMouseStrength).mul(uSpeed),
      ),
      vec3(0, 0, 0),
    );

    // Apply all forces
    pos.x.addAssign(
      delta.x.mul(attractForce).add(curl.x.mul(curlForce)).add(mouseForce.x),
    );
    pos.y.addAssign(
      delta.y.mul(attractForce).add(curl.y.mul(curlForce)).add(mouseForce.y),
    );
    pos.z.addAssign(
      delta.z.mul(attractForce).add(curl.z.mul(curlForce)).add(mouseForce.z),
    );
    pos.w.assign(life);
  });
})().compute(COUNT);

// ---------------------------------------------------------------------------
// Particle Material (SpriteNodeMaterial — camera-facing billboards)
// ---------------------------------------------------------------------------

const material = new THREE.SpriteNodeMaterial({
  transparent: true,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
  sizeAttenuation: true,
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- toAttribute() added via addMethodChaining, not in TS types
const pAttr = (posBuffer as any).toAttribute() as any;

// Position: xyz from storage buffer
material.positionNode = pAttr.xyz;

// Scale: small sprites, fade in with life
material.scaleNode = vec2(float(0.025).mul(pAttr.w.smoothstep(0, 0.15)));

// Color: cool blue (dying) → warm white (alive)
material.colorNode = mix(
  vec3(0.4, 0.55, 0.9),
  vec3(1.0, 0.97, 0.92),
  pAttr.w.smoothstep(0.0, 0.6),
);

// Opacity: life-based fade
material.opacityNode = pAttr.w
  .smoothstep(0.0, 0.08)
  .mul(float(0.25).add(pAttr.w.mul(0.55)));

// ---------------------------------------------------------------------------
// Instanced Mesh
// ---------------------------------------------------------------------------

const mesh = new THREE.InstancedMesh(
  new THREE.PlaneGeometry(1, 1),
  material,
  COUNT,
);
mesh.frustumCulled = false;
scene.add(mesh);

// ---------------------------------------------------------------------------
// Mouse Tracking
// ---------------------------------------------------------------------------

const mouse2D = new THREE.Vector2(9999, 9999);
const raycaster = new THREE.Raycaster();
const hitPlane = new THREE.Plane();
const camDir = new THREE.Vector3();
let mouseActive = false;

window.addEventListener('pointermove', (e) => {
  mouse2D.x = (e.clientX / window.innerWidth) * 2 - 1;
  mouse2D.y = -(e.clientY / window.innerHeight) * 2 + 1;
  mouseActive = true;
});
window.addEventListener('pointerleave', () => {
  mouseActive = false;
  uMousePos.value.set(9999, 9999, 9999);
});

// ---------------------------------------------------------------------------
// Render Loop
// ---------------------------------------------------------------------------

async function init(): Promise<void> {
  await renderer.init();
  renderer.compute(computeInit);
  renderer.setAnimationLoop(animate);
}

function animate(): void {
  controls.update();

  // Update mouse world position for repulsion
  if (mouseActive) {
    camera.getWorldDirection(camDir);
    hitPlane.setFromNormalAndCoplanarPoint(camDir, new THREE.Vector3());
    raycaster.setFromCamera(mouse2D, camera);
    const hit = new THREE.Vector3();
    const result = raycaster.ray.intersectPlane(hitPlane, hit);
    if (result) {
      uMousePos.value.copy(hit);
    }
  }

  renderer.compute(computeUpdate);
  renderer.render(scene, camera);

  // Capture mode: export canvas as PNG after particles settle
  if (captureMode) {
    frameCount++;
    if (frameCount === captureFrames) {
      renderer.domElement.toBlob((blob) => {
        if (blob) {
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = 'webgpu-particle-thumbnail.png';
          a.click();
          URL.revokeObjectURL(url);
        }
      }, 'image/png');
      renderer.setAnimationLoop(null);
    }
  }
}

init();

// ---------------------------------------------------------------------------
// Resize
// ---------------------------------------------------------------------------

if (!captureMode) {
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
}
