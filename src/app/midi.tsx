"use client";

import React, { useEffect, useRef, useState } from "react";
import * as AudioFX from "./audiofx";
import logger from "./logger";
import * as ExportImport from "./exportImport";

// Utility to format numeric values for display
export function formatNumericValue(n: unknown): string {
  if (typeof n !== 'number' || Number.isNaN(n)) return String(n);
  if (Number.isInteger(n)) return String(n);
  return parseFloat(n.toFixed(4)).toString();
}

// Available effect types
export const EFFECT_TYPES = ['Delay', 'Phaser', 'Overdrive', 'Compressor', 'Filter', 'Tremolo', 'Bitcrusher', 'Chorus'] as const;

// Filter type options for Filter effect
export const FILTER_TYPES = ['lowpass', 'highpass', 'bandpass', 'lowshelf', 'highshelf', 'peaking', 'notch', 'allpass'] as const;

// Centralized param ranges for all effects
export function useParamRanges(): Record<string, { min: number; max: number; step?: number }> {
  return {
    // Delay params
    feedback: { min: 0, max: 1, step: 0.0079 },
    delayTime: { min: 1, max: 3000, step: 23.6 },
    wetLevel: { min: 0, max: 2, step: 0.0157 },
    dryLevel: { min: 0, max: 2, step: 0.0157 },
    cutoff: { min: 20, max: 10000, step: 78.6 },
    // Phaser params
    rate: { min: 0.01, max: 8, step: 0.063 },
    depth: { min: 0, max: 1, step: 0.0079 },
    stereoPhase: { min: 0, max: 180, step: 1.42 },
    baseModulationFrequency: { min: 200, max: 1500, step: 10.2 },
    // Overdrive params
    outputGain: { min: -42, max: 0, step: 0.33 },
    drive: { min: 0, max: 1, step: 0.0079 },
    curveAmount: { min: 0, max: 1, step: 0.0079 },
    algorithmIndex: { min: 0, max: 5, step: 0.039 },
    // Compressor params
    threshold: { min: -100, max: 0, step: 0.79 },
    makeupGain: { min: 0, max: 20, step: 0.157 },
    attack: { min: 0, max: 1000, step: 7.87 },
    release: { min: 0, max: 3000, step: 23.6 },
    ratio: { min: 1, max: 20, step: 0.15 },
    knee: { min: 0, max: 40, step: 0.315 },
    automakeup: { min: 0, max: 1, step: 0.0079 },
    // Filter params
    frequency: { min: 20, max: 10000, step: 80 },
    Q: { min: 0.001, max: 100, step: 0.787 },
    gain: { min: -40, max: 40, step: 0.63 },
    // Tremolo params
    intensity: { min: 0, max: 1, step: 0.0079 },
    // Bitcrusher params
    bits: { min: 1, max: 16, step: 1 },
    normfreq: { min: 0, max: 1, step: 0.0079 },
    bufferSize: { min: 256, max: 16384, step: 127 },
    // Chorus params
    delay: { min: 0, max: 1, step: 0.0079 },
    // Legacy/other
    resonance: { min: 0, max: 4, step: 0.0315 },
  };
}

type MidiControllerProps = {
  paramLabels?: string[]; // optional labels for the 32 params
  onMidiCC?: (index: number, cc: number, channel: number, value: number) => void; // raw 0-127 value
};

const STORAGE_KEY = "nocturne_midi_mappings_v1";

export default function MidiController({ paramLabels = [], onMidiCC }: MidiControllerProps) {
  const DEFAULT_COUNT = 33;
  const initialLabels = Array.from({ length: DEFAULT_COUNT }, (_, i) => paramLabels[i] ?? `Param ${i + 1}`);

  // mapping slots: each slot can have assignedCC (number|null) and targets array [{ effectId, paramKey }]
  type Slot = { assignedCC: number | null; targets: Array<{ effectId: string; paramKey: string }>; };

  const [mappings, setMappings] = useState<Array<Slot>>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed.mappings)) {
          const loaded = parsed.mappings.slice(0, DEFAULT_COUNT).map((v: any) => ({ assignedCC: typeof v.assignedCC === 'number' ? v.assignedCC : null, targets: Array.isArray(v.targets) ? v.targets : [] }));
          // Pad to DEFAULT_COUNT if needed
          while (loaded.length < DEFAULT_COUNT) {
            loaded.push({ assignedCC: null, targets: [] });
          }
          return loaded;
        }
      }
    } catch (e) {}
    return Array.from({ length: DEFAULT_COUNT }, () => ({ assignedCC: null as number | null, targets: [] as Array<{ effectId: string; paramKey: string }> }));
  });

  const [channel, setChannel] = useState<number>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (typeof parsed.channel === 'number') return parsed.channel;
      }
    } catch (e) {}
    return 1; // 1-16
  });

  const [midiAccess, setMidiAccess] = useState<any | null>(null);
  const inputsRef = useRef<any[]>([]);
  const [availableInputs, setAvailableInputs] = useState<Array<{ id: string; name: string }>>([]);
  const [selectedInputId, setSelectedInputId] = useState<string | null>(null); // null = all
  const listeningRef = useRef<number | null>(null); // index we're learning
  const [flashSlots, setFlashSlots] = useState<Record<number, boolean>>({});

  // Param ranges - used to map 0..127 to param ranges
  const paramRanges = useParamRanges();

  useEffect(() => {
    // persist settings
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ mappings, channel }));
    } catch (e) {}
  }, [mappings, channel]);

  useEffect(() => {
    let mounted = true;
    async function init() {
      if (!navigator || !(navigator as any).requestMIDIAccess) return;
      try {
        const acc = await (navigator as any).requestMIDIAccess({ sysex: false });
        if (!mounted) return;
        setMidiAccess(acc as any);
        // attach listeners
        const inputs = Array.from(acc.inputs.values()) as any[];
        inputsRef.current = inputs;
        setAvailableInputs(inputs.map((i) => ({ id: i.id, name: i.name || i.manufacturer || i.id })));
        for (const inp of inputs) {
          inp.onmidimessage = handleMidiMessage;
        }
        acc.onstatechange = (e: any) => {
          // refresh inputs
          inputsRef.current = Array.from(acc.inputs.values()) as any[];
          setAvailableInputs(inputsRef.current.map((i) => ({ id: i.id, name: i.name || i.manufacturer || i.id })));
          for (const inp of inputsRef.current) inp.onmidimessage = handleMidiMessage;
        };
      } catch (e) {
        console.warn('MIDI init failed', e);
      }
    }
    init();
    return () => { mounted = false; if (midiAccess) { for (const inp of inputsRef.current) inp.onmidimessage = null; } };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // On first run, if no mappings assigned, populate sensible defaults from AudioFX effects
  useEffect(() => {
    // if any assigned, skip
    if (mappings.some((s) => s.assignedCC !== null || (s.targets && s.targets.length > 0))) return;
    const effects = AudioFX.getEffects();
    if (!effects || effects.length === 0) return;
    // build list of candidate targets: [{effectId,paramKey}]
    const candidates: Array<{ effectId: string; paramKey: string }> = [];
    for (const eff of effects) {
      const keys = Object.keys(eff.params || {}).filter(k => typeof (eff.params || {})[k] === 'number');
      for (const k of keys) {
        candidates.push({ effectId: eff.id, paramKey: k });
      }
    }
    if (candidates.length === 0) return;
    const next = mappings.slice();
    for (let i = 0; i < next.length && i < candidates.length; i++) {
      // assign a default CC number from 1-33
      next[i] = { assignedCC: i + 1, targets: [candidates[i]] };
    }
    setMappings(next);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleMidiMessage(ev: any) {
    const [status, data1, data2] = ev.data;
    const msgType = status & 0xf0;
    const ch = (status & 0x0f) + 1; // 1-16
      if (msgType === 0xB0) {
      const cc = data1;
      const val = data2; // 0-127
      // If we're learning, set mapping
      if (listeningRef.current !== null) {
        const idx = listeningRef.current as number;
        const next = mappings.slice();
        next[idx] = { ...next[idx], assignedCC: cc };
        setMappings(next);
        listeningRef.current = null;
        return;
      }
      // respect global channel (1-16) or 0 for any
      if (channel !== 0 && ch !== channel) return;
      // find mappings assigned to this CC
      mappings.forEach((slot, idx) => {
        if (slot.assignedCC === cc) {
          // visual flash
          setFlashSlots((s) => ({ ...s, [idx]: true }));
          setTimeout(() => setFlashSlots((s) => ({ ...s, [idx]: false })), 220);
          // apply to all targets
          for (const t of slot.targets) {
            try {
              const eff = AudioFX.getEffects().find((e: any) => e.id === t.effectId);
              if (!eff) continue;
              const paramName = t.paramKey;
              const range = paramRanges[paramName] || { min: 0, max: 1 };
              let mapped = range.min + (val / 127) * (range.max - range.min);
              // Cast integer params to int
              if (paramName === 'bits' || paramName === 'algorithmIndex' || paramName === 'automakeup') {
                mapped = Math.round(mapped);
              }
              // call AudioFX.updateEffectParams
              try {
                AudioFX.updateEffectParams(t.effectId, { [paramName]: mapped });
                try {
                  window.dispatchEvent(new CustomEvent('audiofx:paramsUpdated', { detail: { effectId: t.effectId, paramName, value: mapped } }));
                } catch (e) {}
              } catch (e) {}
            } catch (e) {
              // ignore per-target errors
            }
          }
          if (onMidiCC) onMidiCC(idx, cc, ch, val);
        }
      });
    }
  }

  function startLearn(idx: number) {
    listeningRef.current = idx;
  }

  function clearMapping(idx: number) {
    const next = mappings.slice();
    next[idx] = { assignedCC: null, targets: [] };
    setMappings(next);
  }

  function addTarget(idx: number) {
    const effects = AudioFX.getEffects();
    if (!effects || effects.length === 0) return;
    const eff = effects[0];
    const paramKey = Object.keys(eff.params || {}).find((k) => typeof (eff.params || {})[k] === 'number') || Object.keys(eff.params || {})[0] || '';
    const next = mappings.slice();
    next[idx] = { ...next[idx], targets: [...next[idx].targets, { effectId: eff.id, paramKey }] };
    setMappings(next);
  }

  function updateTarget(idx: number, tIndex: number, partial: Partial<{ effectId: string; paramKey: string }>) {
    const next = mappings.slice();
    const target = { ...next[idx].targets[tIndex], ...partial };
    next[idx] = { ...next[idx], targets: next[idx].targets.map((t, i) => i === tIndex ? target : t) };
    setMappings(next);
  }

  function removeTarget(idx: number, tIndex: number) {
    const next = mappings.slice();
    next[idx] = { ...next[idx], targets: next[idx].targets.filter((_, i) => i !== tIndex) };
    setMappings(next);
  }

  // handle selected input change: attach listener only to selected input or all
  useEffect(() => {
    // detach all
    for (const inp of inputsRef.current) inp.onmidimessage = null;
    if (!midiAccess) return;
    if (!selectedInputId) {
      // all
      const inputs = Array.from(midiAccess.inputs.values()) as any[];
      inputsRef.current = inputs;
      for (const inp of inputs) inp.onmidimessage = handleMidiMessage;
    } else {
      const inp = Array.from(midiAccess.inputs.values()).find((i: any) => i.id === selectedInputId) as any | undefined;
      if (inp) inp.onmidimessage = handleMidiMessage;
      inputsRef.current = inp ? [inp] : [];
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedInputId, midiAccess]);

  // Cleanup stored mappings: remove targets that reference missing effects or non-numeric params
  useEffect(() => {
    const effects = AudioFX.getEffects();
    if (!effects || effects.length === 0) return;
    let changed = false;
    const next = mappings.map((slot) => {
      const targets = (slot.targets || []).filter((t) => {
        const eff = effects.find((e: any) => e.id === t.effectId);
        if (!eff) return false;
        return typeof (eff.params || {})[t.paramKey] === 'number';
      });
      if (targets.length !== (slot.targets || []).length) changed = true;
      return { ...slot, targets };
    });
    if (changed) setMappings(next);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [midiAccess]);

  return (
    <div className="bg-white p-3 rounded shadow text-sm">
      <div className="flex items-center justify-between mb-2">
        <strong>MIDI CC Mapper</strong>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <label className="text-xs">Channel</label>
            <select value={channel} onChange={(e) => setChannel(Number(e.target.value))} className="p-1 border text-xs">
              <option value={0}>Any</option>
              {Array.from({ length: 16 }, (_, i) => i + 1).map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs">Input</label>
            <select value={selectedInputId ?? ''} onChange={(e) => setSelectedInputId(e.target.value || null)} className="p-1 border text-xs">
              <option value="">All</option>
              {availableInputs.map((a) => (<option key={a.id} value={a.id}>{a.name}</option>))}
            </select>
          </div>
        </div>
      </div>

      <div className="max-h-[68vh] overflow-auto">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {Array.from({ length: DEFAULT_COUNT }, (_, i) => {
            const slot = mappings[i];
            return (
              <div key={i} className={`border rounded p-3 bg-white shadow-sm ${flashSlots[i] ? 'ring-2 ring-yellow-300' : ''}`}>
                <div className="flex items-start gap-3">
                  <div className="w-8 text-sm font-medium">{i + 1}</div>
                  <div className="flex-1">
                    <div className="text-sm font-semibold">{initialLabels[i]}</div>
                    <div className="mt-2 flex items-center gap-2">
                      <label className="text-xs text-gray-600">CC</label>
                      <input type="number" min={0} max={127} value={slot.assignedCC ?? ""} onChange={(e) => {
                        const v = e.target.value === "" ? null : Math.max(0, Math.min(127, Number(e.target.value)));
                        const next = mappings.slice(); next[i] = { ...next[i], assignedCC: v }; setMappings(next);
                      }} className="w-20 p-1 border text-xs" />
                      <button onClick={() => startLearn(i)} className="px-2 py-1 border rounded text-xs">{listeningRef.current === i ? 'Listening…' : 'Learn'}</button>
                      <button onClick={() => clearMapping(i)} className="px-2 py-1 border rounded text-xs text-red-600">Clear</button>
                    </div>
                    <div className="mt-3">
                      <div className="flex items-center gap-2">
                        <div className="text-xs font-medium">Targets</div>
                        <button onClick={() => addTarget(i)} className="px-2 py-0.5 border rounded text-xs">Add</button>
                      </div>
                      <div className="mt-2 space-y-2">
                        {(slot.targets || []).map((t, ti) => (
                          <div key={ti} className="flex items-center gap-2">
                            <select value={t.effectId} onChange={(e) => updateTarget(i, ti, { effectId: e.target.value, paramKey: '' })} className="p-1 text-xs border">
                              {AudioFX.getEffects().map((eff: any) => <option key={eff.id} value={eff.id}>{eff.type}</option>)}
                            </select>
                            <select value={t.paramKey} onChange={(e) => updateTarget(i, ti, { paramKey: e.target.value })} className="p-1 text-xs border">
                              {(() => {
                                const eff = AudioFX.getEffects().find((e: any) => e.id === t.effectId);
                                if (!eff) return [<option key="-" value="">-</option>];
                                const keys = Object.keys(eff.params || {}).filter(k => typeof (eff.params || {})[k] === 'number');
                                return keys.map((k) => <option key={k} value={k}>{k}</option>);
                              })()}
                            </select>
                            <button onClick={() => removeTarget(i, ti)} className="px-2 py-0.5 border rounded text-xs text-red-600">Remove</button>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <div className="mt-2 text-xs text-gray-600">Tip: click Learn, then move a controller to assign its CC to that parameter. Channel can be set to Any or 1–16.</div>
      <div className="mt-3 flex gap-2 flex-wrap">
        <button
          onClick={async () => {
            try {
              const json = JSON.stringify({
                version: '1.0',
                timestamp: new Date().toISOString(),
                mappings,
                channel,
              }, null, 2);
              await ExportImport.copyConfigToClipboard(
                ExportImport.exportConfig([], mappings, channel)
              );
              alert('MIDI mappings copied to clipboard!');
            } catch (e) {
              alert('Failed to copy: ' + (e instanceof Error ? e.message : String(e)));
            }
          }}
          className="px-2 py-1 border rounded text-xs bg-blue-50 hover:bg-blue-100"
        >
          📋 Copy
        </button>
        <button
          onClick={async () => {
            try {
              const json = await ExportImport.loadConfigFromClipboard();
              const config = ExportImport.importConfig(json);
              setMappings(config.midiMappings);
              setChannel(config.midiChannel);
              alert('MIDI mappings loaded from clipboard!');
            } catch (e) {
              alert('Failed to paste: ' + (e instanceof Error ? e.message : String(e)));
            }
          }}
          className="px-2 py-1 border rounded text-xs bg-green-50 hover:bg-green-100"
        >
          📌 Paste
        </button>
        <button
          onClick={async () => {
            try {
              const config = ExportImport.exportConfig([], mappings, channel);
              ExportImport.downloadConfigAsFile(config, `nocturne-midi-${new Date().toISOString().split('T')[0]}.json`);
            } catch (e) {
              alert('Failed to export: ' + (e instanceof Error ? e.message : String(e)));
            }
          }}
          className="px-2 py-1 border rounded text-xs bg-purple-50 hover:bg-purple-100"
        >
          💾 Export
        </button>
        <button
          onClick={async () => {
            try {
              const json = await ExportImport.loadConfigFromFile();
              const config = ExportImport.importConfig(json);
              setMappings(config.midiMappings);
              setChannel(config.midiChannel);
              alert('MIDI mappings loaded from file!');
            } catch (e) {
              alert('Failed to import: ' + (e instanceof Error ? e.message : String(e)));
            }
          }}
          className="px-2 py-1 border rounded text-xs bg-orange-50 hover:bg-orange-100"
        >
          📂 Import
        </button>
      </div>
    </div>
  );
}
