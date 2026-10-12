// CIFI Tools Loot Score optimizer
//
// Adds a 🎯 Optimize button to cifi-tools.com. Pick a build and it reshuffles
// that build's existing talent and attribute points to get the highest Loot
// Score (result.lootPerMin). Every candidate is scored by the site's own
// evaluation worker, so the numbers match what the app shows.
//
// It never invents points: talents cost 1 each, attributes have their own
// per-rank costs, and both totals stay exactly where they were. The result is
// saved as a new build, so the original is never touched.
(function () {
  'use strict';
  if (window.__cifiOptimizerLoaded) return;
  window.__cifiOptimizerLoaded = true;

  // Bump this together with manifest.json so the console shows which version loaded.
  const VERSION = '1.3.1';
  const TAG = '[CIFI Optimizer]';
  console.log(`%c[CIFI Optimizer v${VERSION}] loaded, waiting for the app…`, 'color:#8b5cf6;font-weight:bold');

  const HUNTERS = ['borge', 'ozzy', 'knox'];

  // Small helpers
  const clone = (o) => JSON.parse(JSON.stringify(o ?? {}));
  const pointsIn = (obj, key) => +obj?.[key] || 0;
  const randInt = (n) => Math.floor(Math.random() * n);
  const gcd = (a, b) => (b ? gcd(b, a % b) : a);
  const lcm = (a, b) => (a * b) / gcd(a, b);
  const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = randInt(i + 1);
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  // The worker's file name includes a content hash that changes whenever the
  // site redeploys, so we look it up at runtime: first among scripts the page
  // has already loaded, then by searching the main bundle. The hard-coded name
  // is only a last resort and will go stale.
  let workerUrl = null;
  async function resolveWorkerUrl() {
    if (workerUrl) return workerUrl;
    let url = performance.getEntriesByType('resource')
      .map((e) => e.name)
      .find((name) => /assets\/evaluationWorker-[\w-]+\.js/.test(name));
    const bundle = document.querySelector('script[type=module][src]')?.src;
    if (!url && bundle) {
      try {
        const source = await fetch(bundle).then((r) => r.text());
        const match = source.match(/[\w./-]*assets\/evaluationWorker-[\w-]+\.js/);
        if (match) url = match[0].startsWith('/') ? match[0] : '/' + match[0];
      } catch (e) { /* fall back to the default below */ }
    }
    workerUrl = url || '/assets/evaluationWorker-BKbzsoAA.js';
    return workerUrl;
  }

  // ---- Game data ----
  // Has to match the live game. When the site changes caps, costs or the
  // attribute tree, update these tables.

  // talents: [key, cap]. Every talent point costs 1.
  // attrs:   [key, cap, cost per rank]. INF means no cap.
  // These are the default caps. The optimizer raises a cap if the account has
  // already gone past it in any build.
  const INF = Infinity;
  const DATA = {
    borge: {
      talents: [['revival', 2], ['loth', 5], ['ua', 5], ['impeccable', 10], ['omen', 10], ['ll', 10], ['pog', 15], ['ultima', 50], ['tfow', 15]],
      attrs: [['ares', INF, 1], ['ylith', INF, 1], ['spartan', 6, 2], ['timeless', 5, 3], ['battle', 3, 5], ['athena', 1, 15], ['baal', 6, 3], ['sensors', 6, 2],
        ['atlas', 6, 3], ['mino', 20, 2], ['htb', 10, 2], ['exp', 6, 3], ['weak', 6, 2], ['hermes', 20, 2], ['lfin', 10, 2]],
    },
    ozzy: {
      talents: [['revival', 2], ['boon', 1], ['ua', 5], ['needles', 10], ['omen', 10], ['ll', 10], ['crip', 15], ['ultima', 50], ['echo', 20]],
      attrs: [['lotl', INF, 1], ['exo', INF, 1], ['scorp', 5, 3], ['dance', 4, 3], ['cat', 20, 2], ['timeless', 5, 3], ['ibu', 5, 2], ['exterm', 5, 2],
        ['medusa', 5, 3], ['scarab', 20, 2], ['vect', 10, 2], ['snek', 5, 3], ['cycle', 5, 3], ['deal', 3, 5], ['sisters', 1, 15]],
    },
    knox: {
      talents: [['revival', 2], ['calyp', 5], ['ua', 5], ['ghost', 15], ['omen', 10], ['ll', 10], ['pog', 10], ['ultima', 50], ['finish', 15]],
      attrs: [['kraken', INF, 1], ['soul', 100, 1], ['dead', 10, 2], ['sear', 5, 2], ['pl', 10, 3], ['time', 5, 3], ['kot', 5, 5], ['pct', 10, 4],
        ['spa', 50, 2], ['fe', 10, 2], ['sop', 10, 3]],
    },
  };

  const LABELS = {
    // talents
    revival: 'Death Is My Companion', ua: 'The Unfair Advantage', omen: 'The Omen Of Defeat', ll: 'Call Me Lucky Loot',
    pog: 'Presence Of A God', ultima: 'The Legacy of Ultima', loth: 'Life of the Hunt', impeccable: 'Impeccable Impacts',
    tfow: 'The Fires of War', boon: 'Tricksters Boon', needles: 'Thousand Needles', crip: 'Crippling Shots', echo: 'Echo Bullets',
    calyp: "Calypso's Advantage", ghost: 'Ghost Bullets', finish: 'Finishing Move',
    // Borge attributes
    ares: 'Soul Of Ares', ylith: 'Essence Of Ylith', spartan: 'Spartan Lineage', timeless: 'Timeless Mastery', battle: 'Born For Battle',
    athena: 'Soul Of Athena', baal: 'Book Of Baal', sensors: 'Superior Sensors', atlas: 'The Atlas Protocol', mino: 'Soul Of The Minotaur',
    htb: 'Helltouch Barrier', exp: 'Explosive Punches', weak: 'Weakspot Analysis', hermes: 'Soul Of Hermes', lfin: 'Lifedrain Inhaler',
    // Ozzy attributes
    lotl: 'Living Off The Land', exo: 'Exo Piercers', scorp: 'Shimmering Scorpions', dance: 'Dance Of Dashes', cat: 'Blessing Of The Cat',
    ibu: 'Wings Of Ibu', exterm: 'Extermination Protocol', medusa: 'Gift Of Medusa', scarab: 'Blessing Of The Scarab', vect: 'Vectid Elixir',
    snek: 'Soul Of Snek', cycle: 'The Cycle Of Death', deal: 'A Deal With Death', sisters: 'Blessing Of The Sisters',
    // Knox attributes
    kraken: 'Release The Kraken', soul: 'Soul Amplification', dead: 'Dead Men Tell No Tales', sear: 'Searious Efficiency',
    pl: 'A Pirates Life for Knox', time: 'Timeless Mastery', kot: 'King Of Torpedos', pct: 'Passive Charge Tank',
    spa: 'Space Pirate Armory', fe: 'Fortification Elixir', sop: 'Shield of Poseidon',
  };

  // Attribute tree (the app's ATTRIBUTE_DEPENDENCIES): an attribute can only hold
  // points once each attribute listed for it has at least 1. Talents have no tree.
  const REQUIRES = {
    borge: { ylith: ['ares'], baal: ['ares'], htb: ['ares'], exp: ['htb'], spartan: ['ylith'], timeless: ['spartan'], sensors: ['baal'],
      lfin: ['htb'], atlas: ['sensors'], weak: ['exp'], battle: ['spartan'], athena: ['battle'], mino: ['atlas'], hermes: ['weak'] },
    ozzy: { exo: ['lotl'], ibu: ['lotl'], scorp: ['exo'], timeless: ['exo'], exterm: ['ibu'], snek: ['exterm'], vect: ['exterm'],
      cycle: ['snek'], deal: ['cycle'], medusa: ['exterm'], dance: ['scorp'], sisters: ['deal'], scarab: ['medusa'], cat: ['dance'] },
    knox: { soul: ['kraken'], dead: ['soul'], spa: ['kraken'], pl: ['spa'], time: ['pl'], sear: ['kraken'], pct: ['sear'],
      kot: ['pct'], fe: ['kraken'], sop: ['fe'] },
  };

  // How many attribute points have to be spent before each attribute unlocks
  // (the app's ATTRIBUTE_MIN_VALUE). Anything not listed unlocks at 0.
  const UNLOCK_AT = {
    borge: { atlas: 75, weak: 75, battle: 75, mino: 150, hermes: 150, athena: 180 },
    ozzy: { deal: 90, medusa: 90, dance: 90, scarab: 150, cat: 150, sisters: 180 },
    knox: {},
  };

  // ---- Build codes ----
  // Our own copy of the site's share-code format, so the result can be pasted
  // straight into the app's Import box.

  const HUNTER_KIND = { borge: 1, ozzy: 3, knox: 6 };
  const BASE_STATS = {
    borge: ['hp', 'atk', 'regen', 'dr', 'evade', 'effect', 'critchance', 'critpower', 'atkspeed', 'stage'],
    ozzy: ['hp', 'atk', 'regen', 'dr', 'evade', 'effect', 'multichance', 'multipower', 'atkspeed', 'stage'],
    knox: ['hp', 'atk', 'regen', 'dr', 'block', 'effect', 'charge', 'chargeGain', 'reload', 'proj', 'stage'],
  };

  // Gem planner upgrade names that the app stores under a different key.
  const GEM_UPGRADE_KEYS = {
    'borge-loot-bonus': 'attraction_lootBorge', 'ozzy-loot-bonus': 'attraction_lootOzzy', 'knox-loot-bonus': 'attraction_lootKnox',
    'catch-up-power-borge-ozzy': 'attraction_catchUp', 'catch-up-power': 'attraction_catchUp', 'catch-up-power-knox': 'attraction_catchUp2',
    'borge-stat-bonus': 'creation_borgeGU', 'ozzy-stat-bonus': 'creation_ozzyGU', 'knox-stat-bonus': 'creation_knoxGU',
  };

  // The values packed into a build code, in order. These must match the app's
  // BUILD_CODE_PARAMS exactly. If the order is off by one, the code decodes to garbage.
  const BUILD_CODE_PARAMS = {
    borge: ['revival', 'loth', 'ua', 'impeccable', 'omen', 'll', 'pog', 'tfow', 'ares', 'ylith', 'spartan', 'timeless', 'baal', 'sensors', 'htb', 'lfin', 'exp', 'atlas', 'weak', 'battle', 'hp', 'atk', 'regen', 'dr', 'evade', 'effect', 'critchance', 'critpower', 'atkspeed', 'upgrades.loopmods.trample', 'upgrades.relics.r4', 'upgrades.relics.r16', 'upgrades.relics.r19', 'upgrades.inscryptions.i3', 'upgrades.inscryptions.i4', 'upgrades.inscryptions.i11', 'upgrades.inscryptions.i13', 'upgrades.inscryptions.i23', 'upgrades.inscryptions.i24', 'upgrades.inscryptions.i27', 'upgrades.inscryptions.i60', 'upgrades.gems_nodes.creation_gem1', 'upgrades.gems_nodes.creation_gem2', 'upgrades.gems_nodes.creation_gem3', 'upgrades.gems_nodes.innovation_gem3', 'upgrades.gems_nodes.attraction_gem2', 'upgrades.gems_nodes.attraction_level', 'upgrades.gems_nodes.attraction_catchUp', 'upgrades.inscryptions.i84', 'upgrades.inscryptions.i87', 'upgrades.inscryptions.i88', 'upgrades.inscryptions.i89', 'upgrades.inscryptions.i91', 'ultima', 'athena', 'mino', 'hermes', 'upgrades.gadgets.wrench', 'upgrades.diamondcards.gaiden', 'upgrades.diamondspecials.reviveboost', 'upgrades.gems_nodes.creation_borgeGU', 'upgrades.gems_nodes.evolution_gem3', 'upgrades.gems_nodes.temporal_gem4', 'upgrades.loopmods.stelzi', 'upgrades.inscryptions.i103', 'upgrades.gems_nodes.exodus_gem3', 'upgrades.gems_nodes.exodus_gem4', 'upgrades.cms.milestoneCount', 'upgrades.gems_nodes.temporal_gem6', 'upgrades.gems_nodes.creation_gem4', 'upgrades.gems_nodes.creation_gem5', 'upgrades.gems_nodes.evolution_gem6', 'upgrades.relics.t2r7', 'upgrades.gems_nodes.power_level'],
    ozzy: ['revival', 'boon', 'ua', 'needles', 'omen', 'll', 'crip', 'echo', 'lotl', 'exo', 'scorp', 'timeless', 'ibu', 'exterm', 'snek', 'vect', 'cycle', 'deal', 'medusa', 'dance', 'hp', 'atk', 'regen', 'dr', 'evade', 'effect', 'multichance', 'multipower', 'atkspeed', 'upgrades.relics.r4', 'upgrades.relics.r17', 'upgrades.inscryptions.i31', 'upgrades.inscryptions.i36', 'upgrades.inscryptions.i37', 'upgrades.inscryptions.i40', 'upgrades.gems_nodes.innovation_gem2', 'upgrades.gems_nodes.innovation_gem3', 'upgrades.gems_nodes.attraction_level', 'upgrades.gems_nodes.attraction_catchUp', 'upgrades.inscryptions.i86', 'upgrades.inscryptions.i92', 'ultima', 'sisters', 'scarab', 'cat', 'upgrades.gadgets.zaptron', 'upgrades.diamondcards.iridian', 'upgrades.diamondspecials.reviveboost', 'upgrades.gems_nodes.creation_ozzyGU', 'upgrades.gems_nodes.evolution_gem3', 'upgrades.loopmods.stelzi', 'upgrades.gems_nodes.exodus_gem3', 'upgrades.gems_nodes.exodus_gem4', 'upgrades.cms.milestoneCount', 'upgrades.gems_nodes.temporal_gem6', 'upgrades.gems_nodes.creation_gem4', 'upgrades.gems_nodes.creation_gem5', 'upgrades.gems_nodes.creation_gem6', 'upgrades.gems_nodes.evolution_gem6', 'upgrades.relics.t2r7', 'upgrades.gems_nodes.power_level'],
    knox: ['revival', 'calyp', 'ua', 'ghost', 'omen', 'll', 'pog', 'finish', 'ultima', 'kraken', 'spa', 'pl', 'time', 'soul', 'dead', 'fe', 'sop', 'sear', 'pct', 'kot', 'hp', 'atk', 'regen', 'dr', 'block', 'effect', 'charge', 'chargeGain', 'reload', 'proj', 'upgrades.diamondspecials.reviveboost', 'stage', 'upgrades.gadgets.anchor', 'upgrades.gems_nodes.creation_knoxGU', 'upgrades.gems_nodes.evolution_gem3', 'upgrades.gems_nodes.exodus_gem4', 'upgrades.cms.milestoneCount', 'upgrades.gems_nodes.temporal_gem6', 'upgrades.gems_nodes.creation_gem4', 'upgrades.gems_nodes.creation_gem5', 'upgrades.gems_nodes.power_gem6', 'upgrades.gems_nodes.evolution_gem6', 'upgrades.gems_nodes.attraction_level', 'upgrades.gems_nodes.attraction_catchUp2', 'upgrades.relics.t2r7', 'upgrades.gems_nodes.power_level'],
  };

  // Upgrades are addressed with dotted keys like "upgrades.relics.r4" or
  // "upgrades.gems_nodes.creation_gem1". Returns the path under `upgrades`, or
  // null for any other shape (the app ignores those too).
  function upgradePath(key) {
    const path = key.split('.').slice(1);
    return path.length === 2 || path.length === 3 ? path : null;
  }
  const getIn = (obj, path) => path.reduce((o, k) => o?.[k], obj);
  function setIn(obj, path, value) {
    let node = obj;
    for (const k of path.slice(0, -1)) node = node[k] = node[k] || {};
    node[path[path.length - 1]] = value;
  }

  // Before encoding, the app flattens the gem planner state into
  // upgrades.gems_nodes, e.g. { creation_level: 3, creation_gem1: 1, ... }.
  function flattenGems(gemStates, upgrades) {
    if (!gemStates) return;
    const nodes = upgrades.gems_nodes = {};
    for (const [gem, state] of Object.entries(gemStates)) {
      if (!state) continue;
      nodes[gem + '_level'] = state.level > 0 ? state.level : 0;
      if (Array.isArray(state.nodes)) state.nodes.forEach((on, i) => { nodes[`${gem}_gem${i + 1}`] = on ? 1 : 0; });
      for (const [k, v] of Object.entries(state.upgrades || {})) nodes[GEM_UPGRADE_KEYS[k] || `${gem}_${k}`] = v;
    }
  }

  // The account-wide state a build code draws on (stats, upgrades, gems), with
  // this build's overrides applied on top.
  function encodingContext(hunterId, build) {
    const { hunter, gems } = stores();
    const ctx = { hunterStats: clone(hunter.hunterStats), upgrades: clone(hunter.upgrades) };
    flattenGems(clone(gems?.$state?.gemStates || gems?.gemStates), ctx.upgrades);
    for (const [key, value] of Object.entries(build.overrides || {})) {
      if (key.startsWith('upgrades.')) {
        const path = upgradePath(key);
        if (path) setIn(ctx.upgrades, path, value);
      } else {
        (ctx.hunterStats[hunterId] = ctx.hunterStats[hunterId] || {})[key] = value;
      }
    }
    return ctx;
  }

  // Looks a param up the same way the app does: overrides first, then talents,
  // attributes, base stats, and finally account upgrades.
  function paramValue(param, build, ctx, hunterId) {
    if (build.overrides && param in build.overrides) return build.overrides[param] ?? 0;
    if (build.talents && param in build.talents) return build.talents[param] ?? 0;
    if (build.attributes && param in build.attributes) return build.attributes[param] ?? 0;
    if ((BASE_STATS[hunterId] || []).includes(param)) return ctx.hunterStats?.[hunterId]?.[param] ?? 0;
    if (param === 'lvl') return build.level ?? 0;
    if (param.startsWith('upgrades.')) {
      const path = upgradePath(param);
      return (path && getIn(ctx.upgrades, path)) ?? 0;
    }
    return 0;
  }

  // Byte layout, copied from the app: a fixed 101 byte, a header byte with the
  // hunter kind in its top three bits, then the values in groups of four. Each
  // group starts with one byte holding four 2-bit size tags (0 = the value is 0,
  // 1 = it's 1, 2 = one byte follows, 3 = two bytes follow, high byte first),
  // followed by those bytes. Values are rounded and clamped to 0..65535.
  function packValues(kind, values) {
    const out = [101, kind << 5];
    const tagOf = (v) => (v === 0 ? 0 : v === 1 ? 1 : v <= 255 ? 2 : 3);
    for (let i = 0; i < values.length; i += 4) {
      const group = values.slice(i, i + 4).map((x) => Math.min(65535, Math.max(0, Math.round(+x) || 0)));
      while (group.length < 4) group.push(0);
      out.push(group.reduce((acc, v) => (acc << 2) | tagOf(v), 0));
      for (const v of group) {
        if (tagOf(v) === 2) out.push(v);
        else if (tagOf(v) === 3) out.push(v >> 8, v & 255);
      }
    }
    return Uint8Array.from(out);
  }

  // Bitcoin-style base58: no 0, O, I or l. Leading zero bytes become '1'.
  const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  function base58(bytes) {
    const digits = [0];
    for (const byte of bytes) {
      let carry = byte;
      for (let j = 0; j < digits.length; j++) {
        carry += digits[j] << 8;
        digits[j] = carry % 58;
        carry = (carry / 58) | 0;
      }
      while (carry) {
        digits.push(carry % 58);
        carry = (carry / 58) | 0;
      }
    }
    let str = '';
    for (let k = 0; k < bytes.length && bytes[k] === 0; k++) str += BASE58_ALPHABET[0];
    for (let q = digits.length - 1; q >= 0; q--) str += BASE58_ALPHABET[digits[q]];
    return str;
  }

  function generateBuildCode(build, hunterId) {
    try {
      const ctx = encodingContext(hunterId, build);
      const values = BUILD_CODE_PARAMS[hunterId].map((p) => paramValue(p, build, ctx, hunterId));
      return base58(packValues(HUNTER_KIND[hunterId], values));
    } catch (e) {
      console.error(`${TAG} couldn't generate a build code`, e);
      return null;
    }
  }

  // ---- App state ----
  // Everything we need is in the app's Pinia stores, reachable through the Vue
  // app mounted on #app.

  function piniaStores() {
    const app = document.querySelector('#app')?.__vue_app__;
    return app?.config.globalProperties.$pinia?._s ?? null;
  }

  function stores() {
    const s = piniaStores();
    if (!s) throw new Error('app not ready');
    return { hunter: s.get('hunter'), gems: s.get('gemPlanner') };
  }

  // The same context object the app hands to evaluate().
  function appContext() {
    const { hunter, gems } = stores();
    return {
      hunterStats: clone(hunter.hunterStats),
      upgrades: clone(hunter.upgrades),
      hunterIterations: clone(hunter.hunterIterations),
      hunterSeedSettings: clone(hunter.hunterSeedSettings),
      gemPlannerStore: clone(gems?.$state ?? gems),
    };
  }

  function buildsFor(hunterId) {
    const { hunter } = stores();
    return (hunter.hunterBuilds?.[hunterId] || []).map((b) => clone(b));
  }

  // Ultima and other advanced talents only open up at hunter level 70. If we
  // can't tell, assume they're unlocked.
  function advancedTalentsUnlocked(hunterId) {
    try {
      const { hunter } = stores();
      if (typeof hunter.shouldShowAdvancedTalents === 'function') return !!hunter.shouldShowAdvancedTalents(hunterId);
      return !!hunter.hunterLevelSettings?.[hunterId]?.showAdvancedTalents;
    } catch (e) {
      return true;
    }
  }

  // ---- Worker pool ----
  // A few copies of the site's own evaluation worker. The worker talks Comlink,
  // so we send Comlink-shaped messages by hand instead of loading the library.
  class WorkerPool {
    constructor(size) {
      this.workers = Array.from({ length: size }, () => this._spawn());
      this.busy = new Set();
      this.queue = [];
      this.nextId = 0;
    }

    get size() { return this.workers.length; }

    _spawn() { return new Worker(workerUrl, { type: 'module' }); }

    // Resolves with the app's result object, or null if the evaluation failed.
    evaluate(hunterId, build, ctx) {
      return new Promise((resolve) => {
        this.queue.push({ hunterId, build, ctx, resolve, retries: 0 });
        this._pump();
      });
    }

    _pump() {
      while (this.queue.length) {
        const worker = this.workers.find((w) => !this.busy.has(w));
        if (!worker) break;
        this.busy.add(worker);
        this._run(worker, this.queue.shift());
      }
    }

    _run(worker, job) {
      const id = 'opt' + ++this.nextId;

      // The timeout grows with the iteration count, so a big but healthy run
      // isn't cut off. It's only there to catch a worker that has hung.
      const iters = job.ctx?.hunterIterations?.[job.hunterId] || 1000;
      const timeoutMs = Math.max(30000, iters * 3 + 10000);

      const finish = (value) => {
        clearTimeout(timer);
        worker.removeEventListener('message', onMessage);
        this.busy.delete(worker);
        job.resolve(value);
        this._pump();
      };

      // Comlink answers with { type: 'RAW', value } on success. A thrown error
      // comes back as a 'HANDLER' message, which we count as a failed evaluation.
      const onMessage = (e) => {
        if (e.data?.id === id) finish(e.data.type === 'RAW' ? e.data.value : null);
      };

      // A hung worker can't be trusted again, so swap in a fresh one and retry
      // the same candidate. After three retries, give up on that candidate.
      const timer = setTimeout(() => {
        worker.removeEventListener('message', onMessage);
        this.busy.delete(worker);
        worker.terminate();
        this.workers[this.workers.indexOf(worker)] = this._spawn();
        if (++job.retries <= 3) {
          console.warn(`${TAG} a worker stalled and was replaced. Retrying (attempt ${job.retries + 1}).`);
          this.queue.unshift(job);
        } else {
          console.warn(`${TAG} still failing after 3 retries, skipping this candidate`);
          job.resolve(null);
        }
        this._pump();
      }, timeoutMs);

      worker.addEventListener('message', onMessage);
      worker.postMessage({
        id, type: 'APPLY', path: ['evaluate'],
        argumentList: [job.hunterId, job.build, job.ctx].map((value) => ({ type: 'RAW', value })),
      });
    }
  }

  let pool = null;
  async function getPool() {
    if (!pool) {
      await resolveWorkerUrl();
      // Leave a core for the page itself, and keep it between 2 and 8 workers.
      pool = new WorkerPool(Math.max(2, Math.min(8, (navigator.hardwareConcurrency || 4) - 1)));
    }
    return pool;
  }

  // Failed evaluations score -1 so they never win.
  const scoreOf = (result) => (typeof result?.lootPerMin === 'number' ? result.lootPerMin : -1);

  function withIterations(ctx, hunterId, iters) {
    const copy = clone(ctx);
    copy.hunterIterations = { ...copy.hunterIterations, [hunterId]: iters };
    return copy;
  }

  // ---- Optimizer ----
  // A "state" is { tv, av, score }: talent and attribute point arrays (in DATA
  // order) plus the score for that combination. States and their arrays are
  // never changed after they're made, so they can be shared without copying.
  //
  // Evaluations are slow (over a second each) and only scale so far across
  // workers, so the search sends them out a pool-sized batch at a time.
  async function optimize(hunterId, build, opts, onProgress) {
    const { pool } = opts;
    const searchCtx = withIterations(opts.ctx, hunterId, opts.searchIters);
    const finalCtx = withIterations(opts.ctx, hunterId, opts.finalIters);

    // Start from the game's default caps, but raise them to whatever this
    // account has already reached in any build.
    const allBuilds = buildsFor(hunterId);
    const highestSeen = (field, key) => Math.max(0, ...allBuilds.map((b) => pointsIn(b[field], key)));
    const talents = DATA[hunterId].talents.map(([key, cap]) => ({
      key, cap: Math.max(cap, pointsIn(build.talents, key), highestSeen('talents', key)),
    }));
    const attrs = DATA[hunterId].attrs.map(([key, cap, cost]) => ({
      key, cost, cap: Math.max(cap, pointsIn(build.attributes, key), highestSeen('attributes', key)),
    }));

    // Below level 70, Ultima stays exactly where it is. Adding points to it
    // would give a build the player can't actually make.
    if (!advancedTalentsUnlocked(hunterId)) {
      const ultima = talents.find((t) => t.key === 'ultima');
      if (ultima) ultima.cap = pointsIn(build.talents, 'ultima');
    }

    const start = {
      tv: talents.map((t) => pointsIn(build.talents, t.key)),
      av: attrs.map((a) => pointsIn(build.attributes, a.key)),
    };
    const talentBudget = start.tv.reduce((sum, x) => sum + x, 0);
    const attrBudget = start.av.reduce((sum, x, i) => sum + x * attrs[i].cost, 0);

    const attrIndex = Object.fromEntries(attrs.map((a, i) => [a.key, i]));
    const requires = REQUIRES[hunterId] || {};
    const unlockAt = UNLOCK_AT[hunterId] || {};

    // Could a player actually reach this attribute allocation? Each attribute
    // has to stay under its cap and have its parents at 1 or more. The unlock
    // threshold is trickier. It counts the points already spent when an
    // attribute gets its first point, so an attribute can't count its own
    // points toward its own unlock. To check, we fill attributes in order of
    // their threshold and make sure the ones before cover each threshold.
    function attrsValid(av) {
      const active = [];
      for (let i = 0; i < av.length; i++) {
        if (av[i] <= 0) continue;
        if (av[i] > attrs[i].cap) return false;
        for (const parent of requires[attrs[i].key] || []) {
          const p = attrIndex[parent];
          if (p == null || av[p] < 1) return false;
        }
        active.push(i);
      }
      const threshold = (i) => unlockAt[attrs[i].key] || 0;
      active.sort((a, b) => threshold(a) - threshold(b));
      let spent = 0;
      for (const i of active) {
        if (spent < threshold(i)) return false;
        spent += av[i] * attrs[i].cost;
      }
      return true;
    }

    // Copy the build with our point arrays applied. Overrides can pin talent
    // and attribute values, so drop those or our changes wouldn't take effect.
    function makeBuild(tv, av) {
      const b = clone(build);
      b.talents = { ...b.talents };
      b.attributes = { ...b.attributes };
      talents.forEach((t, i) => { b.talents[t.key] = tv[i]; });
      attrs.forEach((a, i) => { b.attributes[a.key] = av[i]; });
      if (b.overrides) for (const { key } of [...talents, ...attrs]) delete b.overrides[key];
      return b;
    }

    let evals = 0;
    const evaluate = async (s) => {
      evals++;
      return scoreOf(await pool.evaluate(hunterId, makeBuild(s.tv, s.av), searchCtx));
    };

    // Talent move: take one point from one talent and give it to another.
    function talentMoves(tv) {
      const out = [];
      for (let a = 0; a < tv.length; a++) {
        if (tv[a] <= 0) continue;
        for (let b = 0; b < tv.length; b++) {
          if (a === b || tv[b] >= talents[b].cap) continue;
          const next = tv.slice();
          next[a]--;
          next[b]++;
          out.push(next);
        }
      }
      return out;
    }

    // Attribute move: swap points between two attributes so the total cost
    // stays the same, e.g. 3 points at cost 2 for 2 points at cost 3. We try
    // the smallest such swap and double it, and skip any result the attribute
    // tree wouldn't allow.
    function attrMoves(av) {
      const out = [];
      for (let a = 0; a < av.length; a++) {
        if (av[a] <= 0) continue;
        for (let b = 0; b < av.length; b++) {
          if (a === b || av[b] >= attrs[b].cap) continue;
          const unit = lcm(attrs[a].cost, attrs[b].cost);
          for (let mult = 1; mult <= 2; mult++) {
            const take = unit / attrs[a].cost * mult;
            const give = unit / attrs[b].cost * mult;
            if (av[a] - take < 0 || av[b] + give > attrs[b].cap) break;
            const next = av.slice();
            next[a] -= take;
            next[b] += give;
            if (attrsValid(next)) out.push(next);
          }
        }
      }
      return out;
    }

    // Every legal single move from a state, talent moves first.
    const neighbours = (s) => [
      ...talentMoves(s.tv).map((tv) => ({ tv, av: s.av })),
      ...attrMoves(s.av).map((av) => ({ tv: s.tv, av })),
    ];

    let best = { ...start, score: await evaluate(start) };
    onProgress?.({ phase: 'baseline', score: best.score, evals });

    const margin = 1 + (opts.margin || 0);
    const poolSize = pool.size || 4;
    const timeLimitMs = opts.timeMs || 90000;
    const patience = opts.patience ?? 4;
    const t0 = performance.now();
    const keepGoing = () => performance.now() - t0 < timeLimitMs && !opts.shouldStop?.();
    const progress = () => onProgress?.({ phase: 'search', score: best.score, evals, elapsed: (performance.now() - t0) / 1000 });

    // To count as better, a score has to beat the reference by the margin.
    // That keeps the search from chasing simulation noise. The plain `s > ref`
    // check is for negative scores: there, ref * margin is less than ref, so one
    // failed evaluation (-1) would otherwise "beat" another and the search could
    // wander forever.
    const beats = (s, ref) => s > ref && s > ref * margin;

    function record(s) {
      if (s.score <= best.score) return false;
      best = s;
      return true;
    }

    // Score candidates a batch at a time and return the best one that beats
    // `ref`, or null. Stops early if time runs out, after `limit` candidates,
    // or (with firstHit) as soon as a batch turns up any improvement at all.
    async function findImprovement(cands, ref, { limit = cands.length, firstHit = false } = {}) {
      let found = null;
      for (let i = 0; i < limit && !(firstHit && found) && keepGoing();) {
        const batch = cands.slice(i, i + poolSize);
        i += batch.length;
        const scores = await Promise.all(batch.map((s) => evaluate(s)));
        batch.forEach((s, j) => {
          if (beats(scores[j], ref) && (!found || scores[j] > found.score)) found = { ...s, score: scores[j] };
        });
        progress();
      }
      return found;
    }

    // Steepest ascent from the best state: keep taking the single best move
    // until a full scan finds nothing better, or we've taken maxSteps.
    async function climb(maxSteps = Infinity) {
      let cur = best;
      for (let step = 0; step < maxSteps && keepGoing(); step++) {
        const next = await findImprovement(neighbours(cur), cur.score);
        if (!next) break;
        cur = next;
        record(cur);
      }
    }

    const mode = opts.mode || 'balanced';

    if (mode === 'thorough') {
      await climb();
    } else if (mode === 'exploratory') {
      // Simulated annealing. Try a random move. Keep it if it's better, and
      // sometimes keep it even when it's worse, with probability exp(change / T).
      // T starts at Heat (0-100 maps to a 0-5% relative change) and cools to
      // zero, so the search roams early and settles later. Then a short
      // steepest-ascent polish from the best build it found. The UI raises the
      // sim count for this mode so keep/reject isn't decided by noise.
      const samples = Math.max(50, opts.samples || 400);
      const startTemp = Math.max(0, opts.heat ?? 50) / 100 * 0.05;
      let cur = best;
      for (let step = 0; step < samples && keepGoing(); step++) {
        const temp = startTemp * (1 - step / samples);
        const useTalent = Math.random() < 0.5;
        const moves = useTalent ? talentMoves(cur.tv) : attrMoves(cur.av);
        if (!moves.length) continue;
        const pick = moves[randInt(moves.length)];
        const cand = useTalent ? { tv: pick, av: cur.av } : { tv: cur.tv, av: pick };
        const score = await evaluate(cand);
        const change = cur.score > 0 ? (score - cur.score) / cur.score : score - cur.score;
        if (change >= 0 || (temp > 0 && Math.random() < Math.exp(change / temp))) {
          cur = { ...cand, score };
          record(cur);
        }
        if (step % 4 === 0) progress();
      }
      await climb(5);
    } else {
      // Balanced, the default: a randomised hill-climb. Each round shuffles
      // the neighbours, scores a capped number of them, and takes the best
      // improvement from the first batch that has one. When a round finds
      // nothing, jump back to the best build so far, nudge it with a few random
      // moves and keep climbing. It stops after `patience` restarts in a row
      // fail to beat the best, so even an unlimited run finishes.
      let cur = best;
      let failedRestarts = 0;
      let improvedSinceRestart = false;
      while (failedRestarts <= patience && keepGoing()) {
        const cands = neighbours(cur);
        if (!cands.length) break;
        shuffle(cands);
        const limit = Math.min(cands.length, Math.max(poolSize * 4, 24));
        const next = await findImprovement(cands, cur.score, { limit, firstHit: true });
        if (next) {
          cur = next;
          if (record(cur)) improvedSinceRestart = true;
        } else {
          failedRestarts = improvedSinceRestart ? 0 : failedRestarts + 1;
          improvedSinceRestart = false;
          let { tv, av } = best;
          for (let k = 0; k < 3; k++) { const m = talentMoves(tv); if (m.length) tv = m[randInt(m.length)]; }
          for (let k = 0; k < 3; k++) { const m = attrMoves(av); if (m.length) av = m[randInt(m.length)]; }
          cur = { tv, av, score: await evaluate({ tv, av }) };
        }
      }
    }

    // The search uses a quick, lower-resolution score, so its winner can turn
    // out to be no better once we look closely. Score the starting build and
    // the winner again at full resolution, and only suggest the change if it
    // really is better. Otherwise we keep the current build.
    const fullScore = async (s) => scoreOf(await pool.evaluate(hunterId, makeBuild(s.tv, s.av), finalCtx));
    const beforeFull = await fullScore(start);
    let afterFull = await fullScore(best);
    let winner = best;
    if (afterFull <= beforeFull) {
      winner = start;
      afterFull = beforeFull;
    }

    return {
      hunterId,
      build,
      talents: talents.map((t, i) => ({ key: t.key, label: LABELS[t.key] || t.key, from: start.tv[i], to: winner.tv[i], cap: t.cap })),
      attrs: attrs.map((a, i) => ({ key: a.key, label: LABELS[a.key] || a.key, cost: a.cost, from: start.av[i], to: winner.av[i], cap: a.cap })),
      talentBudget,
      attrBudget,
      evals,
      beforeFull,
      afterFull,
      pctGain: beforeFull > 0 ? (afterFull / beforeFull - 1) * 100 : 0,
      optimizedBuild: () => makeBuild(winner.tv, winner.av),
    };
  }

  // ---- UI ----

  const CSS = `
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
  .cifi-up{color:#22c55e}.cifi-down{color:#f87171}.cifi-same{color:#64748b}
  .cifi-kpi{display:flex;gap:18px;flex-wrap:wrap;margin:8px 0 4px}
  .cifi-kpi div b{display:block;font-size:19px}
  .cifi-cols{display:grid;grid-template-columns:1fr 1fr;gap:18px}
  @media(max-width:640px){.cifi-cols{grid-template-columns:1fr}}`;

  // Same suffixes as the site (qa = 1e15), so our numbers read like the app's.
  const SUFFIXES = ['', 'k', 'm', 'b', 't', 'qa', 'qu', 'sx', 'sp', 'o', 'n', 'd'];
  function formatScore(n) {
    if (!isFinite(n)) return '—';
    const tier = Math.max(0, Math.min(SUFFIXES.length - 1, Math.floor(Math.log10(Math.abs(n)) / 3)));
    return (n / 1000 ** tier).toFixed(2) + SUFFIXES[tier];
  }

  const DEFAULTS = { searchIters: 1200, finalIters: 10000, maxSeconds: 75, heat: 50, samples: 400 };

  const MODE_HELP = {
    balanced: 'Balanced: a quick randomised search that climbs from the best build so far and restarts when it gets stuck. A good default.',
    thorough: 'Thorough: tries every legal move on each pass and takes the best, until nothing helps. Slower, but squeezes the most out of a solid build.',
    exploratory: 'Exploratory: early on it sometimes accepts a worse build (more often with higher Heat) to escape a dead end. Runs more sims per check so the choices are stable.',
  };

  // Builds are grouped into categories: active, archived, and any the player
  // made. Use the store's helpers when it has them, otherwise read its data.
  function buildCategory(hunter, hunterId, build) {
    try {
      const fromStore = typeof hunter.getBuildCategory === 'function' && hunter.getBuildCategory(hunterId, build.id);
      if (fromStore) return fromStore;
      const mapped = hunter.buildCategories?.[hunterId]?.buildCategoryMap?.[build.id];
      if (mapped) return mapped;
    } catch (e) { /* fall back to the archived flag */ }
    return build.isArchived ? 'archived' : 'active';
  }

  function categoryName(hunter, hunterId, catId) {
    try {
      const cats = (typeof hunter.getCategories === 'function' && hunter.getCategories(hunterId))
        || hunter.buildCategories?.[hunterId]?.categories || [];
      const cat = cats.find((c) => c.id === catId);
      if (cat) return cat.name;
    } catch (e) { /* fall back to the id */ }
    return !catId || catId === 'active' ? 'Active' : catId;
  }

  function openModal() {
    let hunterIds;
    try {
      const { hunter } = stores();
      hunterIds = HUNTERS.filter((h) => !hunter.hunterBuilds || h in hunter.hunterBuilds);
    } catch (e) {
      alert("CIFI Optimizer: the app isn't ready yet. Open a hunter page first.");
      return;
    }

    const wrap = document.createElement('div');
    wrap.id = 'cifi-opt-modal';
    wrap.innerHTML = `<div id="cifi-opt-card">
      <h2>🎯 Loot Score Optimizer <button class="cifi-x" id="cifi-close">×</button></h2>
      <div class="cifi-body">
        <div class="cifi-row">
          <label class="cifi-field">Hunter<select id="cifi-hunter">${hunterIds.map((h) => `<option value="${h}">${h[0].toUpperCase() + h.slice(1)}</option>`).join('')}</select></label>
          <label class="cifi-field">Build<select id="cifi-build" style="min-width:220px"></select></label>
          <label class="cifi-field" style="flex-direction:row;align-items:center;gap:6px;padding-bottom:9px"><input type="checkbox" id="cifi-hidearch" checked style="min-width:0">Hide archived</label>
          <label class="cifi-field">Mode<select id="cifi-mode" style="min-width:130px"><option value="balanced">Balanced</option><option value="thorough">Thorough</option><option value="exploratory">Exploratory</option></select></label>
          <label class="cifi-field">Search iters<input id="cifi-si" type="number" value="${DEFAULTS.searchIters}" min="200" step="100" style="width:90px"></label>
          <label class="cifi-field">Final iters<input id="cifi-fi" type="number" value="${DEFAULTS.finalIters}" min="1000" step="1000" style="width:90px"></label>
          <label class="cifi-field">Max time (s, 0=∞)<input id="cifi-tm" type="number" value="${DEFAULTS.maxSeconds}" min="0" step="15" style="width:80px"></label>
          <label class="cifi-field cifi-explor" style="display:none">Heat<input id="cifi-heat" type="number" value="${DEFAULTS.heat}" min="0" max="100" step="5" style="width:70px"></label>
          <label class="cifi-field cifi-explor" style="display:none">Samples<input id="cifi-samples" type="number" value="${DEFAULTS.samples}" min="50" step="50" style="width:80px"></label>
          <button class="cifi-btn" id="cifi-run">Optimize</button>
        </div>
        <div id="cifi-status" class="cifi-muted"></div>
        <div class="cifi-prog"><div id="cifi-bar"></div></div>
        <div id="cifi-out"></div>
      </div></div>`;
    document.body.appendChild(wrap);

    const $ = (sel) => wrap.querySelector(sel);
    const close = () => wrap.remove();
    $('#cifi-close').onclick = close;
    wrap.onclick = (e) => { if (e.target === wrap) close(); };

    // An empty or non-numeric box falls back to the default. A real 0 is kept
    // (Heat 0 is a valid choice).
    const numberFrom = (sel, fallback) => {
      const v = parseFloat($(sel).value);
      return Number.isFinite(v) ? v : fallback;
    };

    let builds = [];
    function fillBuilds() {
      const hunterId = $('#cifi-hunter').value;
      const hideArchived = $('#cifi-hidearch').checked;
      const { hunter } = stores();
      builds = buildsFor(hunterId);

      const groups = {};
      builds.forEach((b, i) => {
        const cat = buildCategory(hunter, hunterId, b);
        if (hideArchived && cat === 'archived') return;
        (groups[cat] = groups[cat] || []).push(`<option value="${i}">${escapeHtml(b.name || 'Unnamed')} — Lv${escapeHtml(b.level || '?')}</option>`);
      });

      // Active first, archived last, anything else alphabetically in between.
      const rank = (c) => (c === 'active' ? 0 : c === 'archived' ? 2 : 1);
      const name = (c) => categoryName(hunter, hunterId, c);
      const order = Object.keys(groups).sort((a, b) => rank(a) - rank(b) || name(a).localeCompare(name(b)));
      $('#cifi-build').innerHTML = order
        .map((cat) => `<optgroup label="${escapeHtml(name(cat))}">${groups[cat].join('')}</optgroup>`)
        .join('') || '<option disabled>(no builds)</option>';
    }

    function applyMode() {
      const mode = $('#cifi-mode').value;
      wrap.querySelectorAll('.cifi-explor').forEach((el) => { el.style.display = mode === 'exploratory' ? '' : 'none'; });
      $('#cifi-status').textContent = MODE_HELP[mode] || '';
    }

    $('#cifi-hunter').onchange = fillBuilds;
    $('#cifi-hidearch').onchange = fillBuilds;
    $('#cifi-mode').onchange = applyMode;

    // Start on whichever hunter's page is open.
    const pageHunter = location.pathname.match(/\/(borge|ozzy|knox)(?:\/|$)/)?.[1];
    if (pageHunter && hunterIds.includes(pageHunter)) $('#cifi-hunter').value = pageHunter;
    fillBuilds();
    applyMode();

    const runBtn = $('#cifi-run');
    async function startRun() {
      const hunterId = $('#cifi-hunter').value;
      const build = builds[+$('#cifi-build').value];
      if (!build) return;

      const mode = $('#cifi-mode').value || 'balanced';
      let searchIters = Math.max(200, numberFrom('#cifi-si', DEFAULTS.searchIters));
      const finalIters = Math.max(1000, numberFrom('#cifi-fi', DEFAULTS.finalIters));
      const maxSeconds = Math.max(0, numberFrom('#cifi-tm', 0));
      const heat = Math.max(0, Math.min(100, numberFrom('#cifi-heat', DEFAULTS.heat)));
      const samples = Math.max(50, numberFrom('#cifi-samples', DEFAULTS.samples));
      // Annealing compares one noisy score against another, so it needs more sims to be reliable.
      if (mode === 'exploratory') searchIters = Math.max(searchIters, 3000);

      // While the run is going, the Optimize button becomes a Stop button.
      let stopRequested = false;
      runBtn.textContent = '⏹ Stop';
      runBtn.disabled = false;
      runBtn.onclick = () => {
        stopRequested = true;
        runBtn.textContent = 'Stopping…';
        runBtn.disabled = true;
        $('#cifi-status').textContent = 'Stopping, will show the best build found so far…';
      };
      $('#cifi-out').innerHTML = '';
      $('#cifi-status').textContent = 'Warming up engine…';

      try {
        const t0 = performance.now();
        const result = await optimize(hunterId, build, {
          pool: await getPool(),
          ctx: appContext(),
          searchIters,
          finalIters,
          timeMs: maxSeconds > 0 ? maxSeconds * 1000 : Infinity, // 0 means run until it converges
          margin: 0.0005,
          patience: 4,
          shouldStop: () => stopRequested,
          mode,
          heat,
          samples,
        }, (p) => {
          // We can't know how long a run will take, so the bar just creeps
          // toward 98% as the evaluation count climbs.
          $('#cifi-bar').style.width = Math.min(98, p.evals / (p.evals + 40) * 100) + '%';
          $('#cifi-status').textContent =
            `${stopRequested ? 'Stopping' : 'Searching'}… ${p.evals} evals · best ${formatScore(p.score)} · ${(p.elapsed || 0).toFixed(0)}s`;
        });
        $('#cifi-bar').style.width = '100%';
        renderResult($, result, (performance.now() - t0) / 1000);
      } catch (e) {
        $('#cifi-status').textContent = 'Error: ' + (e?.message || e);
        console.error(TAG, e);
      } finally {
        runBtn.textContent = 'Optimize';
        runBtn.disabled = false;
        runBtn.onclick = startRun;
      }
    }
    runBtn.onclick = startRun;
  }

  function renderResult($, res, secs) {
    const gain = res.pctGain;
    const gainClass = gain > 0.05 ? 'cifi-up' : gain < -0.05 ? 'cifi-down' : 'cifi-same';
    const rowHtml = (r) => {
      const d = r.to - r.from;
      const cls = d > 0 ? 'cifi-up' : d < 0 ? 'cifi-down' : 'cifi-same';
      const arrow = d > 0 ? '▲' : d < 0 ? '▼' : '';
      return `<tr><td>${r.label}${r.cost ? ` <span class="cifi-muted">×${r.cost}</span>` : ''}</td>
        <td class="n">${r.from}</td><td class="n ${cls}">${arrow} ${r.to}</td>
        <td class="n cifi-muted">${isFinite(r.cap) ? r.cap : '∞'}</td></tr>`;
    };
    const changed = [...res.talents, ...res.attrs].some((r) => r.to !== r.from);

    $('#cifi-status').textContent =
      `Done in ${secs.toFixed(0)}s · ${res.evals} evaluations · budgets: ${res.talentBudget} talent pts, ${res.attrBudget} attribute pts.`;
    $('#cifi-out').innerHTML = `
      <div class="cifi-kpi">
        <div><span class="cifi-muted">Current Loot Score</span><b>${formatScore(res.beforeFull)}</b></div>
        <div><span class="cifi-muted">Optimized Loot Score</span><b class="${gainClass}">${formatScore(res.afterFull)}</b></div>
        <div><span class="cifi-muted">Change</span><b class="${gainClass}">${gain >= 0 ? '+' : ''}${gain.toFixed(2)}%</b></div>
      </div>
      ${changed ? '' : '<div class="cifi-muted" style="margin:6px 0">Your current allocation is already the best we could find (within engine noise).</div>'}
      <div class="cifi-cols">
        <div><b>Talents</b> <span class="cifi-muted">(1 pt each)</span>
          <table class="cifi"><tr><th>Talent</th><th class="n">Now</th><th class="n">Best</th><th class="n">Cap</th></tr>${res.talents.map(rowHtml).join('')}</table></div>
        <div><b>Attributes</b> <span class="cifi-muted">(weighted cost)</span>
          <table class="cifi"><tr><th>Attribute</th><th class="n">Now</th><th class="n">Best</th><th class="n">Cap</th></tr>${res.attrs.map(rowHtml).join('')}</table></div>
      </div>
      <div class="cifi-row" style="margin-top:16px">
        <button class="cifi-btn" id="cifi-save" ${changed ? '' : 'disabled'}>Save as new build</button>
        <button class="cifi-btn secondary" id="cifi-copy">Copy build code</button>
      </div>
      <div class="cifi-muted" style="margin-top:6px">The build code pastes straight into the tool's <b>Import</b>, here or on the live site.</div>`;

    const copyBtn = $('#cifi-copy');
    copyBtn.onclick = async () => {
      const code = generateBuildCode(res.optimizedBuild(), res.hunterId);
      if (!code) { copyBtn.textContent = 'Code failed'; return; }
      try {
        await navigator.clipboard.writeText(code);
        copyBtn.textContent = 'Copied code ✓';
      } catch (e) {
        // Clipboard access can be blocked, so show the code to copy by hand instead.
        window.prompt('Build code (copy):', code);
      }
      setTimeout(() => { copyBtn.textContent = 'Copy build code'; }, 1800);
    };

    const saveBtn = $('#cifi-save');
    saveBtn.onclick = () => {
      try {
        const { hunter } = stores();
        const nb = res.optimizedBuild();
        nb.name = `${res.build.name || 'Build'} (optimized)`;
        delete nb.id;
        delete nb.timestamp;
        nb.isImported = false;
        if (typeof hunter.addBuild === 'function') hunter.addBuild(res.hunterId, nb);
        else if (hunter.hunterBuilds?.[res.hunterId]) hunter.hunterBuilds[res.hunterId].push(nb);
        else throw new Error("couldn't find this hunter's build list");
        saveBtn.textContent = 'Saved ✓ (see build list)';
        saveBtn.disabled = true;
      } catch (e) {
        alert('Save failed: ' + (e?.message || e));
      }
    };
  }

  // ---- Startup ----

  window.__cifiGenerateBuildCode = generateBuildCode; // handy for checking codes from the console

  function addButton() {
    if (document.getElementById('cifi-opt-fab')) return;
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    const fab = document.createElement('button');
    fab.id = 'cifi-opt-fab';
    fab.textContent = '🎯 Optimize';
    fab.title = 'Auto-optimize a build for max Loot Score';
    fab.onclick = openModal;
    document.body.appendChild(fab);
    console.log(`%c${TAG} 🎯 button added (bottom-right)`, 'color:#22c55e;font-weight:bold');
  }

  // This can run before Vue has mounted the app, so check every 400ms until the
  // hunter store shows up, and give up after a minute.
  let attempts = 0;
  const poll = setInterval(() => {
    let ready = false;
    try { ready = !!piniaStores()?.get('hunter'); } catch (e) { /* not mounted yet */ }
    if (ready) {
      clearInterval(poll);
      addButton();
    } else if (++attempts >= 150) {
      clearInterval(poll);
      console.warn(`${TAG} gave up: couldn't find the app's hunter store after 60s`);
    }
  }, 400);
})();
