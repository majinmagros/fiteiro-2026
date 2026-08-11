import * as THREE from 'three';

THREE.Cache.enabled = true;

export const TAU = Math.PI * 2;

export function prefersReducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export async function createRenderer(el, opts = {}) {
  let renderer = null;
  let api = 'webgl';
  try {
    if (typeof THREE.WebGPURenderer === 'function' && typeof navigator !== 'undefined' && navigator.gpu) {
      const r = new THREE.WebGPURenderer({
        antialias: true,
        alpha: true,
        powerPreference: 'high-performance'
      });
      await r.init();
      renderer = r;
      api = 'webgpu';
    }
  } catch (err) {
    console.warn('[fiteiro-2026] WebGPU indisponível, usando WebGL.', err);
    renderer = null;
  }
  if (!renderer) {
    renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
      failIfMajorPerformanceCaveat: false
    });
  }
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  el.appendChild(renderer.domElement);
  fit(renderer, el);
  return { renderer, api, cleanup: () => renderer.dispose() };
}

export function fit(renderer, el) {
  const w = el.clientWidth || window.innerWidth || 640;
  const h = el.clientHeight || 420;
  renderer.setSize(w, h, false);
}

export function resizeCamera(renderer, camera, el) {
  const w = el.clientWidth || window.innerWidth || 640;
  const h = el.clientHeight || 420;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

export function watchResize(renderer, camera, el) {
  if (typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver(() => resizeCamera(renderer, camera, el));
    ro.observe(el);
    return () => ro.disconnect();
  }
  const onWin = () => resizeCamera(renderer, camera, el);
  window.addEventListener('resize', onWin);
  return () => window.removeEventListener('resize', onWin);
}

export function loadTexture(url) {
  return new Promise((resolve, reject) => {
    new THREE.TextureLoader().load(
      url,
      (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = 4;
        resolve(tex);
      },
      undefined,
      reject
    );
  });
}

export function loopWhenVisible(el, tick) {
  let running = false;
  function step() {
    if (!running) return;
    tick();
    requestAnimationFrame(step);
  }
  const start = () => { if (!running) { running = true; step(); } };
  const stop = () => { running = false; };
  if (typeof IntersectionObserver === 'undefined') { start(); return stop; }
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) (e.isIntersecting ? start : stop)();
  });
  io.observe(el);
  return () => { stop(); io.disconnect(); };
}

export function addStars(scene, count = 500, radius = 40, color = 0xff9900) {
  const pos = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    pos[i * 3] = (Math.random() - 0.5) * 2 * radius;
    pos[i * 3 + 1] = (Math.random() - 0.5) * 2 * radius;
    pos[i * 3 + 2] = (Math.random() - 0.5) * 2 * radius;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({ color, size: 0.06, transparent: true, opacity: 0.7, depthWrite: false });
  const pts = new THREE.Points(geo, mat);
  scene.add(pts);
  return pts;
}

export function disposeObject(obj) {
  if (!obj) return;
  if (obj.geometry) obj.geometry.dispose();
  if (obj.material) {
    if (Array.isArray(obj.material)) {
      obj.material.forEach(m => m.dispose());
    } else {
      obj.material.dispose();
    }
  }
  if (obj.map) obj.map.dispose();
}

export function disposeScene(scene) {
  scene.traverse(obj => disposeObject(obj));
}

/**
 * Creates a texture atlas from multiple image URLs.
 * Returns { texture, uvRects } where uvRects[i] = { u, v, width, height } in UV space [0,1].
 * All images are scaled to fit within maxDim x maxDim while preserving aspect ratio.
 */
export async function createTextureAtlas(urls, maxDim = 2048) {
  const images = await Promise.all(urls.map(url => loadTexture(url).then(tex => tex.image).catch(() => null)));
  const valid = images.filter(img => img !== null);
  if (valid.length === 0) return { texture: null, uvRects: [] };

  // Calculate layout: simple grid
  const cols = Math.ceil(Math.sqrt(valid.length));
  const rows = Math.ceil(valid.length / cols);

  // Find max width/height to normalize
  let maxW = 0, maxH = 0;
  valid.forEach(img => {
    maxW = Math.max(maxW, img.width);
    maxH = Math.max(maxH, img.height);
  });

  // Scale to fit in maxDim
  const scale = Math.min(maxDim / (maxW * cols), maxDim / (maxH * rows), 1);
  const cellW = Math.round(maxW * scale);
  const cellH = Math.round(maxH * scale);
  const atlasW = cellW * cols;
  const atlasH = cellH * rows;

  const canvas = document.createElement('canvas');
  canvas.width = atlasW;
  canvas.height = atlasH;
  const ctx = canvas.getContext('2d');

  const uvRects = [];
  valid.forEach((img, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = col * cellW;
    const y = row * cellH;
    
    // Draw image centered in cell, preserving aspect ratio
    const iw = img.width * scale;
    const ih = img.height * scale;
    const dx = x + (cellW - iw) / 2;
    const dy = y + (cellH - ih) / 2;
    ctx.drawImage(img, dx, dy, iw, ih);

    // UV rect in [0,1] space
    uvRects.push({
      u: x / atlasW,
      v: 1 - (y + cellH) / atlasH, // flip V for Three.js
      width: cellW / atlasW,
      height: cellH / atlasH,
      imgWidth: iw / atlasW,
      imgHeight: ih / atlasH,
      imgU: (dx) / atlasW,
      imgV: 1 - (dy + ih) / atlasH
    });
  });

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;

  return { texture, uvRects };
}

/**
 * Creates an InstancedMesh for a carousel of images using a texture atlas.
 * NodeMaterial (TSL) — works on WebGL and WebGPU renderers.
 * Call setAtlas(texture) with the atlas created by createTextureAtlas.
 * Returns { mesh, uvRects, dummy, material, geometry, updateInstanceMatrix, setInstanceOpacity, setAtlas }
 */
export function createCarouselInstancedMesh(uvRects, count, baseWidth = 1.9, baseHeight = 1.9) {
  // Base geometry: unit plane, UVs will be transformed via node shader
  const geometry = new THREE.PlaneGeometry(1, 1);
  geometry.setAttribute('instanceUvOffset', new THREE.InstancedBufferAttribute(new Float32Array(count * 4), 4));
  geometry.setAttribute('instanceUvScale', new THREE.InstancedBufferAttribute(new Float32Array(count * 2), 2));
  geometry.setAttribute('instanceOpacity', new THREE.InstancedBufferAttribute(new Float32Array(count), 1));

  const material = new THREE.MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide
  });

  const tsl = THREE.TSL;
  const atlasNode = tsl.texture();
  const uvNode = tsl.uv()
    .mul(tsl.attribute('instanceUvScale'))
    .add(tsl.attribute('instanceUvOffset').xy);
  const texel = atlasNode.sample(uvNode);
  material.colorNode = texel.rgb;
  material.opacityNode = texel.a.mul(tsl.attribute('instanceOpacity'));

  const mesh = new THREE.InstancedMesh(geometry, material, count);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

  const dummy = new THREE.Object3D();

  // Initialize instance attributes
  const uvOffsetAttr = geometry.getAttribute('instanceUvOffset');
  const uvScaleAttr = geometry.getAttribute('instanceUvScale');
  const opacityAttr = geometry.getAttribute('instanceOpacity');

  uvRects.forEach((rect, i) => {
    if (i >= count) return;
    // Store the image's UV rect within the atlas
    uvOffsetAttr.setXYZW(i, rect.imgU, rect.imgV, rect.imgWidth, rect.imgHeight);
    // Scale UV to fit image aspect within the unit plane
    uvScaleAttr.setXY(i, rect.imgWidth / rect.width, rect.imgHeight / rect.height);
    opacityAttr.setX(i, 1.0);
  });
  uvOffsetAttr.needsUpdate = true;
  uvScaleAttr.needsUpdate = true;
  opacityAttr.needsUpdate = true;

  function setAtlas(atlasTexture) {
    atlasNode.value = atlasTexture;
  }

  function updateInstanceMatrix(index, position, rotation, scale = 1) {
    dummy.position.copy(position);
    dummy.rotation.copy(rotation);
    dummy.scale.setScalar(scale);
    dummy.updateMatrix();
    mesh.setMatrixAt(index, dummy.matrix);
    mesh.instanceMatrix.needsUpdate = true;
  }

  function setInstanceOpacity(index, opacity) {
    opacityAttr.setX(index, opacity);
    opacityAttr.needsUpdate = true;
  }

  return { mesh, uvRects, dummy, material, geometry, updateInstanceMatrix, setInstanceOpacity, setAtlas };
}