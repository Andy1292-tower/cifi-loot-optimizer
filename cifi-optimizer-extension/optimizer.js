/* ============================================================================
 * CIFI Tools — Loot Score Auto-Optimizer (companion module)
 *
 * Adds an "🎯 Optimize" button to the app. For a chosen build it redistributes
 * the build's EXISTING talent + attribute points to maximise Loot Score
 * (result.lootPerMin), scoring candidates with the app's own WASM evaluation
 * worker. Talent points cost 1 each; attribute points have per-rank costs.
 * The current build is always feasible, so results are always achievable.
 *
 * Non-destructive: results are saved as a NEW build ("<name> (optimized)").
 * ========================================================================== */
(function () {
  'use strict';
  if (window.__cifiOptimizerLoaded) return;
  window.__cifiOptimizerLoaded = true;
  console.log('%c[CIFI Optimizer v1.1.5] loaded (retries stalled evals; timeout scales with iters; 0=unlimited time) — waiting for app…', 'color:#8b5cf6;font-weight:bold');

  // Worker URL is discovered at runtime (the deployed asset hash can change).
  let WORKER_URL = null;
  async function resolveWorkerUrl() {
    if (WORKER_URL) return WORKER_URL;
    let u = performance.getEntriesByType('resource').map(e => e.name)
      .find(n => /assets\/evaluationWorker-[\w-]+\.js/.test(n));
    if (!u) {
      const mod = [...document.querySelectorAll('script[type=module][src]')].map(s => s.src).find(Boolean);
      if (mod) try {
        const t = await fetch(mod).then(r => r.text());
        const m = t.match(/[\w./-]*assets\/evaluationWorker-[\w-]+\.js/);
        if (m) u = m[0].startsWith('http') || m[0].startsWith('/') ? m[0] : '/' + m[0];
      } catch (e) {}
    }
    WORKER_URL = u || '/assets/evaluationWorker-BKbzsoAA.js';
    return WORKER_URL;
  }

  // ---- Static game data: talents (cost 1) and attributes (per-rank cost) ----
  // max: game default cap (effective cap is raised to whatever the account has
  // actually reached across the user's builds). Infinity = uncapped.
  const INF = Infinity;
  const DATA = {
    borge: {
      talents: [ ['revival',2],['loth',5],['ua',5],['impeccable',10],['omen',10],['ll',10],['pog',15],['ultima',50],['tfow',15] ],
      attrs: [ ['ares',INF,1],['ylith',INF,1],['spartan',6,2],['timeless',5,3],['battle',3,5],['athena',1,15],['baal',6,3],['sensors',6,2],['atlas',6,3],['mino',20,2],['htb',10,2],['exp',6,3],['weak',6,2],['hermes',20,2],['lfin',10,2] ],
    },
    ozzy: {
      talents: [ ['revival',2],['boon',1],['ua',5],['needles',10],['omen',10],['ll',10],['crip',15],['ultima',50],['echo',20] ],
      attrs: [ ['lotl',INF,1],['exo',INF,1],['scorp',5,3],['dance',4,3],['cat',20,2],['timeless',5,3],['ibu',5,2],['exterm',5,2],['medusa',5,3],['scarab',20,2],['vect',10,2],['snek',5,3],['cycle',5,3],['deal',3,5],['sisters',1,15] ],
    },
    knox: {
      talents: [ ['revival',2],['calyp',5],['ua',5],['ghost',15],['omen',10],['ll',10],['pog',10],['ultima',50],['finish',15] ],
      attrs: [ ['kraken',INF,1],['soul',100,1],['dead',10,2],['sear',5,2],['pl',10,3],['time',5,3],['kot',5,5],['pct',10,4],['spa',50,2],['fe',10,2],['sop',10,3] ],
    },
  };
  const LABELS = { revival:'Death Is My Companion',loth:'Life of the Hunt',ua:'The Unfair Advantage',impeccable:'Impeccable Impacts',omen:'The Omen Of Defeat',ll:'Call Me Lucky Loot',pog:'Presence Of A God',ultima:'The Legacy of Ultima',tfow:'The Fires of War',boon:"Tricksters Boon",needles:'Thousand Needles',crip:'Crippling Shots',echo:'Echo Bullets',calyp:"Calypso's Advantage",ghost:'Ghost Bullets',finish:'Finishing Move',
    ares:'Soul Of Ares',ylith:'Essence Of Ylith',spartan:'Spartan Lineage',timeless:'Timeless Mastery',battle:'Born For Battle',athena:'Soul Of Athena',baal:'Book Of Baal',sensors:'Superior Sensors',atlas:'The Atlas Protocol',mino:'Soul Of The Minotaur',htb:'Helltouch Barrier',exp:'Explosive Punches',weak:'Weakspot Analysis',hermes:'Soul Of Hermes',lfin:'Lifedrain Inhaler',
    lotl:'Living Off The Land',exo:'Exo Piercers',scorp:'Shimmering Scorpions',dance:'Dance Of Dashes',cat:'Blessing Of The Cat',ibu:'Wings Of Ibu',exterm:'Extermination Protocol',medusa:'Gift Of Medusa',scarab:'Blessing Of The Scarab',vect:'Vectid Elixir',snek:'Soul Of Snek',cycle:'The Cycle Of Death',deal:'A Deal With Death',sisters:'Blessing Of The Sisters',
    kraken:'Release The Kraken',soul:'Soul Amplification',dead:'Dead Men Tell No Tales',sear:'Searious Efficiency',pl:'A Pirates Life for Knox',time:'Timeless Mastery',kot:'King Of Torpedos',pct:'Passive Charge Tank',spa:'Space Pirate Armory',fe:'Fortification Elixir',sop:'Shield of Poseidon' };

  // Attribute prerequisite tree (from ATTRIBUTE_DEPENDENCIES): X needs every
  // listed parent at >=1 before it can hold points. Talents have no tree.
  const DEPS = {
    borge: {ylith:['ares'],baal:['ares'],htb:['ares'],exp:['htb'],spartan:['ylith'],timeless:['spartan'],sensors:['baal'],lfin:['htb'],atlas:['sensors'],weak:['exp'],battle:['spartan'],athena:['battle'],mino:['atlas'],hermes:['weak']},
    ozzy: {exo:['lotl'],ibu:['lotl'],scorp:['exo'],timeless:['exo'],exterm:['ibu'],snek:['exterm'],vect:['exterm'],cycle:['snek'],deal:['cycle'],medusa:['exterm'],dance:['scorp'],sisters:['deal'],scarab:['medusa'],cat:['dance']},
    knox: {soul:['kraken'],dead:['soul'],spa:['kraken'],pl:['spa'],time:['pl'],sear:['kraken'],pct:['sear'],kot:['pct'],fe:['kraken'],sop:['fe']},
  };
  // Total attribute points that must be spent before X unlocks (ATTRIBUTE_MIN_VALUE).
  const MINVAL = {
    borge: {ares:0,ylith:0,spartan:0,timeless:0,baal:0,sensors:0,htb:0,lfin:0,exp:0,atlas:75,weak:75,battle:75,mino:150,hermes:150,athena:180},
    ozzy: {lotl:0,exo:0,scorp:0,timeless:0,ibu:0,exterm:0,snek:0,vect:0,cycle:0,deal:90,medusa:90,dance:90,sisters:180,scarab:150,cat:150},
    knox: {kraken:0,soul:0,dead:0,spa:0,pl:0,time:0,sear:0,pct:0,kot:0,fe:0,sop:0},
  };

  // ===== Build-code (share hash) encoder — replicates the app's kX/TX/base58 =====
  const HUNTER_KIND = { borge: 1, ozzy: 3, knox: 6 };
  const BASE_STATS = {
    borge: ['hp','atk','regen','dr','evade','effect','critchance','critpower','atkspeed','stage'],
    ozzy: ['hp','atk','regen','dr','evade','effect','multichance','multipower','atkspeed','stage'],
    knox: ['hp','atk','regen','dr','block','effect','charge','chargeGain','reload','proj','stage'],
  };
  const QZ = {'borge-loot-bonus':'attraction_lootBorge','ozzy-loot-bonus':'attraction_lootOzzy','knox-loot-bonus':'attraction_lootKnox','catch-up-power-borge-ozzy':'attraction_catchUp','catch-up-power':'attraction_catchUp','catch-up-power-knox':'attraction_catchUp2','borge-stat-bonus':'creation_borgeGU','ozzy-stat-bonus':'creation_ozzyGU','knox-stat-bonus':'creation_knoxGU'};
  // BUILD_CODE_PARAMS per hunter (aD/bD/PD), exact order.
  const PARAMS = {
    borge: ["revival","loth","ua","impeccable","omen","ll","pog","tfow","ares","ylith","spartan","timeless","baal","sensors","htb","lfin","exp","atlas","weak","battle","hp","atk","regen","dr","evade","effect","critchance","critpower","atkspeed","upgrades.loopmods.trample","upgrades.relics.r4","upgrades.relics.r16","upgrades.relics.r19","upgrades.inscryptions.i3","upgrades.inscryptions.i4","upgrades.inscryptions.i11","upgrades.inscryptions.i13","upgrades.inscryptions.i23","upgrades.inscryptions.i24","upgrades.inscryptions.i27","upgrades.inscryptions.i60","upgrades.gems_nodes.creation_gem1","upgrades.gems_nodes.creation_gem2","upgrades.gems_nodes.creation_gem3","upgrades.gems_nodes.innovation_gem3","upgrades.gems_nodes.attraction_gem2","upgrades.gems_nodes.attraction_level","upgrades.gems_nodes.attraction_catchUp","upgrades.inscryptions.i84","upgrades.inscryptions.i87","upgrades.inscryptions.i88","upgrades.inscryptions.i89","upgrades.inscryptions.i91","ultima","athena","mino","hermes","upgrades.gadgets.wrench","upgrades.diamondcards.gaiden","upgrades.diamondspecials.reviveboost","upgrades.gems_nodes.creation_borgeGU","upgrades.gems_nodes.evolution_gem3","upgrades.gems_nodes.temporal_gem4","upgrades.loopmods.stelzi","upgrades.inscryptions.i103","upgrades.gems_nodes.exodus_gem3","upgrades.gems_nodes.exodus_gem4","upgrades.cms.milestoneCount","upgrades.gems_nodes.temporal_gem6","upgrades.gems_nodes.creation_gem4","upgrades.gems_nodes.creation_gem5","upgrades.gems_nodes.evolution_gem6","upgrades.relics.t2r7","upgrades.gems_nodes.power_level"],
    ozzy: ["revival","boon","ua","needles","omen","ll","crip","echo","lotl","exo","scorp","timeless","ibu","exterm","snek","vect","cycle","deal","medusa","dance","hp","atk","regen","dr","evade","effect","multichance","multipower","atkspeed","upgrades.relics.r4","upgrades.relics.r17","upgrades.inscryptions.i31","upgrades.inscryptions.i36","upgrades.inscryptions.i37","upgrades.inscryptions.i40","upgrades.gems_nodes.innovation_gem2","upgrades.gems_nodes.innovation_gem3","upgrades.gems_nodes.attraction_level","upgrades.gems_nodes.attraction_catchUp","upgrades.inscryptions.i86","upgrades.inscryptions.i92","ultima","sisters","scarab","cat","upgrades.gadgets.zaptron","upgrades.diamondcards.iridian","upgrades.diamondspecials.reviveboost","upgrades.gems_nodes.creation_ozzyGU","upgrades.gems_nodes.evolution_gem3","upgrades.loopmods.stelzi","upgrades.gems_nodes.exodus_gem3","upgrades.gems_nodes.exodus_gem4","upgrades.cms.milestoneCount","upgrades.gems_nodes.temporal_gem6","upgrades.gems_nodes.creation_gem4","upgrades.gems_nodes.creation_gem5","upgrades.gems_nodes.creation_gem6","upgrades.gems_nodes.evolution_gem6","upgrades.relics.t2r7","upgrades.gems_nodes.power_level"],
    knox: ["revival","calyp","ua","ghost","omen","ll","pog","finish","ultima","kraken","spa","pl","time","soul","dead","fe","sop","sear","pct","kot","hp","atk","regen","dr","block","effect","charge","chargeGain","reload","proj","upgrades.diamondspecials.reviveboost","stage","upgrades.gadgets.anchor","upgrades.gems_nodes.creation_knoxGU","upgrades.gems_nodes.evolution_gem3","upgrades.gems_nodes.exodus_gem4","upgrades.cms.milestoneCount","upgrades.gems_nodes.temporal_gem6","upgrades.gems_nodes.creation_gem4","upgrades.gems_nodes.creation_gem5","upgrades.gems_nodes.power_gem6","upgrades.gems_nodes.evolution_gem6","upgrades.gems_nodes.attraction_level","upgrades.gems_nodes.attraction_catchUp2","upgrades.relics.t2r7","upgrades.gems_nodes.power_level"],
  };
  const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  function base58(bytes) {
    const digits = [0];
    for (const b of bytes) {
      let carry = b;
      for (let j = 0; j < digits.length; j++) { carry += digits[j] << 8; digits[j] = carry % 58; carry = (carry / 58) | 0; }
      while (carry) { digits.push(carry % 58); carry = (carry / 58) | 0; }
    }
    let str = '';
    for (let k = 0; k < bytes.length && bytes[k] === 0; k++) str += B58[0];
    for (let q = digits.length - 1; q >= 0; q--) str += B58[digits[q]];
    return str;
  }
  function computeGemNodes(gemStates, upgrades) {
    if (!gemStates) return;
    upgrades.gems_nodes = {};
    for (const [gem, st] of Object.entries(gemStates)) {
      if (!st) continue;
      upgrades.gems_nodes[gem + '_level'] = st.level > 0 ? st.level : 0;
      if (Array.isArray(st.nodes)) st.nodes.forEach((a, r) => { upgrades.gems_nodes[gem + '_gem' + (r + 1)] = a ? 1 : 0; });
      if (st.upgrades) for (const [k, v] of Object.entries(st.upgrades)) { const m = QZ[k]; upgrades.gems_nodes[m || (gem + '_' + k)] = v; }
    }
  }
  function codeContext(hunterId, build) {
    const { hunter, gems } = stores();
    const copy = (o) => JSON.parse(JSON.stringify(o == null ? {} : o));
    const ctx = { hunterStats: copy(hunter.hunterStats), upgrades: copy(hunter.upgrades) };
    const gemStates = (gems && gems.$state && gems.$state.gemStates) || (gems && gems.gemStates);
    computeGemNodes(copy(gemStates), ctx.upgrades);
    const ov = build.overrides || {};
    for (const [k, v] of Object.entries(ov)) {
      if (k.startsWith('upgrades.')) {
        const p = k.split('.');
        if (p.length === 3) { (ctx.upgrades[p[1]] = ctx.upgrades[p[1]] || {})[p[2]] = v; }
        else if (p.length === 4) { const c = ctx.upgrades[p[1]] = ctx.upgrades[p[1]] || {}; (c[p[2]] = c[p[2]] || {})[p[3]] = v; }
      } else { (ctx.hunterStats[hunterId] = ctx.hunterStats[hunterId] || {})[k] = v; }
    }
    return ctx;
  }
  function extractParamValue(param, build, ctx, hunterId) {
    if (build.overrides && param in build.overrides) return build.overrides[param] ?? 0;
    if (build.talents && param in build.talents) return build.talents[param] ?? 0;
    if (build.attributes && param in build.attributes) return build.attributes[param] ?? 0;
    if ((BASE_STATS[hunterId] || []).includes(param))
      return (ctx.hunterStats && ctx.hunterStats[hunterId] && ctx.hunterStats[hunterId][param]) ?? 0;
    if (param === 'lvl') return build.level ?? 0;
    if (param.startsWith('upgrades.')) {
      const p = param.split('.');
      if (p.length === 3) return (ctx.upgrades?.[p[1]]?.[p[2]]) ?? 0;
      if (p.length === 4) return (ctx.upgrades?.[p[1]]?.[p[2]]?.[p[3]]) ?? 0;
      return 0;
    }
    return 0;
  }
  function packBuffer(kind, levels) {
    const out = [101, (kind << 5) | 0];
    for (let i = 0; i < levels.length; i += 4) {
      const group = levels.slice(i, i + 4).map(x => {
        let v = Math.round(+x) || 0; if (v < 0) v = 0; if (v > 65535) v = 65535;
        const tag = v === 0 ? 0 : v === 1 ? 1 : v <= 255 ? 2 : 3;
        return [v, tag];
      });
      while (group.length < 4) group.push([0, 0]);
      out.push(group.reduce((acc, g) => (acc << 2) | g[1], 0));
      group.forEach(([v, t]) => { if (t === 2) out.push(v & 255); else if (t === 3) { out.push((v >> 8) & 255); out.push(v & 255); } });
    }
    return Uint8Array.from(out);
  }
  function generateBuildCode(build, hunterId) {
    try {
      const ctx = codeContext(hunterId, build);
      const vals = PARAMS[hunterId].map(p => extractParamValue(p, build, ctx, hunterId));
      return base58(packBuffer(HUNTER_KIND[hunterId], vals));
    } catch (e) { console.error('[CIFI Optimizer] build-code failed', e); return null; }
  }

  // ------------------------------- Store access ------------------------------
  function pinia() {
    const app = document.querySelector('#app') && document.querySelector('#app').__vue_app__;
    const p = app && app.config.globalProperties.$pinia;
    return p && p._s ? p._s : null;
  }
  function stores() {
    const s = pinia(); if (!s) throw new Error('app not ready');
    return { hunter: s.get('hunter'), gems: s.get('gemPlanner') };
  }
  // Assemble the exact "context" object the app passes to evaluate().
  function buildContext(hunterId) {
    const { hunter, gems } = stores();
    const plain = (o) => JSON.parse(JSON.stringify(o == null ? {} : o));
    return {
      hunterStats: plain(hunter.hunterStats),
      upgrades: plain(hunter.upgrades),
      hunterIterations: plain(hunter.hunterIterations),
      hunterSeedSettings: plain(hunter.hunterSeedSettings),
      gemPlannerStore: plain(gems && gems.$state ? gems.$state : gems),
    };
  }
  function buildsFor(hunterId) {
    const { hunter } = stores();
    const list = (hunter.hunterBuilds && hunter.hunterBuilds[hunterId]) || [];
    return list.map(b => JSON.parse(JSON.stringify(b)));
  }

  // ------------------------------- Worker pool -------------------------------
  class Pool {
    constructor(n) {
      this.workers = [];
      for (let i = 0; i < n; i++) {
        const w = new Worker(WORKER_URL, { type: 'module' });
        w.__busy = false;
        this.workers.push(w);
      }
      this.q = [];
    }
    evaluate(hunterId, build, ctx) {
      return new Promise((resolve) => { this.q.push({ hunterId, build, ctx, resolve, tries: 0 }); this._pump(); });
    }
    _pump() {
      while (this.q.length) {
        const w = this.workers.find(x => !x.__busy);
        if (!w) break;
        w.__busy = true;
        this._exec(w, this.q.shift());
      }
    }
    _exec(w, job) {
      const id = 'opt' + Math.random().toString(36).slice(2);
      let settled = false;
      // Stall timeout scales with the resolution being evaluated, so high iteration
      // counts aren't killed; only a genuinely hung worker trips it.
      const iters = (job.ctx && job.ctx.hunterIterations && job.ctx.hunterIterations[job.hunterId]) || 1000;
      const timeoutMs = Math.max(30000, iters * 3 + 10000);
      const done = (val) => {
        if (settled) return; settled = true; clearTimeout(timer);
        w.removeEventListener('message', onmsg); w.__busy = false;
        job.resolve(val); this._pump();
      };
      const onmsg = (e) => { const d = e.data; if (!d || d.id !== id) return; done(d.type === 'THROW' ? null : d.value); };
      w.addEventListener('message', onmsg);
      const timer = setTimeout(() => {
        if (settled) return; settled = true;
        w.removeEventListener('message', onmsg);
        try { w.terminate(); } catch (e) {}
        const idx = this.workers.indexOf(w);
        if (idx >= 0) { const nw = new Worker(WORKER_URL, { type: 'module' }); nw.__busy = false; this.workers[idx] = nw; }
        job.tries = (job.tries || 0) + 1;
        if (job.tries <= 3) {
          console.warn('[CIFI Optimizer] worker stalled — replaced it; re-running that evaluation (attempt ' + (job.tries + 1) + ')');
          this.q.unshift(job);            // rerun the SAME candidate on a fresh worker
        } else {
          console.warn('[CIFI Optimizer] evaluation failed after 3 retries — skipping candidate');
          job.resolve(null);
        }
        this._pump();
      }, timeoutMs);
      w.postMessage({ id, type: 'APPLY', path: ['evaluate'], argumentList: [
        { type: 'RAW', value: job.hunterId }, { type: 'RAW', value: job.build }, { type: 'RAW', value: job.ctx },
      ]});
    }
    destroy() { this.workers.forEach(w => w.terminate()); this.workers = []; }
  }

  const scoreOf = (r) => (r && typeof r.lootPerMin === 'number') ? r.lootPerMin : -1;

  // ------------------------------- Optimizer ---------------------------------
  // Redistribute talent points (cost 1) and attribute points (weighted cost),
  // conserving each budget, maximising lootPerMin. Steepest-ascent hill-climb
  // with swap moves; deterministic seed => stable comparisons.
  async function optimize(hunterId, build, opts, onProgress) {
    const pool = opts.pool;
    const searchCtx = JSON.parse(JSON.stringify(opts.ctx));
    searchCtx.hunterIterations = Object.assign({}, searchCtx.hunterIterations, { [hunterId]: opts.searchIters });

    const talents = DATA[hunterId].talents.map(([k, m]) => ({ k, max: m }));
    const attrs = DATA[hunterId].attrs.map(([k, m, c]) => ({ k, max: m, cost: c }));

    // Effective caps: never below what the account already reached anywhere.
    const allBuilds = buildsFor(hunterId);
    const observed = (field, key) => Math.max(0, ...allBuilds.map(b => (b[field] && +b[field][key]) || 0));
    talents.forEach(t => { t.eff = Math.max(t.max, (+build.talents?.[t.k]||0), observed('talents', t.k)); });
    attrs.forEach(a => { a.eff = Math.max(a.max, (+build.attributes?.[a.k]||0), observed('attributes', a.k)); });

    // Ultima ("The Legacy of Ultima") is a level-gated advanced talent: it only
    // unlocks once the hunter reaches level 70 (shouldShowAdvancedTalents). If it's
    // not unlocked, cap it at the build's current value so the optimizer can never
    // add points to it (which would be an impossible build).
    const advUnlocked = (() => {
      try { const { hunter } = stores();
        if (typeof hunter.shouldShowAdvancedTalents === 'function') return !!hunter.shouldShowAdvancedTalents(hunterId);
        const s = hunter.hunterLevelSettings && hunter.hunterLevelSettings[hunterId];
        return !!(s && s.showAdvancedTalents);
      } catch (e) { return true; }
    })();
    if (!advUnlocked) { const u = talents.find(t => t.k === 'ultima'); if (u) u.eff = (+build.talents?.ultima || 0); }

    // Current allocation vectors + budgets.
    let tv = talents.map(t => +build.talents?.[t.k] || 0);
    let av = attrs.map(a => +build.attributes?.[a.k] || 0);
    const tBudget = tv.reduce((s, x) => s + x, 0);
    const attrTotal = (v) => v.reduce((s, x, i) => s + x * attrs[i].cost, 0);
    const aBudget = attrTotal(av);

    // Attribute prerequisite validity: every attr with points must have all its
    // dependency parents >=1 and enough total points spent to have unlocked it.
    const aIdx = {}; attrs.forEach((a, i) => { aIdx[a.k] = i; });
    const deps = DEPS[hunterId] || {}, minval = MINVAL[hunterId] || {};
    function attrValid(v) {
      const total = attrTotal(v);
      for (let i = 0; i < v.length; i++) if (v[i] > 0) {
        if (v[i] > attrs[i].eff) return false;
        const ps = deps[attrs[i].k];
        if (ps) for (const p of ps) { const pi = aIdx[p]; if (pi == null || v[pi] < 1) return false; }
        if (total < (minval[attrs[i].k] || 0)) return false;
      }
      return true;
    }
    const gcd = (a, b) => b ? gcd(b, a % b) : a;

    // Candidate builder: apply talent/attr vectors onto a copy of the build.
    function makeBuild(tvec, avec) {
      const b = JSON.parse(JSON.stringify(build));
      b.talents = Object.assign({}, b.talents);
      b.attributes = Object.assign({}, b.attributes);
      talents.forEach((t, i) => { b.talents[t.k] = tvec[i]; });
      attrs.forEach((a, i) => { b.attributes[a.k] = avec[i]; });
      // Overrides can pin talent/attr values; strip those so our changes apply.
      if (b.overrides) { const o = Object.assign({}, b.overrides);
        talents.forEach(t => delete o[t.k]); attrs.forEach(a => delete o[a.k]); b.overrides = o; }
      return b;
    }
    const evalVec = async (tvec, avec) => scoreOf(await pool.evaluate(hunterId, makeBuild(tvec, avec), searchCtx));

    let evals = 0, best = { tv: tv.slice(), av: av.slice(), score: await evalVec(tv, av) };
    const baselineSearchScore = best.score; evals++;
    onProgress && onProgress({ phase: 'baseline', score: best.score, evals });

    // Talent transfer moves (A->B): -1 A, +1 B ; budget preserved.
    function talentMoves(v) {
      const out = [];
      for (let a = 0; a < v.length; a++) if (v[a] > 0)
        for (let b = 0; b < v.length; b++) if (a !== b && v[b] < talents[b].eff) {
          const nv = v.slice(); nv[a]--; nv[b]++; out.push(nv);
        }
      return out;
    }
    // Attribute moves: cost-NEUTRAL swaps (remove dA from A, add dB to B with
    // dA*costA == dB*costB) so the total point spend is conserved exactly.
    // Only allocations that satisfy the prerequisite tree are emitted.
    function attrMoves(v) {
      const out = [];
      for (let a = 0; a < v.length; a++) if (v[a] > 0)
        for (let b = 0; b < v.length; b++) if (a !== b && v[b] < attrs[b].eff) {
          const ca = attrs[a].cost, cb = attrs[b].cost, g = ca * cb / gcd(ca, cb);
          const dA = g / ca, dB = g / cb;
          for (let mult = 1; mult <= 2; mult++) {
            const da = dA * mult, db = dB * mult;
            if (v[a] - da < 0 || v[b] + db > attrs[b].eff) break;
            const nv = v.slice(); nv[a] -= da; nv[b] += db;
            if (attrValid(nv)) out.push(nv);
          }
        }
      return out;
    }

    // Evaluations are expensive (~1.4s each) and only scale ~2-3x across workers,
    // so instead of scoring whole neighbourhoods we run pool-saturating "waves":
    // each wave scores a small shuffled batch in parallel, takes the best
    // improving move, and perturbs off the best when stuck. Clock checked per batch.
    const MARGIN = 1 + (opts.margin || 0);
    const POOL_N = (pool.workers && pool.workers.length) || 4;
    const rand = (n) => (Math.random() * n) | 0;
    const timeMs = opts.timeMs || 90000;
    const patience = opts.patience == null ? 4 : opts.patience;
    const t0 = performance.now();
    let cur = { tv: best.tv.slice(), av: best.av.slice(), score: best.score };
    let noImprove = 0;
    const timeLeft = () => performance.now() - t0 < timeMs;
    while (timeLeft() && noImprove <= patience) {
      const cands = [];
      for (const m of talentMoves(cur.tv)) cands.push({ k: 't', m });
      for (const m of attrMoves(cur.av)) cands.push({ k: 'a', m });
      if (!cands.length) break;
      for (let i = cands.length - 1; i > 0; i--) { const j = rand(i + 1); const t = cands[i]; cands[i] = cands[j]; cands[j] = t; }
      const capPerWave = Math.min(cands.length, Math.max(POOL_N * 4, 24));
      let improved = null;
      for (let i = 0; i < capPerWave && !improved && timeLeft();) {
        const batch = cands.slice(i, i + POOL_N); i += batch.length;
        const scored = await Promise.all(batch.map(async c => ({
          c, s: c.k === 't' ? await evalVec(c.m, cur.av) : await evalVec(cur.tv, c.m),
        })));
        evals += batch.length;
        for (const r of scored) if (r.s > cur.score * MARGIN && (!improved || r.s > improved.s)) improved = r;
        onProgress && onProgress({ phase: 'search', score: best.score, evals, elapsed: (performance.now() - t0) / 1000 });
      }
      if (improved) {
        cur = improved.c.k === 't'
          ? { tv: improved.c.m, av: cur.av, score: improved.s }
          : { tv: cur.tv, av: improved.c.m, score: improved.s };
        noImprove = 0;
        if (cur.score > best.score) best = { tv: cur.tv.slice(), av: cur.av.slice(), score: cur.score };
      } else {
        noImprove++;
        cur = { tv: best.tv.slice(), av: best.av.slice(), score: best.score };
        for (let k = 0; k < 3; k++) { const tm = talentMoves(cur.tv); if (tm.length) cur.tv = tm[rand(tm.length)]; }
        for (let k = 0; k < 3; k++) { const am = attrMoves(cur.av); if (am.length) cur.av = am[rand(am.length)]; }
        cur.score = await evalVec(cur.tv, cur.av); evals++;
      }
    }

    // Final verification at full iterations: compare baseline vs best fairly.
    // The search optimises a lower-iteration (noisier) estimate, so its winner
    // can lose to the current build at full accuracy. If it doesn't actually
    // beat the current build here, KEEP the current build (report it as best).
    const finalCtx = JSON.parse(JSON.stringify(opts.ctx));
    finalCtx.hunterIterations = Object.assign({}, finalCtx.hunterIterations, { [hunterId]: opts.finalIters });
    const finalScore = async (b) => scoreOf(await pool.evaluate(hunterId, b, finalCtx));
    const baseTv = talents.map(t => +build.talents?.[t.k] || 0);
    const baseAv = attrs.map(a => +build.attributes?.[a.k] || 0);
    const beforeFull = await finalScore(makeBuild(baseTv, baseAv));
    let afterFull = await finalScore(makeBuild(best.tv, best.av));
    if (afterFull <= beforeFull) { best = { tv: baseTv, av: baseAv, score: best.score }; afterFull = beforeFull; }

    const talentAlloc = talents.map((t, i) => ({ key: t.k, label: LABELS[t.k] || t.k, from: +build.talents?.[t.k]||0, to: best.tv[i], max: t.eff }));
    const attrAlloc = attrs.map((a, i) => ({ key: a.k, label: LABELS[a.k] || a.k, cost: a.cost, from: +build.attributes?.[a.k]||0, to: best.av[i], max: a.eff }));

    return {
      hunterId, build, talents: talentAlloc, attrs: attrAlloc,
      tBudget, aBudget, evals,
      beforeFull, afterFull,
      pctGain: beforeFull > 0 ? (afterFull / beforeFull - 1) * 100 : 0,
      makeBuild, best,
    };
  }

  // --------------------------------- UI --------------------------------------
  const css = `
  #cifi-opt-fab{position:fixed;right:18px;bottom:18px;z-index:99999;background:linear-gradient(135deg,#6366f1,#8b5cf6);color:#fff;border:none;border-radius:999px;padding:11px 16px;font:600 14px/1 system-ui;box-shadow:0 6px 20px rgba(99,102,241,.45);cursor:pointer;display:flex;gap:7px;align-items:center}
  #cifi-opt-fab:hover{filter:brightness(1.08)}
  #cifi-opt-modal{position:fixed;inset:0;z-index:100000;background:rgba(2,6,23,.72);display:flex;align-items:center;justify-content:center;font-family:system-ui}
  #cifi-opt-card{background:#0f172a;color:#e2e8f0;width:min(760px,94vw);max-height:90vh;overflow:auto;border:1px solid #1e293b;border-radius:16px;box-shadow:0 24px 60px rgba(0,0,0,.55)}
  #cifi-opt-card h2{margin:0;padding:16px 20px;border-bottom:1px solid #1e293b;font-size:17px;display:flex;justify-content:space-between;align-items:center}
  .cifi-body{padding:16px 20px}
  .cifi-row{display:flex;gap:12px;flex-wrap:wrap;align-items:end;margin-bottom:14px}
  .cifi-field{display:flex;flex-direction:column;gap:4px;font-size:12px;color:#94a3b8}
  .cifi-field select,.cifi-field input{background:#1e293b;color:#e2e8f0;border:1px solid #334155;border-radius:8px;padding:8px 10px;font-size:13px;min-width:120px}
  .cifi-btn{background:linear-gradient(135deg,#6366f1,#8b5cf6);color:#fff;border:none;border-radius:9px;padding:9px 16px;font:600 13px system-ui;cursor:pointer}
  .cifi-btn.secondary{background:#334155}
  .cifi-btn:disabled{opacity:.5;cursor:not-allowed}
  .cifi-x{background:none;border:none;color:#94a3b8;font-size:20px;cursor:pointer}
  .cifi-prog{height:8px;background:#1e293b;border-radius:6px;overflow:hidden;margin:6px 0}
  .cifi-prog > div{height:100%;background:linear-gradient(90deg,#6366f1,#22c55e);width:0;transition:width .2s}
  .cifi-muted{color:#94a3b8;font-size:12px}
  table.cifi{width:100%;border-collapse:collapse;font-size:12.5px;margin-top:8px}
  table.cifi th,table.cifi td{padding:5px 8px;text-align:left;border-bottom:1px solid #1e293b}
  table.cifi td.n{text-align:right;font-variant-numeric:tabular-nums}
  .up{color:#22c55e}.down{color:#f87171}.same{color:#64748b}
  .cifi-kpi{display:flex;gap:18px;flex-wrap:wrap;margin:8px 0 4px}
  .cifi-kpi div b{display:block;font-size:19px}
  .cifi-cols{display:grid;grid-template-columns:1fr 1fr;gap:18px}
  @media(max-width:640px){.cifi-cols{grid-template-columns:1fr}}`;

  function fmt(n) {
    if (!isFinite(n)) return '—';
    const u = [['qa',1e18],['t',1e12],['b',1e9],['m',1e6],['k',1e3]];
    for (const [s, v] of u) if (Math.abs(n) >= v) return (n / v).toFixed(2) + s;
    return n.toFixed(2);
  }

  let pool = null;
  async function ensurePool() {
    if (pool) return pool;
    await resolveWorkerUrl();
    const n = Math.max(2, Math.min(8, (navigator.hardwareConcurrency || 4) - 1));
    pool = new Pool(n);
    return pool;
  }

  function openModal() {
    let hunterIds;
    try { const { hunter } = stores(); hunterIds = Object.keys(hunter.hunterBuilds || { borge: 1 }); }
    catch (e) { alert('CIFI Optimizer: app not ready yet — open a hunter page first.'); return; }
    hunterIds = ['borge', 'ozzy', 'knox'].filter(h => hunterIds.includes(h));

    const wrap = document.createElement('div'); wrap.id = 'cifi-opt-modal';
    wrap.innerHTML = `<div id="cifi-opt-card">
      <h2>🎯 Loot Score Optimizer <button class="cifi-x" id="cifi-close">×</button></h2>
      <div class="cifi-body">
        <div class="cifi-row">
          <label class="cifi-field">Hunter<select id="cifi-hunter">${hunterIds.map(h=>`<option value="${h}">${h[0].toUpperCase()+h.slice(1)}</option>`).join('')}</select></label>
          <label class="cifi-field">Build<select id="cifi-build" style="min-width:220px"></select></label>
          <label class="cifi-field" style="flex-direction:row;align-items:center;gap:6px;padding-bottom:9px"><input type="checkbox" id="cifi-hidearch" checked style="min-width:0">Hide archived</label>
          <label class="cifi-field">Search iters<input id="cifi-si" type="number" value="1200" min="200" step="100" style="width:90px"></label>
          <label class="cifi-field">Final iters<input id="cifi-fi" type="number" value="10000" min="1000" step="1000" style="width:90px"></label>
          <label class="cifi-field">Max time (s, 0=∞)<input id="cifi-tm" type="number" value="75" min="0" step="15" style="width:80px"></label>
          <button class="cifi-btn" id="cifi-run">Optimize</button>
        </div>
        <div id="cifi-status" class="cifi-muted">Redistributes this build's talent &amp; attribute points for maximum Loot Score. Current build stays feasible, so it can only match or beat it.</div>
        <div class="cifi-prog"><div id="cifi-bar"></div></div>
        <div id="cifi-out"></div>
      </div></div>`;
    document.body.appendChild(wrap);
    const $ = (id) => wrap.querySelector(id);
    const close = () => wrap.remove();
    $('#cifi-close').onclick = close;
    wrap.onclick = (e) => { if (e.target === wrap) close(); };

    function categoryOf(h, b) {
      try { const { hunter } = stores();
        if (typeof hunter.getBuildCategory === 'function') { const c = hunter.getBuildCategory(h, b.id); if (c) return c; }
        const bc = hunter.buildCategories && hunter.buildCategories[h];
        return (bc && bc.buildCategoryMap && bc.buildCategoryMap[b.id]) || (b.isArchived ? 'archived' : 'active');
      } catch (e) { return b.isArchived ? 'archived' : 'active'; }
    }
    function categoryName(h, catId) {
      try { const { hunter } = stores();
        const cats = (typeof hunter.getCategories === 'function' ? hunter.getCategories(h) : null)
          || (hunter.buildCategories && hunter.buildCategories[h] && hunter.buildCategories[h].categories) || [];
        const c = cats.find(c => c.id === catId); return c ? c.name : (catId === 'active' ? 'Active' : catId || 'Active');
      } catch (e) { return catId || 'Active'; }
    }
    function fillBuilds() {
      const h = $('#cifi-hunter').value;
      const hideArch = $('#cifi-hidearch').checked;
      const full = buildsFor(h);
      const rows = full.map((b, i) => ({ b, i, cat: categoryOf(h, b) })).filter(x => !hideArch || x.cat !== 'archived');
      const groups = {};
      for (const x of rows) (groups[x.cat] = groups[x.cat] || []).push(x);
      const rank = (c) => c === 'active' ? 0 : c === 'archived' ? 2 : 1; // active first, archived last
      const order = Object.keys(groups).sort((a, b) => rank(a) - rank(b) || categoryName(h, a).localeCompare(categoryName(h, b)));
      $('#cifi-build').innerHTML = order.map(cat =>
        `<optgroup label="${categoryName(h, cat)}">` +
        groups[cat].map(x => `<option value="${x.i}">${(x.b.name || 'Unnamed')} — Lv${x.b.level || '?'}</option>`).join('') +
        `</optgroup>`).join('') || '<option disabled>(no builds)</option>';
      $('#cifi-build').__list = full;
    }
    $('#cifi-hunter').onchange = fillBuilds;
    $('#cifi-hidearch').onchange = fillBuilds;
    // Default to whichever hunter page is currently open.
    const curHunter = (location.pathname.match(/\/(borge|ozzy|knox)(?:\/|$)/) || [])[1];
    if (curHunter && hunterIds.includes(curHunter)) $('#cifi-hunter').value = curHunter;
    fillBuilds();

    $('#cifi-run').onclick = async () => {
      const h = $('#cifi-hunter').value;
      const list = $('#cifi-build').__list || buildsFor(h);
      const build = list[+$('#cifi-build').value];
      if (!build) return;
      const searchIters = Math.max(200, +$('#cifi-si').value || 1200);
      const finalIters = Math.max(1000, +$('#cifi-fi').value || 10000);
      const tmSec = Math.max(0, +$('#cifi-tm').value || 0);
      const timeMs = tmSec > 0 ? tmSec * 1000 : Infinity; // 0 = unlimited (run to convergence)
      $('#cifi-run').disabled = true; $('#cifi-out').innerHTML = '';
      $('#cifi-status').textContent = 'Warming up engine…';
      try {
        const ctx = buildContext(h);
        const t0 = performance.now();
        const res = await optimize(h, build, {
          pool: await ensurePool(), ctx, searchIters, finalIters, timeMs,
          margin: 0.0005, patience: 4,
        }, (p) => {
          const pct = Math.min(98, (p.evals / Math.max(1, (p.evals + 40))) * 100);
          $('#cifi-bar').style.width = pct + '%';
          $('#cifi-status').textContent =
            `Searching… ${p.evals} evals · best ${fmt(p.score)} · ${(p.elapsed||0).toFixed(0)}s`;
        });
        $('#cifi-bar').style.width = '100%';
        renderResult($, res, (performance.now() - t0) / 1000);
      } catch (e) {
        $('#cifi-status').textContent = 'Error: ' + (e && e.message || e);
        console.error('[CIFI Optimizer]', e);
      } finally { $('#cifi-run').disabled = false; }
    };
  }

  function renderResult($, res, secs) {
    const gain = res.pctGain;
    const gcls = gain > 0.05 ? 'up' : (gain < -0.05 ? 'down' : 'same');
    const rowHtml = (r) => {
      const d = r.to - r.from;
      const cls = d > 0 ? 'up' : (d < 0 ? 'down' : 'same');
      const arrow = d > 0 ? '▲' : (d < 0 ? '▼' : '');
      return `<tr><td>${r.label}${r.cost?` <span class="cifi-muted">×${r.cost}</span>`:''}</td>
        <td class="n">${r.from}</td><td class="n ${cls}">${arrow} ${r.to}</td>
        <td class="n cifi-muted">${isFinite(r.max)?r.max:'∞'}</td></tr>`;
    };
    const tRows = res.talents.map(rowHtml).join('');
    const aRows = res.attrs.map(rowHtml).join('');
    const changed = res.talents.concat(res.attrs).some(r => r.to !== r.from);
    $('#cifi-status').textContent =
      `Done in ${secs.toFixed(0)}s · ${res.evals} evaluations · budgets: ${res.tBudget} talent pts, ${res.aBudget} attribute pts.`;
    $('#cifi-out').innerHTML = `
      <div class="cifi-kpi">
        <div><span class="cifi-muted">Current Loot Score</span><b>${fmt(res.beforeFull)}</b></div>
        <div><span class="cifi-muted">Optimized Loot Score</span><b class="${gcls}">${fmt(res.afterFull)}</b></div>
        <div><span class="cifi-muted">Change</span><b class="${gcls}">${gain>=0?'+':''}${gain.toFixed(2)}%</b></div>
      </div>
      ${changed ? '' : '<div class="cifi-muted" style="margin:6px 0">Your current allocation is already optimal (within engine noise) for this build.</div>'}
      <div class="cifi-cols">
        <div><b>Talents</b> <span class="cifi-muted">(1 pt each)</span>
          <table class="cifi"><tr><th>Talent</th><th class="n">Now</th><th class="n">Best</th><th class="n">Cap</th></tr>${tRows}</table></div>
        <div><b>Attributes</b> <span class="cifi-muted">(weighted cost)</span>
          <table class="cifi"><tr><th>Attribute</th><th class="n">Now</th><th class="n">Best</th><th class="n">Cap</th></tr>${aRows}</table></div>
      </div>
      <div class="cifi-row" style="margin-top:16px">
        <button class="cifi-btn" id="cifi-save" ${changed?'':'disabled'}>Save as new build</button>
        <button class="cifi-btn secondary" id="cifi-copy">Copy build code</button>
      </div>
      <div class="cifi-muted" style="margin-top:6px">Build code pastes straight into the game tool's <b>Import</b> (works on this device or the live site).</div>`;

    $('#cifi-copy').onclick = async () => {
      const nb = res.makeBuild(res.best.tv, res.best.av);
      const code = generateBuildCode(nb, res.hunterId);
      if (!code) { $('#cifi-copy').textContent = 'Code failed'; return; }
      try { await navigator.clipboard.writeText(code); $('#cifi-copy').textContent = 'Copied code ✓'; }
      catch (e) { window.prompt('Build code (copy):', code); $('#cifi-copy').textContent = 'Copy build code'; }
      setTimeout(() => $('#cifi-copy').textContent = 'Copy build code', 1800);
    };
    const saveBtn = $('#cifi-save');
    if (saveBtn) saveBtn.onclick = () => {
      try {
        const { hunter } = stores();
        const nb = res.makeBuild(res.best.tv, res.best.av);
        nb.name = (res.build.name || 'Build') + ' (optimized)';
        delete nb.id; delete nb.timestamp; nb.isImported = false;
        if (typeof hunter.addBuild === 'function') hunter.addBuild(res.hunterId, nb);
        else if (hunter.hunterBuilds && hunter.hunterBuilds[res.hunterId]) hunter.hunterBuilds[res.hunterId].push(nb);
        saveBtn.textContent = 'Saved ✓ (see build list)'; saveBtn.disabled = true;
      } catch (e) { alert('Save failed: ' + (e && e.message || e)); }
    };
  }

  // ------------------------------- Bootstrap ---------------------------------
  window.__cifiGenerateBuildCode = generateBuildCode; // exposed for verification/tools
  function boot() {
    if (document.getElementById('cifi-opt-fab')) return;
    const style = document.createElement('style'); style.textContent = css; document.head.appendChild(style);
    const fab = document.createElement('button'); fab.id = 'cifi-opt-fab';
    fab.innerHTML = '🎯 Optimize'; fab.title = 'Auto-optimize a build for max Loot Score';
    fab.onclick = openModal; document.body.appendChild(fab);
    console.log('%c[CIFI Optimizer] 🎯 button added (bottom-right)', 'color:#22c55e;font-weight:bold');
  }
  // Wait until the Vue app + pinia are mounted.
  let __booted = false;
  const iv = setInterval(() => {
    try { if (pinia() && pinia().get('hunter')) { clearInterval(iv); __booted = true; boot(); } } catch (e) {}
  }, 400);
  setTimeout(() => { clearInterval(iv); if (!__booted) console.warn('[CIFI Optimizer] gave up: could not find the app (Pinia hunter store) after 60s'); }, 60000);
})();
