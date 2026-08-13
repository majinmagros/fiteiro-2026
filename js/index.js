import * as THREE from 'three';
import { OrbitControls } from './build/OrbitControls.js';
import { createRenderer, watchResize, loadTexture, addStars, loopWhenVisible, disposeScene, createTextureAtlas, createCarouselInstancedMesh } from './core.js';

const IMGS = ['ini-rl06.jpg', 'ini-sl03.jpg', 'news-01-01.jpg', 'news-04-01.jpg', 'ini-tit2.jpg', 'logoFiteiro.png'];

// Exhibition loading and modal functions
async function loadExhibitions() {
  try {
    const res = await fetch('./data/exhibitions.json', { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return data.items || [];
  } catch (e) {
    console.warn('Falha ao carregar exhibitions.json:', e.message);
    return [];
  }
}

function createExhibitionModal() {
  const modal = document.createElement('div');
  modal.id = 'exhibition-modal';
  modal.style.cssText = `
    position: fixed; inset: 0; background: rgba(0,0,0,0.9); z-index: 1000;
    display: none; align-items: center; justify-content: center; padding: 2rem;
    opacity: 0; transition: opacity 0.2s;
  `;
  modal.innerHTML = `
    <div style="max-width: 700px; max-height: 90vh; overflow-y: auto; background: #111; border: 1px solid #333; border-radius: 8px; padding: 2rem; color: #eee; font-family: 'Montserrat', sans-serif;">
      <button id="modal-close" style="position: absolute; top: 1rem; right: 1rem; background: none; border: none; color: #aaa; font-size: 2rem; cursor: pointer; line-height: 1;">&times;</button>
      <div id="modal-content"></div>
    </div>
  `;
  document.body.appendChild(modal);
  modal.querySelector('#modal-close').onclick = () => closeModal(modal);
  modal.onclick = (e) => { if (e.target === modal) closeModal(modal); };
  return modal;
}

function openModal(modal, exhibition) {
  const content = modal.querySelector('#modal-content');
  const hasContent = exhibition.markdown && !exhibition.error;
  content.innerHTML = `
    <h2 style="margin-top: 0; color: #ff9900;">${exhibition.title || exhibition.label}</h2>
    ${exhibition.excerpt ? `<p style="color: #aaa; margin-bottom: 1rem;">${exhibition.excerpt}</p>` : ''}
    ${hasContent
      ? `<div style="white-space: pre-wrap; line-height: 1.6;">${exhibition.markdown.slice(0, 5000)}</div>`
      : `<p style="color: #666;">Conteúdo não disponível.${exhibition.error ? '<br><small>' + exhibition.error + '</small>' : ''}</p>`
    }
    ${exhibition.url ? `<p style="margin-top: 1.5rem;"><a href="${exhibition.url}" target="_blank" style="color: #ff9900;">Ver fonte original →</a></p>` : ''}
  `;
  modal.style.display = 'flex';
  requestAnimationFrame(() => { modal.style.opacity = '1'; });
}

function closeModal(modal) {
  modal.style.opacity = '0';
  setTimeout(() => { modal.style.display = 'none'; }, 200);
}

async function hero() {
  try {
    const mount = document.getElementById('hero-canvas');
    if (!mount) return;
    const { renderer, cleanup: cleanupRenderer } = createRenderer(mount);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(60, mount.clientWidth / mount.clientHeight, 0.1, 200);
    camera.position.set(0, 1, 13);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;
  controls.autoRotate = true;
  controls.autoRotateSpeed = 1.5;
  controls.enablePan = false;
  controls.minDistance = 5;
  controls.maxDistance = 30;
  controls.target.set(0, 0, 0);

  addStars(scene, 700, 55, 0xff9900);
  scene.fog = new THREE.FogExp2(0x050505, 0.02);

  // Create texture atlas and instanced mesh for hero images
  const { texture: atlasTexture, uvRects } = await createTextureAtlas(IMGS);
  if (!atlasTexture) return;

  const { mesh, dummy, setInstanceOpacity } = createCarouselInstancedMesh(uvRects, IMGS.length, 1.9, 1.9);
  mesh.material.uniforms.uAtlas.value = atlasTexture;
  scene.add(mesh);

  // Torus rings
  const logo = new THREE.Mesh(
    new THREE.TorusGeometry(2.2, 0.03, 8, 100),
    new THREE.MeshBasicMaterial({ color: 0xff9900, transparent: true, opacity: 0.45 })
  );
  const logo2 = new THREE.Mesh(
    new THREE.TorusGeometry(2.2, 0.03, 8, 100),
    new THREE.MeshBasicMaterial({ color: 0xff0000, transparent: true, opacity: 0.45 })
  );
  logo.rotation.x = Math.PI / 2.2;
  logo2.rotation.x = Math.PI / 1.8;
  scene.add(logo);
  scene.add(logo2);

  // Central logo (separate, not instanced)
  let centralLogo = null;
  const { texture: centralLogoTexture } = await createTextureAtlas(['logoFiteiro.png']);
  if (centralLogoTexture) {
    const img = centralLogoTexture.image;
    const ar = img.width / img.height;
    const geo = new THREE.PlaneGeometry(3 * ar, 3);
    const mat = new THREE.MeshBasicMaterial({ map: centralLogoTexture, transparent: true, depthWrite: false });
    centralLogo = new THREE.Mesh(geo, mat);
    scene.add(centralLogo);
  }

  const clock = new THREE.Clock();
  const stopLoop = loopWhenVisible(mount, () => {
    const dt = Math.min(clock.getDelta(), 0.05);
    const t = clock.elapsedTime;

    IMGS.forEach((src, i) => {
      const angle = (i / IMGS.length) * Math.PI * 2;
      const a = angle + t * 1.5; // autoRotateSpeed
      const radius = 3.6;
      const bob = 0.5 + (i % 3) * 0.3;
      
      const x = Math.cos(a) * radius;
      const y = Math.sin(t * 0.5 + angle) * bob;
      const z = Math.sin(a) * radius;
      
      dummy.position.set(x, y, z);
      dummy.rotation.set(0, a + Math.PI / 2, 0);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);

      const behind = Math.sin(a) > 0.2;
      setInstanceOpacity(i, behind ? 0.25 : 1);
    });
    mesh.instanceMatrix.needsUpdate = true;

    logo.rotation.z += dt * 0.15;
    logo2.rotation.y -= dt * 0.2;

    if (centralLogo) {
      centralLogo.rotation.y += dt * 0.4;
      centralLogo.lookAt(camera.position);
    }

    controls.update();
    renderer.render(scene, camera);
  });

  const stopResize = watchResize(renderer, camera, mount);

  // Cleanup on mount removal
  const observer = new MutationObserver(() => {
    if (!document.body.contains(mount)) {
      stopLoop();
      stopResize();
      cleanupRenderer();
      disposeScene(scene);
      atlasTexture.dispose();
      if (centralLogoTexture) centralLogoTexture.dispose();
      observer.disconnect();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
} catch (e) {
  console.error('Erro em hero():', e);
}
}

async function destaques() {
  try {
    const mount = document.getElementById('destaques-canvas');
  if (!mount) return;
  const { renderer, cleanup: cleanupRenderer } = createRenderer(mount);
  const scene = new THREE.Scene();

  const aspect = mount.clientWidth / mount.clientHeight;
  const viewH = 5;
  const viewW = viewH * aspect;
  const camera = new THREE.OrthographicCamera(-viewW / 2, viewW / 2, viewH / 2, -viewH / 2, 0.1, 100);
  camera.position.set(0, 0, 10);

  const imgs = ['news-01-01.jpg', 'news-02-01.jpg', 'news-03-01.jpg', 'news-04-01.jpg'];
  const CARD_H = 2.2;
  const GAP = 0.4;
  const MAX_CARD_W = viewW * 0.9;
  const CARD_ASPECT = MAX_CARD_W / CARD_H;

  let modal = null;
  let exhibitions = [];

  loadExhibitions().then((data) => {
    exhibitions = data;
    if (exhibitions.length > 0) {
      modal = createExhibitionModal();
    }
  });

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();

  function onPointerMove(event) {
    const rect = mount.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  }

  function onClick() {
    if (!modal || exhibitions.length === 0) return;
    raycaster.setFromCamera(pointer, camera);
    const intersects = raycaster.intersectObject(mesh);
    if (intersects.length > 0) {
      const instanceId = intersects[0].instanceId;
      const idx = instanceId % imgs.length;
      const exhibition = exhibitions[idx % exhibitions.length];
      openModal(modal, exhibition);
    }
  }

  mount.addEventListener('pointermove', onPointerMove);
  mount.addEventListener('click', onClick);

  // Create texture atlas and instanced mesh for destaques
  const { texture: atlasTexture, uvRects } = await createTextureAtlas(imgs);
  if (!atlasTexture) return;

  // Use InstancedMesh with custom geometry per instance for different widths
  const count = imgs.length * 2; // original + clone for seamless loop
  const geometry = new THREE.PlaneGeometry(1, 1);
  geometry.setAttribute('instanceUvOffset', new THREE.InstancedBufferAttribute(new Float32Array(count * 4), 4));
  geometry.setAttribute('instanceUvScale', new THREE.InstancedBufferAttribute(new Float32Array(count * 2), 2));
  geometry.setAttribute('instanceOpacity', new THREE.InstancedBufferAttribute(new Float32Array(count), 1));
  geometry.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

  const material = new THREE.MeshBasicMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    onBeforeCompile: (shader) => {
      shader.uniforms.uAtlas = { value: null };
      shader.vertexShader = shader.vertexShader.replace(
        '#include <common>',
        `#include <common>
        attribute vec4 instanceUvOffset;
        attribute vec2 instanceUvScale;
        attribute float instanceOpacity;
        varying vec2 vUvAtlas;
        varying float vInstanceOpacity;`
      );
      shader.vertexShader = shader.vertexShader.replace(
        '#include <uv_vertex>',
        `#include <uv_vertex>
        vec2 uv = uv * instanceUvScale + instanceUvOffset.xy;
        vUvAtlas = uv;
        vInstanceOpacity = instanceOpacity;`
      );
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <common>',
        `#include <common>
        uniform sampler2D uAtlas;
        varying vec2 vUvAtlas;
        varying float vInstanceOpacity;`
      );
      shader.fragmentShader = shader.fragmentShader.replace(
        'vec4 diffuseColor = vec4( diffuse, opacity );',
        `vec4 texel = texture2D(uAtlas, vUvAtlas);
        vec4 diffuseColor = vec4(texel.rgb, texel.a * vInstanceOpacity * opacity);`
      );
    }
  });

  const mesh = new THREE.InstancedMesh(geometry, material, count);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.material.uniforms.uAtlas.value = atlasTexture;
  scene.add(mesh);

  // Load textures to get aspect ratios for UV scaling
  const textures = await Promise.all(imgs.map(loadTexture));
  const uvOffsetAttr = geometry.getAttribute('instanceUvOffset');
  const uvScaleAttr = geometry.getAttribute('instanceUvScale');
  const opacityAttr = geometry.getAttribute('instanceOpacity');

  const dummy = new THREE.Object3D();

  textures.forEach((tex, i) => {
    if (!tex) return;
    const img = tex.image;
    const imgAspect = img.width / img.height;
    let w = MAX_CARD_W;
    let repeatX = 1, repeatY = 1, offsetX = 0, offsetY = 0;

    if (imgAspect > CARD_ASPECT) {
      repeatY = CARD_ASPECT / imgAspect;
      offsetY = (1 - repeatY) / 2;
    } else {
      w = CARD_H * imgAspect;
    }

    // Find this image's UV rect in the atlas
    const rect = uvRects[i];
    if (rect) {
      // Store UV rect for both original and clone
      uvOffsetAttr.setXYZW(i, rect.imgU, rect.imgV, rect.imgWidth, rect.imgHeight);
      uvOffsetAttr.setXYZW(i + imgs.length, rect.imgU, rect.imgV, rect.imgWidth, rect.imgHeight);
      // Scale UV to fit image aspect within the unit plane
      const scaleX = rect.imgWidth / rect.width;
      const scaleY = rect.imgHeight / rect.height;
      uvScaleAttr.setXY(i, scaleX, scaleY);
      uvScaleAttr.setXY(i + imgs.length, scaleX, scaleY);
      opacityAttr.setX(i, 1.0);
      opacityAttr.setX(i + imgs.length, 1.0);
    }
  });
  uvOffsetAttr.needsUpdate = true;
  uvScaleAttr.needsUpdate = true;
  opacityAttr.needsUpdate = true;

  // Calculate positions for seamless loop
  const totalH = imgs.length * (CARD_H + GAP) - GAP;
  const basePositions = [];
  imgs.forEach((src, i) => {
    const baseY = -i * (CARD_H + GAP);
    basePositions.push({ x: 0, y: baseY, z: 0 });
    basePositions.push({ x: 0, y: baseY - totalH, z: 0 });
  });

  const clock = new THREE.Clock();
  const SPEED = 1.2;
  const stopLoop = loopWhenVisible(mount, () => {
    const dt = Math.min(clock.getDelta(), 0.05);
    const groupOffset = (SPEED * clock.elapsedTime) % totalH;

    basePositions.forEach((pos, i) => {
      const y = pos.y + groupOffset;
      dummy.position.set(pos.x, y, pos.z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      setInstanceOpacity(i, 1.0);
    });
    mesh.instanceMatrix.needsUpdate = true;

    renderer.render(scene, camera);
  });

  const stopResize = watchResize(renderer, camera, mount);

  // Cleanup on mount removal
  const observer = new MutationObserver(() => {
    if (!document.body.contains(mount)) {
      stopLoop();
      stopResize();
      cleanupRenderer();
      disposeScene(scene);
      atlasTexture.dispose();
      mount.removeEventListener('pointermove', onPointerMove);
      mount.removeEventListener('click', onClick);
      observer.disconnect();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
} catch (e) {
  console.error('Erro em destaques():', e);
}
}

function start() {
  hero();
  destaques();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start);
} else {
  start();
}