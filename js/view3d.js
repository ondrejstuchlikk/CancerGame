// Three.js view of the grid. Instanced cubes: faint dots for normal tissue,
// red for vessels, full cubes for tumor cells coloured by their nutrient supply.
(function (root) {
  const { NORMAL, TUMOR } = root.TumorSim;

  // nutrient colour ramp for tumor cells: starved → borderline → well supplied
  const RAMP = [new THREE.Color(0x3547e8), new THREE.Color(0xd63ac0), new THREE.Color(0xffc53d)];
  const NORMAL_LOW = new THREE.Color(0x27303f), NORMAL_HIGH = new THREE.Color(0x9fb4c8);
  const tmpColor = new THREE.Color();
  const dummy = new THREE.Object3D();

  function tumorColor(n) {
    const t = Math.max(0, Math.min(1, (n - 0.1) / 0.9));
    return t < 0.5
      ? tmpColor.copy(RAMP[0]).lerp(RAMP[1], t * 2)
      : tmpColor.copy(RAMP[1]).lerp(RAMP[2], (t - 0.5) * 2);
  }

  let renderer, scene, camera, container;
  let group = null, meshNormal, meshTumor, seedMarker;
  const orbit = { theta: 0.7, phi: 1.05, radius: 34, dragging: false, lastX: 0, lastY: 0 };

  function placeCamera() {
    const { theta, phi, radius } = orbit;
    camera.position.set(
      radius * Math.sin(phi) * Math.sin(theta),
      radius * Math.cos(phi),
      radius * Math.sin(phi) * Math.cos(theta),
    );
    camera.lookAt(0, 0, 0);
  }

  function resize() {
    const w = container.clientWidth, h = container.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  function init(el) {
    container = el;
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x0d1117);
    container.appendChild(renderer.domElement);

    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(45, 1, 0.1, 500);
    scene.add(new THREE.AmbientLight(0xffffff, 0.75));
    const sun = new THREE.DirectionalLight(0xffffff, 0.6);
    sun.position.set(1, 2, 1.5);
    scene.add(sun);

    const dom = renderer.domElement;
    dom.addEventListener('pointerdown', (e) => {
      orbit.dragging = true; orbit.lastX = e.clientX; orbit.lastY = e.clientY;
      dom.setPointerCapture(e.pointerId);
    });
    dom.addEventListener('pointermove', (e) => {
      if (!orbit.dragging) return;
      orbit.theta -= (e.clientX - orbit.lastX) * 0.008;
      orbit.phi = Math.max(0.15, Math.min(Math.PI - 0.15, orbit.phi - (e.clientY - orbit.lastY) * 0.008));
      orbit.lastX = e.clientX; orbit.lastY = e.clientY;
    });
    dom.addEventListener('pointerup', () => { orbit.dragging = false; });
    dom.addEventListener('pointercancel', () => { orbit.dragging = false; });
    dom.addEventListener('wheel', (e) => {
      e.preventDefault();
      orbit.radius = Math.max(10, Math.min(90, orbit.radius * (e.deltaY > 0 ? 1.08 : 0.93)));
    }, { passive: false });

    new ResizeObserver(resize).observe(container);
    resize();

    (function frame(t) {
      requestAnimationFrame(frame);
      if (seedMarker && seedMarker.visible) seedMarker.scale.setScalar(1.6 + 0.5 * Math.sin(t / 250));
      placeCamera();
      renderer.render(scene, camera);
    })(0);
  }

  // Build meshes for a fresh simulation.
  function build(sim) {
    if (group) {
      scene.remove(group);
      group.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
    }
    group = new THREE.Group();
    group.position.set(-(sim.X - 1) / 2, -(sim.Y - 1) / 2, -(sim.Z - 1) / 2);
    scene.add(group);
    orbit.radius = Math.max(sim.X, sim.Y, sim.Z) * 1.7;

    const box = new THREE.BoxGeometry(1, 1, 1);
    const mk = (geometry, material, count) => {
      const m = new THREE.InstancedMesh(geometry, material, count);
      m.frustumCulled = false;
      for (let i = 0; i < count; i++) m.setColorAt(i, NORMAL_LOW); // allocate the colour buffer up front
      group.add(m);
      return m;
    };

    meshNormal = mk(new THREE.IcosahedronGeometry(0.5, 0),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.3, depthWrite: false }), sim.N);
    // Tumor cells are smooth, slightly overlapping spheres so the mass reads as soft tissue.
    meshTumor = mk(new THREE.IcosahedronGeometry(0.5, 2),
      new THREE.MeshPhongMaterial({ shininess: 35, specular: 0x333333 }), sim.N);

    // Vessels are drawn as smooth tubes through the vessel cells.
    const vesselMat = new THREE.MeshPhongMaterial({ color: 0xe5383b, emissive: 0x5a0f12, shininess: 60 });
    sim.vesselPaths.forEach((path) => {
      if (path.length < 2) return;
      const curve = new THREE.CatmullRomCurve3(path.map((p) => new THREE.Vector3(p[0], p[1], p[2])), false, 'centripetal');
      group.add(new THREE.Mesh(new THREE.TubeGeometry(curve, path.length * 4, 0.55, 10, false), vesselMat));
      [path[0], path[path.length - 1]].forEach((p) => {
        const cap = new THREE.Mesh(new THREE.SphereGeometry(0.55, 12, 8), vesselMat);
        cap.position.set(p[0], p[1], p[2]);
        group.add(cap);
      });
    });

    // pulsing wireframe so the single starting cell is easy to find
    seedMarker = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(1.8, 1.8, 1.8)), new THREE.LineBasicMaterial({ color: 0xffffff }),
    );
    const [sx, sy, sz] = sim.coords(sim.seed);
    seedMarker.position.set(sx, sy, sz);
    group.add(seedMarker);

    const outline = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(sim.X, sim.Y, sim.Z)),
      new THREE.LineBasicMaterial({ color: 0x30363d }),
    );
    outline.position.set((sim.X - 1) / 2, (sim.Y - 1) / 2, (sim.Z - 1) / 2);
    group.add(outline);

    update(sim);
  }

  // cheap deterministic per-cell noise in [0,1), so a cell keeps its shape between ticks
  const noise = (i, k) => { const v = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453; return v - Math.floor(v); };

  function update(sim) {
    const { X, Y, Z, state } = sim;
    // A tumor cell completely surrounded by other tumor cells can't be seen, so skip it.
    const buried = (x, y, z) => {
      if (x === 0 || y === 0 || z === 0 || x === X - 1 || y === Y - 1 || z === Z - 1) return false;
      for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (state[(x + dx) + X * ((y + dy) + Y * (z + dz))] === NORMAL) return false;
      }
      return true;
    };
    let nNormal = 0, nTumor = 0;
    for (let i = 0; i < sim.N; i++) {
      const s = state[i];
      if (s !== NORMAL && s !== TUMOR) continue;
      const [x, y, z] = sim.coords(i);
      if (s === TUMOR) {
        if (buried(x, y, z)) continue;
        // jittered position and size break up the grid
        dummy.position.set(x + (noise(i, 1) - 0.5) * 0.45, y + (noise(i, 2) - 0.5) * 0.45, z + (noise(i, 3) - 0.5) * 0.45);
        dummy.scale.setScalar(1.3 + noise(i, 4) * 0.4); dummy.updateMatrix();
        meshTumor.setMatrixAt(nTumor, dummy.matrix);
        meshTumor.setColorAt(nTumor, tumorColor(sim.nutrient[i]).multiplyScalar(0.88 + noise(i, 5) * 0.12));
        nTumor++;
      } else {
        dummy.position.set(x, y, z);
        dummy.scale.setScalar(0.14); dummy.updateMatrix();
        meshNormal.setMatrixAt(nNormal, dummy.matrix);
        const t = (sim.nutrient[i] - 0.1) / 0.9;
        meshNormal.setColorAt(nNormal, tmpColor.copy(NORMAL_LOW).lerp(NORMAL_HIGH, t));
        nNormal++;
      }
    }
    meshNormal.count = nNormal;
    meshTumor.count = nTumor;
    [meshNormal, meshTumor].forEach((m) => {
      m.instanceMatrix.needsUpdate = true;
      m.instanceColor.needsUpdate = true;
    });
  }

  function showSeedMarker(on) { if (seedMarker) seedMarker.visible = on; }

  root.TumorView = { init, build, update, showSeedMarker };
})(window);
