// Simulation core. No DOM access, so it can also be run headless in Node for balancing.
(function (root) {
  const { HALLMARKS } = root.TumorData;

  // All tunables in one place.
  const CFG = {
    gridX: 20, gridY: 12, gridZ: 20,
    startPoints: 50,
    costs: [10, 20, 35],        // cost to go 0→1, 1→2, 2→3
    maxLevel: 3,
    baseDivision: 0.16,         // per-tick division probability before multipliers
    baseDeath: 0.02,            // per-tick death probability before apoptosis resistance
    baseRange: 4,               // vessel supply range in grid cells
    nutrientMin: 0.1,
    seedMaxVesselDist: 1.5,     // the starting cell is placed within this distance of a vessel (0 = anywhere)
    thriveFraction: 0.7,        // "Thriving" when tumor fills this share of the non-vessel grid
    hypoxicBelow: 0.35,         // nutrient below this is reported as hypoxic in the HUD
  };

  const NORMAL = 0, TUMOR = 1, VESSEL = 2;

  const factor = (level) => 1 + 0.15 * level;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const randInt = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1));

  function createSim(opts) {
    const tissue = opts.tissue || {};
    const origin = opts.origin || {};
    const X = CFG.gridX, Y = CFG.gridY, Z = CFG.gridZ, N = X * Y * Z;
    const idx = (x, y, z) => x + X * (y + Y * z);
    const coords = (i) => [i % X, Math.floor(i / X) % Y, Math.floor(i / (X * Y))];

    const state = new Uint8Array(N);
    const vesselDist = new Float32Array(N);
    const nutrient = new Float32Array(N);
    const vesselCells = [];

    const levels = {};
    HALLMARKS.forEach((h) => h.genes.forEach((g) => { levels[g.id] = 0; }));

    const sim = {
      X, Y, Z, N, state, nutrient, vesselCells, levels, coords,
      tissue, origin,
      tumor: [],
      seed: -1,
      tick: 0,
      points: CFG.startPoints + (origin.bonusPoints || 0),
      status: 'running',        // running | cleared | thriving
      stats: { born: 0, died: 0, peak: 1, spent: 0, earned: 0, randomMutations: 0 },
    };
    sim.capacity = 0;

    // ---- vessels ---------------------------------------------------------
    function addVessel(i) {
      if (state[i] !== VESSEL) { state[i] = VESSEL; vesselCells.push(i); }
    }
    // Walk along one axis, occasionally drifting by one cell on the other two.
    function walk(pos, axis, length, wobble) {
      const dims = [X, Y, Z];
      const p = pos.slice();
      for (let s = 0; s < length && p[axis] < dims[axis]; s++) {
        addVessel(idx(p[0], p[1], p[2]));
        const next = p.slice();
        next[axis]++;
        if (Math.random() < wobble) {
          const other = [0, 1, 2].filter((a) => a !== axis)[randInt(0, 1)];
          next[other] = clamp(next[other] + (Math.random() < 0.5 ? -1 : 1), 1, dims[other] - 2);
          // fill the corner so the vessel stays connected
          const corner = p.slice();
          corner[other] = next[other];
          addVessel(idx(corner[0], corner[1], corner[2]));
        }
        p[0] = next[0]; p[1] = next[1]; p[2] = next[2];
      }
    }
    function buildVessels() {
      // 1: runs along X through the back half
      walk([0, randInt(2, Y - 3), randInt(2, Math.floor(Z / 2) - 2)], 0, X, 0.2);
      // 2: runs along Z through the far X half
      walk([randInt(Math.floor(X / 2) + 1, X - 3), randInt(2, Y - 3), 0], 2, Z, 0.2);
      // 3: vertical vessel in the remaining quadrant, with one side branch
      const vx = randInt(2, Math.floor(X / 2) - 2), vz = randInt(Math.floor(Z / 2) + 1, Z - 3);
      walk([vx, 0, vz], 1, Y, 0.15);
      walk([vx + 1, randInt(3, Y - 4), vz], 0, randInt(4, 6), 0.3);
    }
    function computeVesselDistances() {
      const vc = vesselCells.map(coords);
      for (let i = 0; i < N; i++) {
        const [x, y, z] = coords(i);
        let best = Infinity;
        for (let k = 0; k < vc.length; k++) {
          const dx = x - vc[k][0], dy = y - vc[k][1], dz = z - vc[k][2];
          const d = dx * dx + dy * dy + dz * dz;
          if (d < best) best = d;
        }
        vesselDist[i] = Math.sqrt(best);
      }
    }

    // ---- formulas (as specified) ------------------------------------------
    sim.hallmarkMultiplier = (hid) => {
      const genes = HALLMARKS.find((h) => h.id === hid).genes;
      return genes.reduce((s, g) => s + factor(levels[g.id]), 0) / genes.length;
    };
    sim.hallmarkProgress = (hid) => (sim.hallmarkMultiplier(hid) - 1.0) / 0.45;
    // Product of the 6 non-instability hallmark multipliers (nutrient is applied per cell).
    sim.growthMultiplier = () => HALLMARKS
      .filter((h) => !h.special)
      .reduce((p, h) => p * sim.hallmarkMultiplier(h.id), 1);
    sim.instabilityScore = () => {
      const genes = HALLMARKS.find((h) => h.id === 'instability').genes;
      return genes.reduce((s, g) => s + levels[g.id], 0) / genes.length / 3;
    };
    sim.mutationProb = () => 0.01 + sim.instabilityScore() * 0.14;
    sim.vesselRange = () => CFG.baseRange * (tissue.rangeMul || 1) * sim.hallmarkMultiplier('angio');
    sim.deathProb = () => CFG.baseDeath * (tissue.deathMul || 1) * (origin.deathMul || 1)
      / sim.hallmarkMultiplier('apoptosis');
    sim.baseDivision = () => CFG.baseDivision * (tissue.divMul || 1) * (origin.divMul || 1);

    sim.recomputeNutrient = () => {
      const range = sim.vesselRange();
      for (let i = 0; i < N; i++) {
        nutrient[i] = clamp(1 - vesselDist[i] / range, CFG.nutrientMin, 1.0);
      }
    };

    // ---- player actions ----------------------------------------------------
    sim.costFor = (geneId) => (levels[geneId] >= CFG.maxLevel ? null : CFG.costs[levels[geneId]]);
    sim.canBuy = (geneId) => {
      const c = sim.costFor(geneId);
      return c !== null && sim.points >= c && sim.status === 'running';
    };
    sim.buy = (geneId) => {
      if (!sim.canBuy(geneId)) return false;
      const c = sim.costFor(geneId);
      sim.points -= c;
      sim.stats.spent += c;
      levels[geneId]++;
      sim.recomputeNutrient();
      return true;
    };

    // ---- tick --------------------------------------------------------------
    const NEIGHBOURS = [];
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      if (dx || dy || dz) NEIGHBOURS.push([dx, dy, dz]);
    }
    function randomEmptyNeighbour(i) {
      const [x, y, z] = coords(i);
      let pick = -1, seen = 0;
      for (let k = 0; k < NEIGHBOURS.length; k++) {
        const nx = x + NEIGHBOURS[k][0], ny = y + NEIGHBOURS[k][1], nz = z + NEIGHBOURS[k][2];
        if (nx < 0 || ny < 0 || nz < 0 || nx >= X || ny >= Y || nz >= Z) continue;
        const j = idx(nx, ny, nz);
        if (state[j] !== NORMAL) continue;
        seen++;
        if (Math.random() * seen < 1) pick = j; // reservoir sample
      }
      return pick;
    }

    sim.step = () => {
      if (sim.status !== 'running') return null;
      sim.tick++;
      const cells = sim.tumor;
      const newborn = [];

      // 1. division
      const divBase = sim.baseDivision() * sim.growthMultiplier();
      for (let k = 0; k < cells.length; k++) {
        const c = cells[k];
        if (Math.random() < Math.min(1, divBase * nutrient[c])) {
          const j = randomEmptyNeighbour(c);
          if (j >= 0) { state[j] = TUMOR; newborn.push(j); }
        }
      }

      // 2. death (cells born this tick are not rolled until next tick)
      const pDeath = sim.deathProb();
      const survivors = [];
      let died = 0;
      for (let k = 0; k < cells.length; k++) {
        if (Math.random() < pDeath) { state[cells[k]] = NORMAL; died++; } else survivors.push(cells[k]);
      }
      sim.tumor = survivors.concat(newborn);

      // 3. income
      sim.points += newborn.length;
      sim.stats.earned += newborn.length;
      sim.stats.born += newborn.length;
      sim.stats.died += died;
      sim.stats.peak = Math.max(sim.stats.peak, sim.tumor.length);

      // 4. genomic instability
      const pMut = sim.mutationProb();
      const mutations = [];
      HALLMARKS.forEach((h) => h.genes.forEach((g) => {
        if (Math.random() >= pMut) return;
        const delta = Math.random() < 0.5 ? -1 : 1;
        const next = clamp(levels[g.id] + delta, 0, CFG.maxLevel);
        if (next === levels[g.id]) return; // clamped, nothing visible happened
        levels[g.id] = next;
        mutations.push({ gene: g, delta, level: next });
      }));
      if (mutations.length) {
        sim.stats.randomMutations += mutations.length;
        sim.recomputeNutrient();
      }

      if (sim.tumor.length === 0) sim.status = 'cleared';
      else if (sim.tumor.length >= sim.thriveTarget) sim.status = 'thriving';

      return { born: newborn.length, died, mutations };
    };

    sim.hypoxicFraction = () => {
      if (!sim.tumor.length) return 0;
      let n = 0;
      for (let k = 0; k < sim.tumor.length; k++) if (nutrient[sim.tumor[k]] < CFG.hypoxicBelow) n++;
      return n / sim.tumor.length;
    };

    // ---- init --------------------------------------------------------------
    buildVessels();
    computeVesselDistances();
    sim.recomputeNutrient();
    sim.capacity = N - vesselCells.length;
    sim.thriveTarget = Math.floor(sim.capacity * CFG.thriveFraction);

    const candidates = [];
    for (let i = 0; i < N; i++) {
      if (state[i] !== NORMAL) continue;
      if (!CFG.seedMaxVesselDist || vesselDist[i] <= CFG.seedMaxVesselDist) candidates.push(i);
    }
    sim.seed = candidates[randInt(0, candidates.length - 1)];
    state[sim.seed] = TUMOR;
    sim.tumor.push(sim.seed);

    return sim;
  }

  root.TumorSim = { CFG, createSim, NORMAL, TUMOR, VESSEL, factor };
})(typeof window !== 'undefined' ? window : globalThis);
