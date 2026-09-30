// Static game data: hallmarks, genes, tissues, cell types of origin.
(function (root) {
  const HALLMARKS = [
    {
      id: 'prolif', name: 'Proliferative Signaling', icon: '📈',
      blurb: 'Keep the "divide" signal switched on.',
      genes: [
        ['KRAS', 'KRAS', 'A GTPase that drives constant growth signaling when locked in its active state.'],
        ['EGFR', 'EGFR', 'A growth-factor receptor that fires without its ligand when mutated or amplified.'],
        ['BRAF', 'BRAF', 'A kinase in the MAPK pathway; the V600E mutation makes it signal non-stop.'],
        ['MYC', 'MYC', 'A master transcription factor that ramps up cell growth and metabolism when overexpressed.'],
        ['ERBB2', 'ERBB2 (HER2)', 'A receptor tyrosine kinase whose amplification floods the cell with growth signals.'],
      ],
    },
    {
      id: 'suppress', name: 'Evading Growth Suppressors', icon: '🚫',
      blurb: 'Cut the brakes on the cell cycle.',
      genes: [
        ['RB1', 'RB1', 'The gatekeeper of the G1/S checkpoint; losing it lets cells enter division unchecked.'],
        ['APC', 'APC', 'Restrains Wnt signaling by degrading β-catenin; its loss starts most colon tumors.'],
        ['PTEN', 'PTEN', 'A phosphatase that shuts down PI3K/AKT growth signaling.'],
        ['CDKN2A', 'CDKN2A', 'Encodes p16 and p14ARF, two brakes that protect the RB and p53 pathways.'],
        ['SMAD4', 'SMAD4', 'Relays the anti-growth TGF-β signal into the nucleus.'],
      ],
    },
    {
      id: 'apoptosis', name: 'Resisting Cell Death (Apoptosis)', icon: '🛡️',
      blurb: 'Ignore the order to self-destruct.',
      genes: [
        ['TP53', 'TP53', 'The "guardian of the genome" that triggers arrest or apoptosis after DNA damage.'],
        ['BCL2', 'BCL2', 'An anti-apoptotic protein that keeps the mitochondrial membrane sealed.'],
        ['BAX', 'BAX', 'A pore-forming protein that punctures mitochondria to launch apoptosis.'],
        ['BBC3', 'BBC3 (PUMA)', 'A p53-induced messenger that neutralises the cell\'s anti-death proteins.'],
        ['BIRC5', 'BIRC5 (Survivin)', 'An inhibitor of caspases, the enzymes that dismantle a dying cell.'],
      ],
    },
    {
      id: 'immortal', name: 'Replicative Immortality', icon: '♾️',
      blurb: 'Stop the telomere clock from running out.',
      genes: [
        ['TERT', 'TERT', 'The catalytic subunit of telomerase, which rebuilds chromosome ends after each division.'],
        ['TERC', 'TERC', 'The RNA template telomerase copies to extend telomeres.'],
        ['ATRX', 'ATRX', 'A chromatin remodeler whose loss unlocks telomerase-free telomere lengthening (ALT).'],
        ['DAXX', 'DAXX', 'ATRX\'s histone-chaperone partner; losing it also enables the ALT pathway.'],
        ['POT1', 'POT1', 'A shelterin protein that caps telomere ends and controls their length.'],
      ],
    },
    {
      id: 'angio', name: 'Angiogenesis', icon: '🩸',
      blurb: 'Recruit blood supply — extends vessel range.',
      genes: [
        ['VEGFA', 'VEGFA', 'The main secreted signal that tells nearby vessels to sprout new branches.'],
        ['HIF1A', 'HIF1A', 'The oxygen sensor\'s output: switches on VEGF and other low-oxygen survival genes.'],
        ['VHL', 'VHL', 'Tags HIF for destruction when oxygen is present; its loss fakes permanent hypoxia.'],
        ['KDR', 'KDR (VEGFR2)', 'The endothelial receptor that receives the VEGF signal and drives vessel growth.'],
        ['THBS1', 'THBS1', 'Thrombospondin-1, a natural inhibitor of new vessel formation.'],
      ],
    },
    {
      id: 'invasion', name: 'Invasion & Metastasis', icon: '🧭',
      blurb: 'Loosen attachments and push into tissue.',
      genes: [
        ['CDH1', 'CDH1', 'E-cadherin, the glue that holds epithelial cells together.'],
        ['MMP9', 'MMP9', 'An enzyme that digests the extracellular matrix and basement membrane.'],
        ['SNAI1', 'SNAI1', 'Snail, a transcription factor that represses E-cadherin and triggers EMT.'],
        ['TWIST1', 'TWIST1', 'An embryonic migration factor that is re-awakened to make cells mobile.'],
        ['ZEB1', 'ZEB1', 'An EMT driver that flips cells from a stationary to an invasive state.'],
      ],
    },
    {
      id: 'instability', name: 'Genomic Instability', icon: '🧬', special: true,
      blurb: 'Special: no growth bonus — raises the chance of random mutations each tick.',
      genes: [
        ['MLH1', 'MLH1', 'A mismatch-repair protein that fixes DNA copying errors.'],
        ['MSH2', 'MSH2', 'Recognises mismatched bases so that they can be repaired.'],
        ['BRCA1', 'BRCA1', 'Coordinates accurate repair of double-strand DNA breaks.'],
        ['BRCA2', 'BRCA2', 'Loads RAD51 onto broken DNA for homologous recombination repair.'],
        ['ATM', 'ATM', 'A kinase that sounds the alarm when DNA double-strand breaks occur.'],
      ],
    },
  ].map((h) => ({
    ...h,
    genes: h.genes.map(([id, label, desc]) => ({ id, label, desc, hallmark: h.id })),
  }));

  // Small, mostly cosmetic nudges. They scale base constants only, never the formulas.
  const TISSUES = [
    { id: 'lung', name: 'Lung', icon: '🫁', note: 'Richly vascularised: +10% vessel supply range.', rangeMul: 1.1 },
    { id: 'colon', name: 'Colon', icon: '🌀', note: 'Fast-renewing lining: +10% base division rate.', divMul: 1.1 },
    { id: 'skin', name: 'Skin', icon: '🖐️', note: 'Tough, resilient cells: −10% base death rate.', deathMul: 0.9 },
  ];

  const ORIGINS = [
    { id: 'epithelial', name: 'Epithelial', icon: '🧱', note: 'Carcinoma. +5 starting mutation points.', bonusPoints: 5 },
    { id: 'stromal', name: 'Stromal', icon: '🕸️', note: 'Sarcoma. −5% base death rate.', deathMul: 0.95 },
    { id: 'hematopoietic', name: 'Hematopoietic', icon: '💧', note: 'Blood lineage. +5% base division rate.', divMul: 1.05 },
  ];

  root.TumorData = { HALLMARKS, TISSUES, ORIGINS };
})(typeof window !== 'undefined' ? window : globalThis);
