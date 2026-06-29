import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";
import { OrbitControls } from "https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/controls/OrbitControls.js";

const CYAN = 0x00e8ff;
const CYAN_SOFT = 0x4dd0ff;
const PURPLE = 0x7b4dff;
const WHITE_HOT = 0xe8fcff;

const TYPE_COLORS = {
  workflow: 0x00e8ff,
  memory: 0x00c8ff,
  conversation: 0x00ff9f,
  source: 0x00ffcc,
  tool: 0xff2bd6,
  note: 0xb47aff,
  repository: 0xff6a1a,
};

const SYNAPSE_COLORS = {
  workflow: 0x00e8ff,
  memory: 0x00b8ff,
  conversation: 0x00ff9f,
  source: 0x00ffcc,
  tool: 0xff2bd6,
  note: 0xb47aff,
  repository: 0xff6a1a,
};

const TRON_CORE = 0xe8fcff;

const TYPE_LABELS = {
  workflow: "Workflow",
  memory: "Memoria",
  conversation: "Conversación",
  source: "Fuente",
  tool: "Herramienta",
  note: "Nota vault",
  repository: "Repositorio",
};

const ZOOM_LEVELS = {
  galaxy: { min: 9, label: "Vista global", showClusters: true, memoryAlpha: 0, synapseAlpha: 0.06 },
  region: { min: 5.2, label: "Regiones", showClusters: true, memoryAlpha: 0.5, synapseAlpha: 0.12 },
  network: { min: 2.4, label: "Red sináptica", showClusters: false, memoryAlpha: 1, synapseAlpha: 0.2 },
  synapse: { min: 0, label: "Interior", showClusters: false, memoryAlpha: 1, synapseAlpha: 0.28 },
};

const CLUSTER_DEFS = [
  { key: "workflows", label: "Workflows", types: ["workflow"], color: "#00e8ff" },
  { key: "repos", label: "Repos", types: ["repository"], color: "#ff8c42" },
  { key: "cortex", label: "Memorias", types: ["memory", "conversation", "source"], color: "#00c8ff" },
  { key: "vault", label: "Vault", types: ["note", "tool"], color: "#a78bfa" },
];

const DEFAULT_VIEW = {
  position: new THREE.Vector3(0.3, 3.8, 4.2),
  target: new THREE.Vector3(0, 0.05, 0),
  distance: 5.1,
};

function displaceSurface(geo, amp = 0.09) {
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const bump =
      Math.sin(x * 9.2 + y * 3.1) * Math.cos(y * 8.7 + z * 2.4) * Math.sin(z * 7.5 + x * 1.8);
    const ridge = Math.sin(x * 18 + z * 14) * 0.35;
    const scale = 1 + amp * (bump + ridge);
    pos.setXYZ(i, x * scale, y * scale, z * scale);
  }
  geo.computeVertexNormals();
  return geo;
}

export class Brain3D {
  constructor(container, options = {}) {
    this.container = container;
    this.interactionEl = options.interactionEl || container;
    this.onSelect = options.onSelect || (() => {});
    this.onHover = options.onHover || (() => {});
    this.onZoomChange = options.onZoomChange || (() => {});
    this.onClusterFocus = options.onClusterFocus || null;
    this.neurons = [];
    this.clusters = {};
    this.clusterEls = new Map();
    this.detailLabelEls = [];
    this._zoomLevel = "region";
    this._flyAnim = null;
    this._defaultView = {
      position: DEFAULT_VIEW.position.clone(),
      target: DEFAULT_VIEW.target.clone(),
      distance: DEFAULT_VIEW.distance,
    };
    this.meshes = new Map();
    this.synapseLines = [];
    this.pulses = [];
    this.hotspots = [];
    this.wireLayers = [];
    this.decorativeGroup = null;
    this.brainGroup = null;
    this.selectedId = null;
    this.activeId = null;
    this._focusedClusterKey = null;
    this._focusedClusterIds = null;
    this._focusedClusterColor = 0x00e8ff;
    this.paused = false;
    this._suspended = false;
    this._animateRaf = null;
    this._interactionEnabled = true;
    this.time = 0;
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this._hoverRaf = null;
    this._pendingHover = null;
    this._tapStart = null;
    this._isDragging = false;
    this._idleTimer = null;
    this.labelEls = new Map();
    this._vecProj = new THREE.Vector3();
    this.corePos = new THREE.Vector3(0, 0.05, 0);
    this._init();
    this._bindEvents();
  }

  _init() {
    const w = this.interactionEl.clientWidth || 800;
    const h = this.interactionEl.clientHeight || 500;

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0x0a1a3a, 0.018);

    this.camera = new THREE.PerspectiveCamera(48, w / h, 0.05, 120);
    this.camera.position.copy(this._defaultView.position);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(w, h);
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.55;
    this.container.innerHTML = "";
    this.container.style.position = "absolute";
    this.container.style.inset = "0";
    this.container.style.overflow = "hidden";
    this.container.style.pointerEvents = "auto";
    this.controlEl = this.container;
    this.renderer.domElement.style.display = "block";
    this.renderer.domElement.style.position = "absolute";
    this.renderer.domElement.style.inset = "0";
    this.renderer.domElement.style.zIndex = "1";
    this.renderer.domElement.style.pointerEvents = "none";
    this.container.appendChild(this.renderer.domElement);

    this.labelLayer = document.createElement("div");
    this.labelLayer.className = "neuron-3d-labels brain-overlay-layer";
    this.labelLayer.setAttribute("aria-label", "Neuronas interactivas");
    this.container.appendChild(this.labelLayer);

    this.clusterLayer = document.createElement("div");
    this.clusterLayer.className = "neuron-cluster-layer brain-overlay-layer";
    this.clusterLayer.setAttribute("aria-label", "Clusters neuronales");
    this.container.appendChild(this.clusterLayer);

    this.detailLabelLayer = document.createElement("div");
    this.detailLabelLayer.className = "neuron-detail-labels brain-overlay-layer";
    this.container.appendChild(this.detailLabelLayer);

    this.controls = new OrbitControls(this.camera, this.controlEl);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.1;
    this.controls.rotateSpeed = 0.85;
    this.controls.enableZoom = false;
    this.controls.minDistance = 0.38;
    this.controls.maxDistance = 22;
    this.controls.autoRotate = true;
    this.controls.autoRotateSpeed = 0.35;
    this.controls.target.copy(this._defaultView.target);
    this.controls.maxPolarAngle = Math.PI * 0.88;
    this.controls.enablePan = false;
    this.controls.screenSpacePanning = true;
    this.controls.panSpeed = 0.85;
    this._hoveredNeuronId = null;

    this._buildBackground();
    this._buildLights();
    this._buildBrainMesh();
    this._buildCoreGlow();

    this.neuronGroup = new THREE.Group();
    this.synapseGroup = new THREE.Group();
    this.scene.add(this.synapseGroup);
    this.scene.add(this.neuronGroup);

    this._animate = this._animate.bind(this);
    requestAnimationFrame(this._animate);
  }

  _buildBackground() {
    const dust = new Float32Array(600 * 3);
    for (let i = 0; i < 600; i++) {
      dust[i * 3] = (Math.random() - 0.5) * 24;
      dust[i * 3 + 1] = (Math.random() - 0.5) * 16;
      dust[i * 3 + 2] = (Math.random() - 0.5) * 12 - 2;
    }
    const dustGeo = new THREE.BufferGeometry();
    dustGeo.setAttribute("position", new THREE.BufferAttribute(dust, 3));
    this.dust = new THREE.Points(
      dustGeo,
      new THREE.PointsMaterial({
        color: CYAN_SOFT,
        size: 0.025,
        transparent: true,
        opacity: 0.35,
        depthWrite: false,
      })
    );
    this.scene.add(this.dust);
  }

  _buildLights() {
    this.scene.add(new THREE.AmbientLight(0x224466, 0.35));
    const top = new THREE.DirectionalLight(0x00e8ff, 1.2);
    top.position.set(0, 8, 2);
    this.scene.add(top);
    const fill = new THREE.DirectionalLight(0x7b4dff, 0.55);
    fill.position.set(-4, 2, -3);
    this.scene.add(fill);
    this.rimLight = new THREE.PointLight(CYAN, 2.2, 16);
    this.rimLight.position.set(2, 3, 4);
    this.scene.add(this.rimLight);
  }

  _hemisphereGeo(sx, sy, sz, xOff) {
    const geo = new THREE.SphereGeometry(1, 72, 56, 0, Math.PI * 2, 0, Math.PI * 0.92);
    geo.scale(sx, sy, sz);
    displaceSurface(geo, 0.11);
    geo.translate(xOff, 0.06, 0);
    return geo;
  }

  _addWireShell(geo, scale, opacity, color = CYAN) {
    const g = geo.clone();
    g.scale(scale, scale, scale);
    const wire = new THREE.Mesh(
      g,
      new THREE.MeshBasicMaterial({
        color,
        wireframe: true,
        transparent: true,
        opacity,
        depthWrite: false,
      })
    );
    this.wireLayers.push(wire);
    this.brainGroup.add(wire);

    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(g, 12),
      new THREE.LineBasicMaterial({
        color: WHITE_HOT,
        transparent: true,
        opacity: opacity * 0.55,
        depthWrite: false,
      })
    );
    this.wireLayers.push(edges);
    this.brainGroup.add(edges);
  }

  _buildBrainMesh() {
    this.brainGroup = new THREE.Group();

    const leftGeo = this._hemisphereGeo(0.78, 0.92, 0.82, 0.36);
    const rightGeo = this._hemisphereGeo(0.78, 0.92, 0.82, -0.36);

    const innerMat = new THREE.MeshPhysicalMaterial({
      color: 0x061428,
      emissive: 0x0a2848,
      emissiveIntensity: 0.15,
      metalness: 0.9,
      roughness: 0.25,
      transparent: true,
      opacity: 0.12,
      depthWrite: false,
    });

    this.brainGroup.add(new THREE.Mesh(leftGeo, innerMat));
    this.brainGroup.add(new THREE.Mesh(rightGeo, innerMat.clone()));

    this._addWireShell(leftGeo, 1.0, 0.55, CYAN);
    this._addWireShell(rightGeo, 1.0, 0.55, CYAN);
    this._addWireShell(leftGeo, 1.018, 0.22, CYAN_SOFT);
    this._addWireShell(rightGeo, 1.018, 0.22, CYAN_SOFT);

    const stemGeo = new THREE.SphereGeometry(0.34, 36, 28);
    stemGeo.scale(0.72, 1.05, 0.78);
    displaceSurface(stemGeo, 0.06);
    stemGeo.translate(0, -0.68, -0.1);
    this._addWireShell(stemGeo, 1, 0.35, PURPLE);

    this._buildCortexHotspots(leftGeo, rightGeo);
    this._buildInteriorFractal();
    this.brainGroup.add(this.decorativeGroup);
    this.brainGroup.traverse((obj) => {
      if (obj.material && obj.material.opacity != null) {
        obj.material.userData.baseOpacity = obj.material.opacity;
      }
    });
    this.scene.add(this.brainGroup);
  }

  _buildCortexHotspots(leftGeo, rightGeo) {
    this.hotspotGroup = new THREE.Group();
    const sample = (geo, count) => {
      const pos = geo.attributes.position;
      for (let i = 0; i < count; i++) {
        const idx = Math.floor(Math.random() * pos.count);
        const p = new THREE.Vector3(pos.getX(idx), pos.getY(idx), pos.getZ(idx));
        if (p.y < -0.2) continue;

        const dot = new THREE.Mesh(
          new THREE.SphereGeometry(0.006, 6, 6),
          new THREE.MeshBasicMaterial({
            color: CYAN_SOFT,
            transparent: true,
            opacity: 0.25,
            depthWrite: false,
          })
        );
        dot.position.copy(p);
        this.hotspotGroup.add(dot);
      }
    };
    sample(leftGeo, 18);
    sample(rightGeo, 18);
    this.brainGroup.add(this.hotspotGroup);
  }

  _insideBrainVolume(p) {
    const hem = p.x >= 0 ? 1 : -1;
    const lx = (p.x - hem * 0.36) / 0.72;
    const ly = (p.y - 0.06) / 0.88;
    const lz = p.z / 0.78;
    return lx * lx + ly * ly + lz * lz <= 1.0;
  }

  _buildInteriorFractal() {
    this.decorativeGroup = new THREE.Group();
    const mat = new THREE.LineBasicMaterial({
      color: 0x00ff9f,
      transparent: true,
      opacity: 0.1,
      depthWrite: false,
    });

    const grow = (origin, direction, depth, lengthScale) => {
      if (depth <= 0) return;
      const dir = direction.clone().normalize();
      const len = lengthScale * (0.07 + depth * 0.045);
      const end = origin.clone().add(dir.clone().multiplyScalar(len));
      if (!this._insideBrainVolume(end)) return;

      const geo = new THREE.BufferGeometry().setFromPoints([origin, end]);
      this.decorativeGroup.add(new THREE.Line(geo, mat));

      const branches = depth > 2 ? 3 : 2;
      for (let i = 0; i < branches; i++) {
        const euler = new THREE.Euler(
          (Math.random() - 0.5) * 1.4,
          (Math.random() - 0.5) * 1.4,
          (Math.random() - 0.5) * 1.4
        );
        grow(end, dir.clone().applyEuler(euler), depth - 1, lengthScale * 0.78);
      }
    };

    const seeds = [
      new THREE.Vector3(0.28, 0.22, 0.12),
      new THREE.Vector3(-0.28, 0.18, -0.1),
      new THREE.Vector3(0.2, -0.08, 0.2),
      new THREE.Vector3(-0.22, 0.05, 0.15),
      new THREE.Vector3(0.05, 0.35, -0.05),
      new THREE.Vector3(-0.05, 0.28, 0.08),
    ];
    seeds.forEach((s) => {
      for (let i = 0; i < 3; i++) {
        const dir = new THREE.Vector3(
          (Math.random() - 0.5) * 2,
          Math.random() * 0.8 - 0.2,
          (Math.random() - 0.5) * 2
        );
        grow(s, dir, 5, 1);
      }
    });
  }

  _buildCoreGlow() {
    const tron = this._createTronNode(0x00e8ff, 0.045);
    tron.node.position.copy(this.corePos);
    this.coreMesh = tron.node;
    this.coreGlow = null;
    this.coreFlare = null;
    this.scene.add(this.coreMesh);
  }

  _bindEvents() {
    this._onResize = () => {
      const root = this.interactionEl;
      const cw = root.clientWidth;
      const ch = root.clientHeight;
      if (!cw || !ch) return;
      this.camera.aspect = cw / ch;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(cw, ch);
    };
    window.addEventListener("resize", this._onResize);
    if (typeof ResizeObserver !== "undefined") {
      this._resizeObs = new ResizeObserver(() => this._onResize());
      this._resizeObs.observe(this.interactionEl);
    }
    this._onResize();

    this.interactionEl.style.cursor = "grab";
    this.interactionEl.style.touchAction = "none";

    this._wheelAccum = 0;
    this._wheelRaf = null;

    this._onWheel = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!this.controls.enabled) return;

      const dy = this._normalizeWheelDelta(e);
      if (!dy) return;

      this._wheelAccum += dy;
      if (this._wheelRaf) return;
      this._wheelRaf = requestAnimationFrame(() => {
        this._wheelRaf = null;
        const delta = this._wheelAccum;
        this._wheelAccum = 0;
        if (!delta) return;

        const steps = Math.max(-4, Math.min(4, delta / 100));
        const factor = Math.pow(0.84, steps);
        this.zoomBy(factor);
        this.controls.autoRotate = false;
        clearTimeout(this._idleTimer);
      });
    };
    this.interactionEl.addEventListener("wheel", this._onWheel, { passive: false, capture: true });

    this.controls.addEventListener("start", () => {
      this._isDragging = true;
      this.controls.autoRotate = false;
      clearTimeout(this._idleTimer);
      this.interactionEl.style.cursor = "grabbing";
    });

    this.controls.addEventListener("end", () => {
      setTimeout(() => {
        this._isDragging = false;
      }, 40);
      this.interactionEl.style.cursor = "grab";
      this._scheduleAutoRotate();
    });

    this.interactionEl.addEventListener("pointerdown", (e) => {
      if (e.target.closest(".hud-interactive, .neuron-3d-label, .neuron-cluster-btn, .neuron-detail-label, .brain-nav-btn, .cluster-strip-btn, .wf-chip")) return;
      this._tapStart = { x: e.clientX, y: e.clientY };
    });

    this.interactionEl.addEventListener("pointermove", (e) => {
      if (e.target.closest(".hud-interactive, .neuron-3d-label, .neuron-cluster-btn, .neuron-detail-label, .brain-nav-btn, .cluster-strip-btn, .wf-chip")) return;
      if (this._isDragging) return;
      this._pendingHover = e;
      if (this._hoverRaf) return;
      this._hoverRaf = requestAnimationFrame(() => {
        this._hoverRaf = null;
        const ev = this._pendingHover;
        if (!ev || this._isDragging) return;
        this._handleHover(ev.clientX, ev.clientY);
      });
    });

    this.interactionEl.addEventListener("pointerleave", () => {
      this._tapStart = null;
      this._setHovered(null);
      this.onHover(null, 0, 0);
      this.interactionEl.style.cursor = "grab";
    });

    this.interactionEl.addEventListener("click", (e) => {
      if (e.target.closest(".hud-interactive, .neuron-3d-label, .neuron-cluster-btn, .neuron-detail-label, .brain-nav-btn, .cluster-strip-btn, .wf-chip")) return;
      if (this._tapStart) {
        const dx = e.clientX - this._tapStart.x;
        const dy = e.clientY - this._tapStart.y;
        this._tapStart = null;
        if (Math.hypot(dx, dy) > 12) return;
      }
      if (this._isDragging) return;
      const n = this._pickNeuronAtScreen(e.clientX, e.clientY);
      this._selectNeuron(n || null);
    });

    this.interactionEl.addEventListener("dblclick", (e) => {
      if (e.target.closest(".hud-interactive, .neuron-3d-label, .neuron-cluster-btn, .neuron-detail-label, .brain-nav-btn, .cluster-strip-btn, .wf-chip")) return;
      const n = this._pickNeuronAtScreen(e.clientX, e.clientY);
      if (n) {
        this._selectNeuron(n);
        this.focusOnNeuron(n.id);
      }
    });
  }

  _normalizeWheelDelta(e) {
    let dy = e.deltaY;
    if (e.deltaMode === 1) dy *= 16;
    else if (e.deltaMode === 2) dy *= 400;
    if (e.ctrlKey) dy *= 0.35;
    return Math.max(-240, Math.min(240, dy));
  }

  _cameraDistance() {
    return this.camera.position.distanceTo(this.controls.target);
  }

  _resolveZoomLevel(dist = this._cameraDistance()) {
    if (dist >= ZOOM_LEVELS.galaxy.min) return "galaxy";
    if (dist >= ZOOM_LEVELS.region.min) return "region";
    if (dist >= ZOOM_LEVELS.network.min) return "network";
    return "synapse";
  }

  _zoomT(dist = this._cameraDistance()) {
    const min = this.controls.minDistance;
    const max = this.controls.maxDistance;
    return Math.max(0, Math.min(1, (Math.log(dist) - Math.log(min)) / (Math.log(max) - Math.log(min))));
  }

  _computeClusters() {
    const clusters = {};
    for (const def of CLUSTER_DEFS) {
      const members = this.neurons.filter((n) => def.types.includes(n.type));
      if (!members.length) continue;
      const centroid = new THREE.Vector3();
      for (const n of members) centroid.add(this._pos(n));
      centroid.divideScalar(members.length);
      let radius = 0.45;
      for (const n of members) {
        radius = Math.max(radius, centroid.distanceTo(this._pos(n)) + 0.25);
      }
      clusters[def.key] = { ...def, members, centroid, radius, count: members.length };
    }

    for (const repo of this.neurons.filter((n) => n.type === "repository")) {
      const members = this.neurons.filter(
        (n) =>
          n.id === repo.id ||
          (n.connections || []).includes(repo.id) ||
          (repo.connections || []).includes(n.id)
      );
      if (members.length < 2) continue;
      const centroid = new THREE.Vector3();
      for (const n of members) centroid.add(this._pos(n));
      centroid.divideScalar(members.length);
      let radius = 0.35;
      for (const n of members) {
        radius = Math.max(radius, centroid.distanceTo(this._pos(n)) + 0.18);
      }
      clusters[repo.id] = {
        key: repo.id,
        label: repo.label,
        types: ["repository"],
        color: "#ffb347",
        members,
        centroid,
        radius,
        count: members.length,
        parent: "repos",
      };
    }
    return clusters;
  }

  _rebuildClusters() {
    if (!this.clusterLayer) return;
    this.clusterLayer.innerHTML = "";
    this.clusterEls.clear();
    this.clusters = this._computeClusters();

    for (const [key, cluster] of Object.entries(this.clusters)) {
      if (cluster.parent) continue;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "neuron-cluster-btn";
      btn.style.setProperty("--cluster-color", cluster.color);
      btn.innerHTML = `<span class="cluster-name">${cluster.label}</span><span class="cluster-count">${cluster.count}</span>`;
      btn.title = `Acercar a ${cluster.label} (${cluster.count} neuronas)`;
      btn.dataset.clusterKey = key;
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.locateCluster(key);
        this.onClusterFocus?.(key);
      });
      this.clusterLayer.appendChild(btn);
      this.clusterEls.set(key, { btn, cluster });
    }
  }

  _updateClusterPositions() {
    if (!this.clusterEls.size) return;
    const rect = this.interactionEl.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;
    if (!w || !h) return;
    const show = ZOOM_LEVELS[this._zoomLevel]?.showClusters;

    for (const [key, { btn, cluster }] of this.clusterEls) {
      const screen = this._projectToScreen(cluster.centroid, { width: w, height: h });
      if (!screen || !show) {
        btn.style.visibility = "hidden";
        btn.style.pointerEvents = "none";
        continue;
      }
      btn.style.visibility = "visible";
      btn.style.pointerEvents = "auto";
      btn.style.left = `${screen.x}px`;
      btn.style.top = `${screen.y}px`;
      const scale = this._zoomLevel === "galaxy" ? 1.15 : 0.92;
      btn.style.transform = `translate(-50%, -50%) scale(${scale})`;
      btn.classList.toggle("active-region", this._zoomLevel === "region");
    }
  }

  _clearDetailLabels() {
    this.detailLabelLayer.innerHTML = "";
    this.detailLabelEls = [];
  }

  _updateDetailLabels() {
    if (this._zoomLevel !== "synapse") {
      if (this.detailLabelEls.length) this._clearDetailLabels();
      return;
    }

    const ids = new Set();
    if (this.selectedId) ids.add(this.selectedId);
    if (this._hoveredNeuronId) ids.add(this._hoveredNeuronId);
    if (!ids.size) {
      if (this.detailLabelEls.length) this._clearDetailLabels();
      return;
    }

    const rect = this.interactionEl.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;
    if (!w || !h) return;

    const candidates = this.neurons.filter((n) => ids.has(n.id));

    const needed = candidates.length;
    while (this.detailLabelEls.length < needed) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "neuron-detail-label tron-label";
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const id = btn.dataset.neuronId;
        const neuron = this.neurons.find((x) => x.id === id);
        if (neuron) this._selectNeuron(neuron);
      });
      this.detailLabelLayer.appendChild(btn);
      this.detailLabelEls.push(btn);
    }
    while (this.detailLabelEls.length > needed) {
      const el = this.detailLabelEls.pop();
      el.remove();
    }

    candidates.forEach((n, i) => {
      const btn = this.detailLabelEls[i];
      const pos = this._pos(n);
      const screen = this._projectToScreen(pos, { width: w, height: h });
      if (!screen) {
        btn.style.visibility = "hidden";
        btn.style.pointerEvents = "none";
        return;
      }
      btn.dataset.neuronId = n.id;
      btn.dataset.neuronType = n.type;
      btn.textContent = n.label;
      btn.title = n.content_preview || n.label;
      btn.style.visibility = "visible";
      btn.style.pointerEvents = "auto";
      btn.style.left = `${screen.x}px`;
      btn.style.top = `${screen.y - 10}px`;
      btn.classList.toggle("selected", n.id === this.selectedId);
      btn.classList.toggle("hovered", n.id === this._hoveredNeuronId);
    });
  }

  _updateLOD() {
    const dist = this._cameraDistance();
    const level = this._resolveZoomLevel(dist);
    const t = this._zoomT(dist);
    if (level !== this._zoomLevel) {
      this._zoomLevel = level;
    }
    this.onZoomChange({
      level: this._zoomLevel,
      label: ZOOM_LEVELS[this._zoomLevel].label,
      distance: dist,
      t,
    });

    this.controls.enablePan = level === "network" || level === "synapse";
    const cfg = ZOOM_LEVELS[this._zoomLevel];
    const insideBrain = dist < 2.6;
    const brainFade = insideBrain ? Math.max(0.08, (dist - 0.38) / 2.2) : 1;

    if (this.brainGroup) {
      this.brainGroup.traverse((obj) => {
        if (!obj.material || obj.material.opacity == null) return;
        const base = obj.material.userData.baseOpacity ?? obj.material.opacity;
        obj.material.opacity = base * brainFade;
      });
    }

    if (this.scene.fog) {
      this.scene.fog.density = insideBrain ? 0.012 : 0.028;
    }

    for (const [, group] of this.meshes) {
      const { mesh, labelOnly } = group.userData;
      if (labelOnly) continue;
      if (!mesh) continue;
      let alpha = cfg.memoryAlpha;
      if (this._zoomLevel === "galaxy") alpha = 0;
      const scale = this._zoomLevel === "galaxy" ? 0.001 : this._zoomLevel === "region" ? 0.65 : 1;
      mesh.visible = alpha > 0.01;
      group.scale.setScalar(scale);
    }

    for (const { line } of this.synapseLines) {
      line.userData.lodBase = cfg.synapseAlpha;
    }

    if (this.labelLayer) {
      const showWorkflowLabels = this._zoomLevel !== "galaxy";
      for (const [, { btn }] of this.labelEls) {
        btn.style.opacity = showWorkflowLabels ? "1" : "0";
        btn.style.pointerEvents = showWorkflowLabels ? "auto" : "none";
      }
    }

    this._updateClusterPositions();
    this._updateDetailLabels();
  }

  zoomBy(factor) {
    if (this._flyAnim) return;
    const dir = new THREE.Vector3().subVectors(this.camera.position, this.controls.target);
    const len = dir.length();
    if (len < 1e-6) dir.set(0.2, 0.8, 1.1);
    dir.normalize();
    const dist = this._cameraDistance();
    const next = THREE.MathUtils.clamp(dist * factor, this.controls.minDistance, this.controls.maxDistance);
    this.camera.position.copy(this.controls.target).addScaledVector(dir, next);
    this.controls.update();
  }

  zoomIn() {
    this.zoomBy(0.78);
    this.controls.autoRotate = false;
    clearTimeout(this._idleTimer);
  }

  zoomOut() {
    this.zoomBy(1.28);
    this.controls.autoRotate = false;
    clearTimeout(this._idleTimer);
  }

  ensureClusters() {
    if (!this.clusters || !Object.keys(this.clusters).length) {
      this._rebuildClusters();
    }
    return this.clusters;
  }

  _clusterAnchor(cluster) {
    const members = cluster.members || [];
    if (!members.length) return null;

    const byId = members.find((n) => n.id === cluster.key);
    if (byId) return byId;

    const repo = members.find((n) => n.type === "repository");
    if (repo) return repo;

    const workflow = members.find((n) => n.type === "workflow");
    if (workflow) return workflow;

    let best = members[0];
    let bestScore = -Infinity;
    for (const n of members) {
      const imp = n.importance ?? 0.5;
      const dist = cluster.centroid.distanceTo(this._pos(n));
      const score = imp * 3 - dist * 0.85;
      if (score > bestScore) {
        bestScore = score;
        best = n;
      }
    }
    return best;
  }

  _pinLikeDistance(anchor, cluster) {
    if (anchor?.type === "repository") return 1.28;
    if (anchor?.type === "workflow") return 1.65;
    if (anchor?.type === "note") return 1.05;
    if (anchor) {
      return THREE.MathUtils.clamp(0.62 + (anchor.importance || 0.5) * 0.38, 0.5, 1.18);
    }
    return THREE.MathUtils.clamp(0.7 + cluster.radius * 0.12, 0.55, 1.1);
  }

  resetView() {
    this.clearClusterFocus();
    this._flyTo(this._defaultView.target.clone(), this._defaultView.distance, this._defaultView.position.clone());
  }

  clearClusterFocus() {
    this._focusedClusterKey = null;
    this._focusedClusterIds = null;
    this._focusedClusterColor = 0x00e8ff;
    this._updateSynapseHighlights();
    this._updateHighlights();
  }

  _clusterFlyDistance(cluster, anchor = null) {
    return this._pinLikeDistance(anchor, cluster);
  }

  locateCluster(key) {
    const cluster = this.clusters[key];
    if (!cluster) return false;

    if (this._suspended) this.suspendRendering(false);

    const anchor = this._clusterAnchor(cluster);
    const flyTarget = anchor ? this._pos(anchor).clone() : cluster.centroid.clone();
    const dist = this._pinLikeDistance(anchor, cluster);

    this.selectedId = null;
    this._focusedClusterKey = key;
    this._focusedClusterIds = new Set((cluster.members || []).map((n) => n.id));
    this._focusedClusterColor = cluster.color
      ? parseInt(String(cluster.color).replace("#", ""), 16)
      : 0x00e8ff;

    this._flyTo(flyTarget, dist);
    this.controls.autoRotate = false;
    clearTimeout(this._idleTimer);
    this._updateSynapseHighlights();
    this._updateHighlights();
    this._syncLabelSelection();
    return true;
  }

  focusCluster(key) {
    return this.locateCluster(key);
  }

  focusOnNeuron(id) {
    const n = this.neurons.find((x) => x.id === id);
    if (!n) return;
    const pos = this._pos(n);
    const isBig = n.type === "workflow" || n.type === "repository";
    const dist = isBig ? 2.2 : THREE.MathUtils.clamp(0.85 + (n.importance || 0.5) * 0.5, 0.55, 1.6);
    this._flyTo(pos, dist);
    this.controls.autoRotate = false;
    clearTimeout(this._idleTimer);
  }

  locateNeuron(id) {
    const n = this.neurons.find((x) => x.id === id);
    if (!n) return false;
    this.clearClusterFocus();
    this.focusOnNeuron(id);
    this.selectedId = n.id;
    this._updateHighlights();
    this._syncLabelSelection();
    this.controls.autoRotate = false;
    clearTimeout(this._idleTimer);
    return true;
  }

  _flyTo(target, distance, optionalPosition = null) {
    if (this._flyAnim) cancelAnimationFrame(this._flyAnim.raf);

    const startTarget = this.controls.target.clone();
    const startPos = this.camera.position.clone();
    const endTarget = target.clone();
    let endPos = optionalPosition;
    if (!endPos) {
      let dir = new THREE.Vector3().subVectors(startPos, startTarget);
      if (dir.lengthSq() < 1e-6) dir.set(0.25, 0.85, 1.05);
      dir.normalize();
      endPos = endTarget.clone().addScaledVector(dir, distance);
    }

    const t0 = performance.now();
    const duration = 820;
    const ease = (x) => 1 - Math.pow(1 - x, 3);

    const step = (now) => {
      const t = Math.min(1, (now - t0) / duration);
      const e = ease(t);
      this.controls.target.lerpVectors(startTarget, endTarget, e);
      this.camera.position.lerpVectors(startPos, endPos, e);
      this.controls.update();
      this._updateLOD();
      if (t < 1) {
        this._flyAnim = { raf: requestAnimationFrame(step) };
      } else {
        this._flyAnim = null;
        this.controls.update();
        this._updateLOD();
      }
    };
    this._flyAnim = { raf: requestAnimationFrame(step) };
  }

  _projectToScreen(pos, rect) {
    this._vecProj.copy(pos);
    this._vecProj.project(this.camera);
    if (this._vecProj.z > 1) return null;
    return {
      x: (this._vecProj.x * 0.5 + 0.5) * rect.width,
      y: (-this._vecProj.y * 0.5 + 0.5) * rect.height,
    };
  }

  _pickNeuronAtScreen(clientX, clientY) {
    const rect = this.interactionEl.getBoundingClientRect();
    const mx = clientX - rect.left;
    const my = clientY - rect.top;
    let best = null;
    let bestDist = Infinity;
    const zoomBoost = this._zoomLevel === "synapse" ? 1.45 : this._zoomLevel === "network" ? 1.15 : 1;

    for (const n of this.neurons) {
      if (this._zoomLevel === "galaxy" && n.type !== "workflow" && n.type !== "repository") continue;
      const pos = this._pos(n);
      const screen = this._projectToScreen(pos, rect);
      if (!screen) continue;
      let threshold = n.type === "workflow" || n.type === "repository" ? 64 : n.type === "note" ? 36 : 32;
      threshold *= zoomBoost;
      const d = Math.hypot(mx - screen.x, my - screen.y);
      if (d <= threshold && d < bestDist) {
        bestDist = d;
        best = n;
      }
    }
    return best;
  }

  _scheduleAutoRotate() {
    clearTimeout(this._idleTimer);
    if (this.paused) return;
    this._idleTimer = setTimeout(() => {
      if (!this.paused) {
        this.controls.autoRotate = true;
      }
    }, 5000);
  }

  _selectNeuron(n) {
    if (!n) {
      this.clearSelection();
      this.onSelect(null);
      return;
    }
    this.clearClusterFocus();
    this.selectedId = n.id;
    this._updateHighlights();
    this._syncLabelSelection();
    this.controls.autoRotate = false;
    clearTimeout(this._idleTimer);
    this.onSelect(n);
  }

  _syncLabelSelection() {
    for (const [id, { btn }] of this.labelEls) {
      const isSel = id === this.selectedId;
      const isHov = id === this._hoveredNeuronId;
      btn.classList.toggle("selected", isSel);
      btn.classList.toggle("hovered", isHov && !isSel);
    }
  }

  _rebuildLabels() {
    if (!this.labelLayer) return;
    this.labelLayer.innerHTML = "";
    this.labelEls.clear();

    for (const n of this.neurons) {
      if (n.type !== "workflow" && n.type !== "repository") continue;

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "neuron-3d-label workflow" + (n.type === "repository" ? " repository" : "");
      btn.textContent = n.label;
      btn.title = n.content_preview || n.label;
      btn.dataset.neuronId = n.id;
      const stop = (e) => e.stopPropagation();
      btn.addEventListener("pointerdown", stop);
      btn.addEventListener("mousedown", stop);
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        this._selectNeuron(n);
      });
      btn.addEventListener("mouseenter", (e) => {
        this._setHovered(n.id);
        const r = btn.getBoundingClientRect();
        this.onHover(n, r.left + r.width / 2, r.top);
      });
      btn.addEventListener("mouseleave", () => {
        this._setHovered(null);
        this.onHover(null, 0, 0);
      });
      this.labelLayer.appendChild(btn);
      this.labelEls.set(n.id, { btn, pos: this._pos(n) });
    }
    this._syncLabelSelection();
  }

  _updateLabelPositions() {
    if (!this.labelEls.size) return;
    const rect = this.interactionEl.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;
    if (!w || !h) return;

    for (const [, { btn, pos }] of this.labelEls) {
      const screen = this._projectToScreen(pos, { width: w, height: h });
      if (!screen) {
        btn.style.visibility = "hidden";
        btn.style.pointerEvents = "none";
        continue;
      }
      btn.style.visibility = "visible";
      btn.style.pointerEvents = "auto";
      btn.style.left = `${screen.x}px`;
      btn.style.top = `${screen.y}px`;
    }
  }

  _setHovered(id) {
    if (id === this._hoveredNeuronId) return;
    this._hoveredNeuronId = id;
    this._updateHighlights();
  }

  _updatePointer(e) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  }

  async loadGraph() {
    try {
      const res = await fetch("/api/neurons");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      this.setNeurons((data.neurons || []).filter((n) => n.id !== "core"));
    } catch (err) {
      console.error("Brain3D: error cargando neuronas", err);
    }
  }

  setNeurons(neurons) {
    this.neurons = neurons;
    this._rebuildSemanticLayer();
    this._rebuildClusters();
  }

  _createTronNode(color, radius) {
    const node = new THREE.Group();

    const core = new THREE.Mesh(
      new THREE.SphereGeometry(radius * 0.35, 4, 4),
      new THREE.MeshBasicMaterial({
        color: TRON_CORE,
        transparent: true,
        opacity: 0.92,
        depthWrite: false,
      })
    );

    const cage = new THREE.Mesh(
      new THREE.OctahedronGeometry(radius, 0),
      new THREE.MeshBasicMaterial({
        color,
        wireframe: true,
        transparent: true,
        opacity: 0.82,
        depthWrite: false,
      })
    );

    const arm = radius * 1.15;
    const crossGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-arm, 0, 0),
      new THREE.Vector3(arm, 0, 0),
      new THREE.Vector3(0, -arm, 0),
      new THREE.Vector3(0, arm, 0),
      new THREE.Vector3(0, 0, -arm),
      new THREE.Vector3(0, 0, arm),
    ]);
    const cross = new THREE.LineSegments(
      crossGeo,
      new THREE.LineBasicMaterial({
        color,
        transparent: true,
        opacity: 0.45,
        depthWrite: false,
      })
    );

    node.add(core, cage, cross);
    return { node, core, cage, cross };
  }

  _pos(n) {
    const p = n.position_hint || {};
    return new THREE.Vector3(p.x || 0, p.y || 0, p.z || 0);
  }

  _rebuildSemanticLayer() {
    this.neuronGroup.clear();
    this.synapseGroup.clear();
    this.meshes.clear();
    this.synapseLines = [];
    this.pulses = [];

    const positions = new Map();
    for (const n of this.neurons) positions.set(n.id, this._pos(n));
    positions.set("core", this.corePos.clone());

    for (const n of this.neurons) {
      if (n.id === "core") continue;
      const pos = positions.get(n.id);
      const color = TYPE_COLORS[n.type] || TYPE_COLORS.memory;
      const isWorkflow = n.type === "workflow" || n.type === "repository";

      const group = new THREE.Group();
      let mesh = null;

      const hitMat = new THREE.MeshBasicMaterial({
        transparent: true,
        opacity: 0,
        depthWrite: false,
      });

      if (isWorkflow) {
        const hitArea = new THREE.Mesh(new THREE.SphereGeometry(0.12, 6, 6), hitMat);
        hitArea.position.copy(pos);
        group.add(hitArea);
        group.userData = { neuron: n, mesh, hitArea, labelOnly: true };
        hitArea.userData.parentGroup = group;
      } else {
        const radius = 0.014 + (n.importance || 0.5) * 0.012;
        const hitRadius = 0.14;

        const hitArea = new THREE.Mesh(new THREE.SphereGeometry(hitRadius, 6, 6), hitMat);
        hitArea.position.copy(pos);

        const tron = this._createTronNode(color, radius);
        tron.node.position.copy(pos);

        group.add(hitArea, tron.node);
        group.userData = {
          neuron: n,
          mesh: tron.node,
          core: tron.core,
          cage: tron.cage,
          cross: tron.cross,
          hitArea,
          labelOnly: false,
        };
        hitArea.userData.parentGroup = group;
      }

      this.neuronGroup.add(group);
      this.meshes.set(n.id, group);
    }

    this._pickTargets = [];
    for (const g of this.neuronGroup.children) {
      if (g.userData.hitArea) this._pickTargets.push(g.userData.hitArea);
    }

    const drawn = new Set();
    for (const n of this.neurons) {
      const a = positions.get(n.id);
      if (!a) continue;
      for (const targetId of n.connections || []) {
        const key = [n.id, targetId].sort().join("|");
        if (drawn.has(key)) continue;
        drawn.add(key);
        const b = positions.get(targetId);
        if (!b) continue;
        this._addSynapse(a, b, n.type, n.id, targetId);
      }
    }
    this._updateSynapseHighlights();
    this._updateHighlights();
    this._rebuildLabels();
  }

  _addSynapse(a, b, type, fromId, toId) {
    const synColor = SYNAPSE_COLORS[type] || SYNAPSE_COLORS.memory;
    const pts = new THREE.LineCurve3(a, b).getPoints(10);
    const positions = pts.flatMap((p) => [p.x, p.y, p.z]);

    const line = new THREE.Line(
      new THREE.BufferGeometry().setAttribute(
        "position",
        new THREE.Float32BufferAttribute(positions, 3)
      ),
      new THREE.LineBasicMaterial({
        color: synColor,
        transparent: true,
        opacity: 0.38,
        depthWrite: false,
      })
    );
    line.userData.fromId = fromId;
    line.userData.toId = toId;
    this.synapseGroup.add(line);

    const matrixLine = new THREE.Line(
      new THREE.BufferGeometry().setAttribute(
        "position",
        new THREE.Float32BufferAttribute(positions, 3)
      ),
      new THREE.LineBasicMaterial({
        color: 0x00ff9f,
        transparent: true,
        opacity: 0.1,
        depthWrite: false,
      })
    );
    this.synapseGroup.add(matrixLine);
    this.synapseLines.push({ line, matrix: matrixLine, type, fromId, toId });
  }

  _updateSynapseHighlights() {
    const ids = this._focusedClusterIds;
    const colorHex = this._focusedClusterColor || 0x00e8ff;

    for (const { line, matrix, type, fromId, toId } of this.synapseLines) {
      const defaultColor = SYNAPSE_COLORS[type] || SYNAPSE_COLORS.memory;
      if (!ids?.size) {
        line.material.color.setHex(defaultColor);
        matrix.material.color.setHex(0x00ff9f);
        continue;
      }

      const touches = ids.has(fromId) || ids.has(toId);
      const internal = ids.has(fromId) && ids.has(toId);
      if (touches) {
        line.material.color.setHex(internal ? colorHex : 0x00ffcc);
        matrix.material.color.setHex(colorHex);
      } else {
        line.material.color.setHex(0x2a3548);
        matrix.material.color.setHex(0x1a2535);
      }
    }
  }

  setSelected(id) {
    this.selectedId = id || null;
    this._updateHighlights();
    this._syncLabelSelection();
  }

  clearSelection() {
    this.selectedId = null;
    this._updateHighlights();
    this._syncLabelSelection();
  }

  setActive(id) {
    this.activeId = id || null;
    this._updateHighlights();
  }

  setPaused(p) {
    this.paused = !!p;
    if (p) {
      clearTimeout(this._idleTimer);
      this.controls.autoRotate = false;
    } else if (!this._suspended) {
      this._scheduleAutoRotate();
    }
  }

  suspendRendering(suspend) {
    this._suspended = !!suspend;
    if (suspend) {
      this.paused = true;
      this.controls.enabled = false;
      this.controls.autoRotate = false;
      clearTimeout(this._idleTimer);
      if (this._savedPixelRatio == null) {
        this._savedPixelRatio = this.renderer.getPixelRatio();
      }
      this.renderer.setPixelRatio(1);
      if (this._animateRaf) {
        cancelAnimationFrame(this._animateRaf);
        this._animateRaf = null;
      }
      return;
    }
    this.paused = false;
    if (this._savedPixelRatio != null) {
      this.renderer.setPixelRatio(this._savedPixelRatio);
      this._savedPixelRatio = null;
    }
    this.controls.enabled = this._interactionEnabled;
    this._scheduleAutoRotate();
    if (!this._animateRaf) this._animate();
  }

  setInteractionEnabled(on) {
    this._interactionEnabled = !!on;
    this.controls.enabled = on && !this._suspended;
    if (on) {
      this.interactionEl.style.touchAction = "none";
      this.interactionEl.style.cursor = "grab";
    } else {
      this.interactionEl.style.touchAction = "auto";
      this.interactionEl.style.cursor = "default";
    }
  }

  _updateHighlights() {
    for (const [id, group] of this.meshes) {
      const { neuron, mesh, core, cage, cross, labelOnly } = group.userData;
      if (labelOnly) continue;
      if (!mesh || !cage) continue;
      const color = TYPE_COLORS[neuron.type] || TYPE_COLORS.memory;
      const isSel = id === this.selectedId;
      const isAct = id === this.activeId;
      const isHov = id === this._hoveredNeuronId;
      const inCluster = this._focusedClusterIds?.has(id);
      const activeColor = isAct ? TRON_CORE : color;
      cage.material.color.setHex(activeColor);
      if (cross) cross.material.color.setHex(activeColor);
      if (core) core.material.opacity = isSel || isHov || inCluster ? 1 : 0.75;
      cage.material.opacity = isSel ? 1 : isHov ? 0.95 : inCluster ? 0.94 : isAct ? 0.88 : 0.72;
      const s = isSel ? 1.7 : isHov ? 1.35 : inCluster ? 1.28 : isAct ? 1.2 : 1;
      mesh.scale.setScalar(s);
    }
    this._syncLabelSelection();
  }

  _handleHover(clientX, clientY) {
    const n = this._pickNeuronAtScreen(clientX, clientY);
    this._setHovered(n?.id || null);
    if (n) {
      this.onHover(n, clientX, clientY);
      this.interactionEl.style.cursor = "pointer";
    } else {
      this.onHover(null, clientX, clientY);
      this.interactionEl.style.cursor = "grab";
    }
  }

  _handleClick() {
    /* legacy — container click handler llama _selectNeuron directamente */
  }

  _animateHotspots() {
    /* hotspots estáticos — sin pulso */
  }

  _animateDecorative() {
    if (this.coreGlow) {
      const cp = 0.12 + Math.sin(this.time * 1.6) * 0.08;
      this.coreGlow.material.opacity = cp + 0.15;
    }
  }

  _animatePulses() {
    const ids = this._focusedClusterIds;
    const pulse = ids?.size ? 0.88 + Math.sin(this.time * 3.4) * 0.12 : 1;

    for (const { line, matrix, fromId, toId } of this.synapseLines) {
      const base = line.userData.lodBase ?? 0.32;
      if (!ids?.size) {
        line.material.opacity = base;
        if (matrix) matrix.material.opacity = base * 0.28;
        continue;
      }

      const touches = ids.has(fromId) || ids.has(toId);
      const internal = ids.has(fromId) && ids.has(toId);
      if (touches) {
        const glow = internal ? 0.82 : 0.58;
        line.material.opacity = Math.min(1, glow * pulse + 0.12);
        if (matrix) matrix.material.opacity = Math.min(0.55, line.material.opacity * 0.5);
      } else {
        line.material.opacity = 0.025;
        if (matrix) matrix.material.opacity = 0.01;
      }
    }
  }

  _animate() {
    if (this._suspended) {
      this._animateRaf = null;
      return;
    }
    this._animateRaf = requestAnimationFrame(this._animate);
    if (!this.paused) {
      this.time += 0.016;
      this._animateHotspots();
      this._animateDecorative();
      this._animatePulses();
    }
    this.controls.update();
    this._updateLOD();
    this._updateLabelPositions();
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    window.removeEventListener("resize", this._onResize);
    if (this._resizeObs) this._resizeObs.disconnect();
    if (this._wheelRaf) cancelAnimationFrame(this._wheelRaf);
    if (this._onWheel) this.interactionEl.removeEventListener("wheel", this._onWheel, { capture: true });
    if (this._animateRaf) cancelAnimationFrame(this._animateRaf);
    clearTimeout(this._idleTimer);
    if (this._hoverRaf) cancelAnimationFrame(this._hoverRaf);
    if (this._flyAnim) cancelAnimationFrame(this._flyAnim.raf);
    this.controls.dispose();
    this.renderer.dispose();
  }
}
