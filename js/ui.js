// Screens, HUD, hallmark/gene menu and the tick timer.
(function () {
  const { HALLMARKS, TISSUES, ORIGINS } = window.TumorData;
  const { CFG, createSim } = window.TumorSim;
  const View = window.TumorView;
  const $ = (id) => document.getElementById(id);
  const pct = (v, digits = 0) => (v * 100).toFixed(digits) + '%';

  let sim = null;
  let phase = 'setup';            // setup | prep | running | paused | ended
  let timer = null;
  let choice = { tissue: TISSUES[0], origin: ORIGINS[0] };
  const geneEls = {};             // gene id → { row, pips, btn }
  const hallmarkEls = {};         // hallmark id → { box, bar, mult }

  // ---- setup screen --------------------------------------------------------
  function buildChoices(container, options, key) {
    container.innerHTML = '';
    options.forEach((o) => {
      const b = document.createElement('button');
      b.className = 'choice' + (choice[key] === o ? ' selected' : '');
      b.innerHTML = `<span class="c-icon">${o.icon}</span><span class="c-name">${o.name}</span><span class="c-note">${o.note}</span>`;
      b.onclick = () => { choice[key] = o; buildChoices(container, options, key); };
      container.appendChild(b);
    });
  }

  // ---- hallmark / gene menu --------------------------------------------------
  function buildMenu() {
    const host = $('hallmarks');
    host.innerHTML = '';
    HALLMARKS.forEach((h) => {
      const box = document.createElement('div');
      box.className = 'hallmark' + (h.special ? ' special' : '');
      box.innerHTML = `
        <button class="hm-head">
          <span class="hm-icon">${h.icon}</span>
          <span><span class="hm-name">${h.name}</span><div class="bar"><i></i></div></span>
          <span class="hm-mult"></span>
        </button>
        <div class="hm-body"><div class="hm-blurb">${h.blurb}</div></div>`;
      box.querySelector('.hm-head').onclick = () => {
        const wasOpen = box.classList.contains('open');
        host.querySelectorAll('.hallmark.open').forEach((el) => el.classList.remove('open'));
        if (!wasOpen) box.classList.add('open');
      };
      const body = box.querySelector('.hm-body');
      h.genes.forEach((g) => {
        const row = document.createElement('div');
        row.className = 'gene';
        row.innerHTML = `
          <div><span class="gene-name">${g.label}</span><span class="pips"><i></i><i></i><i></i></span></div>
          <button></button>
          <div class="gene-desc">${g.desc}</div>`;
        const btn = row.querySelector('button');
        btn.onclick = () => { if (sim && sim.buy(g.id)) { View.update(sim); refresh(); } };
        geneEls[g.id] = { row, pips: row.querySelectorAll('.pips i'), btn };
        body.appendChild(row);
      });
      hallmarkEls[h.id] = { box, bar: box.querySelector('.bar > i'), mult: box.querySelector('.hm-mult') };
      host.appendChild(box);
    });
  }

  // ---- HUD refresh -----------------------------------------------------------
  function refresh() {
    if (!sim) return;
    $('sCells').textContent = sim.tumor.length.toLocaleString();
    $('sPoints').textContent = sim.points.toLocaleString();
    $('sTick').textContent = sim.tick;
    $('sFill').textContent = `${pct(sim.tumor.length / sim.capacity)} / ${pct(CFG.thriveFraction)}`;
    $('sGrowth').textContent = '×' + sim.growthMultiplier().toFixed(2);
    $('sDeath').textContent = pct(sim.deathProb(), 1);
    $('sRange').textContent = sim.vesselRange().toFixed(1) + ' cells';
    $('sHypoxic').textContent = pct(sim.hypoxicFraction());
    $('sMut').textContent = pct(sim.mutationProb(), 2);

    HALLMARKS.forEach((h) => {
      const el = hallmarkEls[h.id];
      if (h.special) {
        el.bar.style.width = pct(sim.instabilityScore());
        el.mult.textContent = pct(sim.mutationProb(), 2) + ' / step';
      } else {
        el.bar.style.width = pct(sim.hallmarkProgress(h.id));
        el.mult.textContent = '×' + sim.hallmarkMultiplier(h.id).toFixed(2);
      }
      h.genes.forEach((g) => {
        const ge = geneEls[g.id], lvl = sim.levels[g.id], cost = sim.costFor(g.id);
        ge.pips.forEach((p, k) => p.classList.toggle('on', k < lvl));
        ge.btn.textContent = cost === null ? 'MAX' : `Mutate · ${cost} pts`;
        ge.btn.disabled = phase === 'ended' || !sim.canBuy(g.id);
      });
    });

    const play = $('btnPlay');
    play.textContent = phase === 'prep' ? 'Begin growth' : phase === 'running' ? 'Pause' : 'Resume';
    play.disabled = phase === 'ended';
    $('btnStep').disabled = phase === 'ended';
    $('btnEnd').disabled = phase === 'ended';
    $('phase').textContent = {
      prep: `${choice.tissue.name} · ${choice.origin.name} — spend your starting mutations`,
      running: `${choice.tissue.name} · ${choice.origin.name} — growing`,
      paused: `${choice.tissue.name} · ${choice.origin.name} — paused`,
      ended: 'Run over',
    }[phase] || '';
  }

  // ---- notifications -----------------------------------------------------------
  function log(text, cls) {
    const d = document.createElement('div');
    if (cls) d.className = cls;
    d.textContent = `t${sim.tick} · ${text}`;
    $('log').prepend(d);
    while ($('log').children.length > 80) $('log').lastChild.remove();
  }
  function toast(text, cls) {
    const host = $('toasts');
    const d = document.createElement('div');
    d.className = 'toast ' + (cls || '');
    d.textContent = text;
    host.appendChild(d);
    while (host.children.length > 5) host.firstChild.remove();
    setTimeout(() => d.remove(), 4000);
  }
  function announceMutation(m) {
    const up = m.delta > 0;
    const text = `Random mutation: ${m.gene.label} level ${up ? 'increased' : 'decreased'} to ${m.level}!`;
    toast(text, up ? 'up' : 'down');
    log(text, up ? 'up' : 'down');
    const row = geneEls[m.gene.id].row;
    row.classList.remove('flash-up', 'flash-down');
    void row.offsetWidth; // restart the animation
    row.classList.add(up ? 'flash-up' : 'flash-down');
  }

  // ---- game loop ---------------------------------------------------------------
  function stopTimer() { clearInterval(timer); timer = null; }
  function startTimer() {
    stopTimer();
    timer = setInterval(doTick, 1000 / Number($('speed').value));
  }
  function doTick() {
    const res = sim.step();
    if (!res) return;
    res.mutations.forEach(announceMutation);
    View.update(sim);
    if (sim.status !== 'running') return finish(sim.status);
    refresh();
  }
  function beginGrowth() {
    phase = 'running';
    $('banner').classList.add('hidden');
    View.showSeedMarker(false);
    startTimer();
    refresh();
  }

  function newRun() {
    stopTimer();
    sim = createSim({ tissue: choice.tissue, origin: choice.origin });
    phase = 'prep';
    $('setup').classList.add('hidden');
    $('end').classList.add('hidden');
    $('log').innerHTML = '';
    $('toasts').innerHTML = '';
    $('banner').innerHTML = `You have <b>${sim.points}</b> mutation points. Open a hallmark on the right and
      mutate genes, then press <b>Begin growth</b>.<br>Your first cell is the flashing box.`;
    $('banner').classList.remove('hidden');
    document.querySelectorAll('.hallmark.open').forEach((el) => el.classList.remove('open'));
    View.build(sim);
    View.showSeedMarker(true);
    refresh();
  }

  // ---- end screen ----------------------------------------------------------------
  function finish(outcome) {
    stopTimer();
    phase = 'ended';
    refresh();
    const titles = {
      cleared: ['The tumor was eliminated', 'Every tumor cell died before the clone could establish itself. The tissue is healthy again.'],
      thriving: ['The tumor is thriving', `Your clone has taken over ${pct(sim.tumor.length / sim.capacity)} of the tissue.`],
      stopped: ['Run ended', 'You stopped the simulation. Here is how your tumor was doing.'],
    }[outcome];
    $('endTitle').textContent = titles[0];
    $('endText').textContent = titles[1];

    const s = sim.stats;
    const stats = [
      ['Time survived', sim.tick],
      ['Final tumor cells', sim.tumor.length.toLocaleString()],
      ['Peak tumor cells', s.peak.toLocaleString()],
      ['Cells born', s.born.toLocaleString()],
      ['Cells died', s.died.toLocaleString()],
      ['Random mutations', s.randomMutations],
      ['Points spent', s.spent],
      ['Points unspent', sim.points],
      ['Growth multiplier', '×' + sim.growthMultiplier().toFixed(2)],
    ];
    $('endStats').innerHTML = stats
      .map(([k, v]) => `<div class="stat"><span>${k}</span><b>${v}</b></div>`).join('');
    $('endGenes').innerHTML = HALLMARKS.map((h) => `
      <div class="end-hm">
        <div>${h.icon} ${h.name}</div>
        <div>${h.genes.map((g) => `<span class="g">${g.id} <b>${sim.levels[g.id]}</b></span>`).join('')}</div>
      </div>`).join('');
    $('end').classList.remove('hidden');
  }

  // ---- wiring ----------------------------------------------------------------------
  $('btnStart').onclick = newRun;
  $('btnAgain').onclick = () => {
    phase = 'setup';
    $('end').classList.add('hidden');
    $('setup').classList.remove('hidden');
  };
  $('btnPlay').onclick = () => {
    if (phase === 'prep' || phase === 'paused') beginGrowth();
    else if (phase === 'running') { stopTimer(); phase = 'paused'; refresh(); }
  };
  $('btnStep').onclick = () => {
    if (phase === 'ended' || !sim) return;
    if (phase === 'prep') { $('banner').classList.add('hidden'); View.showSeedMarker(false); }
    if (phase !== 'running') phase = 'paused';
    doTick();
  };
  $('btnEnd').onclick = () => { if (sim && phase !== 'ended') finish('stopped'); };
  $('speed').onchange = () => { if (phase === 'running') startTimer(); };

  if (!window.THREE) {
    document.body.innerHTML = '<p style="padding:24px">Could not load Three.js from the CDN. Check your internet connection and reload.</p>';
    return;
  }
  buildChoices($('tissueChoices'), TISSUES, 'tissue');
  buildChoices($('originChoices'), ORIGINS, 'origin');
  buildMenu();
  View.init($('canvas'));
})();
