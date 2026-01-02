// Tuna.js effects manager
// Exports: initTuna, createEffect, updateEffectParams, removeEffect, getEffects, setChain, connectChain

type EffectRecord = {
  id: string;
  type: string;
  params: any;
  node: any | null;
  bypass?: boolean;
};

let tunaInstance: any = null;
let acRef: AudioContext | null = null;
const effects: Record<string, EffectRecord> = {};
let chain: string[] = [];
// track active connection so we can reconnect when params (like bypass) change
let activeSource: AudioNode | null = null;
let activeDestination: AudioNode | null = null;

function tunaAvailable(): boolean {
  return !!tunaInstance;
}

export function initTuna(ac: AudioContext) {
  if (tunaInstance) return tunaInstance;
  acRef = ac;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Tuna = require('tunajs');
    tunaInstance = new Tuna(ac);
  } catch (e) {
    // fallback to global
    // @ts-ignore
    if ((window as any).Tuna) {
      // @ts-ignore
      tunaInstance = new (window as any).Tuna(ac);
    } else {
      tunaInstance = null;
      console.warn('Tuna.js not found. Effects disabled.');
    }
  }
  return tunaInstance;
}

const defaultParamsByType: Record<string, any> = {
  Delay: { feedback: 0.45, delayTime: 100, wetLevel: 0.5, dryLevel: 1, cutoff: 20000, bypass: false },
  Phaser: { rate: 0.1, depth: 0.6, feedback: 0.7, stereoPhase: 20, baseModulationFrequency: 700, bypass: false },
  Overdrive: { outputGain: -9.154, drive: 0.197, curveAmount: 0.979, algorithmIndex: 0, bypass: false },
  Compressor: { threshold: -20, makeupGain: 1, attack: 1, release: 250, ratio: 4, knee: 5, automakeup: false, bypass: false },
  Filter: { frequency: 800, Q: 1, gain: 0, filterType: 'lowpass', bypass: false },
  Tremolo: { intensity: 0.3, rate: 5, stereoPhase: 0, bypass: false },
  Bitcrusher: { bits: 4, normfreq: 0.1, bufferSize: 4096, bypass: false },
  Chorus: { rate: 1.5, feedback: 0.4, depth: 0.7, delay: 0.0045, bypass: false },
};

export function createEffect(id: string, type: string, params?: any) {
  const ac = acRef;
  const tuna = tunaInstance;
  // merge provided params with defaults so callers can pass partial overrides
  const p = { ...(defaultParamsByType[type] || {}), ...(params || {}) };
  // ensure bufferSize (if present) is within Tuna-expected range (256..16384)
  if (typeof p.bufferSize === 'number') {
    const min = 256;
    const max = 16384;
    let v = Math.max(min, Math.min(max, Math.floor(p.bufferSize)));
    // round to nearest power of two (common requirement for buffer sizes)
    const pow = Math.pow(2, Math.round(Math.log2(v)));
    if (pow < min) v = min; else if (pow > max) v = max; else v = pow;
    p.bufferSize = v;
  }
  effects[id] = { id, type, params: p, node: null, bypass: !!p.bypass };
  if (tuna && ac) {
    try {
      // @ts-ignore
      const node = new (tuna as any)[type](p);
      effects[id].node = node;
    } catch (e) {
      console.warn('Failed to create Tuna node for', type, e);
      effects[id].node = null;
    }
  }
  return effects[id];
}

export function updateEffectParams(id: string, newParams: any) {
  const rec = effects[id];
  if (!rec) return;
  rec.params = { ...rec.params, ...newParams };
  // ensure bufferSize updated via UI is normalized to a valid power-of-two in range
  if (typeof rec.params.bufferSize === 'number') {
    const min = 256;
    const max = 16384;
    let v = Math.max(min, Math.min(max, Math.floor(rec.params.bufferSize)));
    const pow = Math.pow(2, Math.round(Math.log2(v)));
    if (pow < min) v = min; else if (pow > max) v = max; else v = pow;
    rec.params.bufferSize = v;
  }
  rec.bypass = !!rec.params.bypass;
  if (rec.node) {
    try {
      if (rec.node.set) rec.node.set(rec.params);
      else Object.assign(rec.node, rec.params);
    } catch (e) {
      try { Object.assign(rec.node, rec.params); } catch (_) {}
    }
  }
  // If there's an active connection, rewire it so bypass changes take effect immediately
  try {
    if (activeSource && activeDestination) {
      // disconnect existing and reconnect according to new bypass settings
      reconnectActiveChain();
    }
  } catch (e) {
    // ignore reconnect errors
  }
}

export function removeEffect(id: string) {
  delete effects[id];
  chain = chain.filter((c) => c !== id);
}

export function getEffects() {
  return Object.values(effects).map((e) => ({ id: e.id, type: e.type, params: e.params, bypass: e.bypass }));
}

export function setChain(order: string[]) {
  chain = order.slice();
}

// Connect a source AudioNode through the configured chain into destination
export function asyncConnectChain(source: AudioNode, destination: AudioNode) {
  // store active connection for later reconnection
  activeSource = source;
  activeDestination = destination;
  // defensively disconnect existing connections from source and effect nodes
  try {
    try { source.disconnect(); } catch (_) {}
    for (const id of chain) {
      const rec = effects[id];
      if (!rec) continue;
      if (rec.node) {
        try { rec.node.disconnect(); } catch (_) {}
      }
    }
  } catch (_) {}
  // If no tuna or no chain, just connect directly
  if (!acRef) {
    source.connect(destination);
    return;
  }
  // Build list of nodes for current chain where node exists and not bypassed
  const nodes: AudioNode[] = [];
  for (const id of chain) {
    const rec = effects[id];
    if (!rec) continue;
    if (rec.bypass) continue;
    if (rec.node && typeof rec.node.connect === 'function') {
      nodes.push(rec.node as AudioNode);
    }
  }

  try {
    console.debug('[AudioFX] asyncConnectChain building chain, chain=', chain.map((c) => ({ id: c, bypass: effects[c]?.bypass }))); 
    if (nodes.length === 0) {
      source.connect(destination);
      return;
    }
    // connect source -> first -> ... -> last -> destination
    source.connect(nodes[0]);
    for (let i = 0; i < nodes.length - 1; i++) {
      nodes[i].connect(nodes[i + 1]);
    }
    nodes[nodes.length - 1].connect(destination);
  } catch (e) {
    try { source.connect(destination); } catch (_) {}
  }
}

// Disconnect currently active chain and clear stored active nodes
export function disconnectActiveChain() {
  try {
    if (activeSource) {
      try { activeSource.disconnect(); } catch (_) {}
    }
    for (const id of chain) {
      const rec = effects[id];
      if (!rec) continue;
      if (rec.node) {
        try { rec.node.disconnect(); } catch (_) {}
      }
    }
  } finally {
    activeSource = null;
    activeDestination = null;
  }
}

function reconnectActiveChain() {
  if (!activeSource || !activeDestination) return;
  try {
    // attempt to disconnect source entirely
    try { activeSource.disconnect(); } catch (_) {}
    // attempt to disconnect all effect nodes
    for (const id of chain) {
      const rec = effects[id];
      if (!rec) continue;
      if (rec.node) {
        try { rec.node.disconnect(); } catch (_) {}
      }
    }
  } catch (_) {}
  // reconnect according to current chain/bypass
  asyncConnectChain(activeSource, activeDestination);
}

export function getChain() { return chain.slice(); }

