"use client";

import React, { useEffect, useRef, useState } from "react";
import * as AudioFX from "./audiofx";
import logger from "./logger";
import * as ExportImport from "./exportImport";

const midiCCScaler = 1.5

// Utility to format numeric values for display
export function formatNumericValue(n: unknown): string {
  if (typeof n !== 'number' || Number.isNaN(n)) return String(n);
  if (Number.isInteger(n)) return String(n);
  return parseFloat(n.toFixed(4)).toString();
}

// Available effect types
export const EFFECT_TYPES = ['Delay', 'Phaser', 'Convolver', 'Compressor', 'Filter', 'Tremolo', 'Bitcrusher', 'Chorus', 'Overdrive', 'RingModulator'] as const;

// Filter type options for Filter effect
export const FILTER_TYPES = ['lowpass', 'highpass', 'bandpass', 'lowshelf', 'highshelf', 'peaking', 'notch', 'allpass'] as const;


// Centralized param ranges for all effects
export function useParamRanges(): Record<string, { min: number; max: number; step?: number }> {
  return {
    // Delay params
    feedback: { min: 0, max: 1, step: 0.0079 * midiCCScaler },
    delayTime: { min: 1, max: 2000, step: 18 * midiCCScaler },
    wetLevel: { min: 0, max: 2, step: 0.0157 * midiCCScaler },
    dryLevel: { min: 0, max: 2, step: 0.0157 * midiCCScaler },
    cutoff: { min: 20, max: 5000, step: 40 * midiCCScaler },
    // Phaser params
    rate: { min: 0.01, max: 8, step: 0.063 * midiCCScaler},
    depth: { min: 0, max: 1, step: 0.0079 * midiCCScaler },
    stereoPhase: { min: 0, max: 180, step: 1.42 * midiCCScaler },
    baseModFreq: { min: 200, max: 1500, step: 10.2 * midiCCScaler },
    // Convolver params
    highCut: { min: 20, max: 5000, step: 40 * midiCCScaler },
    lowCut: { min: 20, max: 5000, step: 40 * midiCCScaler },
    level: { min: 0, max: 1, step: 0.0079 * midiCCScaler },
    // Compressor params
    threshold: { min: -100, max: 0, step: 0.79 * midiCCScaler },
    makeupGain: { min: 0, max: 20, step: 0.157 * midiCCScaler },
    attack: { min: 0, max: 1000, step: 7.87 * midiCCScaler },
    release: { min: 0, max: 3000, step: 23.6 * midiCCScaler },
    ratio: { min: 1, max: 20, step: 0.15 * midiCCScaler },
    knee: { min: 0, max: 40, step: 0.315 * midiCCScaler },
    automakeup: { min: 0, max: 1, step: 0.0079 * midiCCScaler },
    // Filter params
    frequency: { min: 20, max: 2500, step: 20 * midiCCScaler },
    Q: { min: 0.001, max: 100, step: 0.787 * midiCCScaler },
    gain: { min: -40, max: 40, step: 0.63 * midiCCScaler },
    // Tremolo params
    intensity: { min: 0, max: 1, step: 0.0079 * midiCCScaler },
    // Bitcrusher params
    bits: { min: 1, max: 16, step: 1 },
    normfreq: { min: 0, max: 1, step: 0.0079 * midiCCScaler },
    bufferSize: { min: 256, max: 16384, step: 127 },
    // Chorus params
    delay: { min: 0, max: 1, step: 0.0079 * midiCCScaler },
    // Overdrive params
    outputGain: { min: -42, max: 0, step: 0.33 * midiCCScaler },
    drive: { min: 0, max: 1, step: 0.0079 * midiCCScaler },
    curveAmount: { min: 0, max: 1, step: 0.0079 * midiCCScaler },
    algorithmIndex: { min: 0, max: 5, step: 1 },
    // RingModulator params
    // frequency parameter uses shared 'frequency' key
    // depth parameter uses shared 'depth' key
    // Legacy/other
    resonance: { min: 0, max: 4, step: 0.0315 * midiCCScaler },
    // Bypass parameter (binary: 0=off/false, 1=on/true)
    bypass: { min: 0, max: 1, step: 1 },
  };
}

// Button action types that can be triggered by MIDI notes
export type ButtonAction = 'stopAudio' | 'muteMic' | 'unmuteMic' | 'toggleMic' | 'resetAllFX';

type MidiControllerProps = {
  paramLabels?: string[]; // optional labels for the 32 params
  onMidiCC?: (index: number, cc: number, channel: number, value: number) => void; // raw 0-127 value
  onButtonAction?: (action: ButtonAction) => void; // callback for button actions
  onPanPreset?: (presetId: string) => void; // callback for pan preset selection
  availablePanPresets?: Array<{ id: string; name: string }>; // available pan presets
};

const STORAGE_KEY = "nocturne_midi_mappings_v1";

export default function MidiController({ paramLabels = [], onMidiCC, onButtonAction, onPanPreset, availablePanPresets = [] }: MidiControllerProps) {
  const DEFAULT_COUNT = 49; // 36 params + 10 pan presets + 3 actions
  const initialLabels = Array.from({ length: DEFAULT_COUNT }, (_, i) => {
    if (i >= 36 && i <= 45) return `Pan Preset ${i - 35}`; // Slots 37-46
    if (i === 46) return 'Stop Audio';
    if (i === 47) return 'Toggle Mic Mute';
    if (i === 48) return 'Reset All FX';
    return paramLabels[i] ?? `Param ${i + 1}`;
  });

  // mapping slots: each slot can have assignedCC/assignedNote (number|null) and targets array [{ effectId, paramKey }] or action targets or pan preset
  type Slot = { 
    assignedCC: number | null; 
    assignedNote: number | null; // MIDI note number (0-127)
    targets: Array<{ effectId: string; paramKey: string }>;
    actionTarget: ButtonAction | null; // For button actions
    panPresetId: string | null; // For pan preset selection
  };

  const [mappings, setMappings] = useState<Array<Slot>>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed.mappings)) {
          const loaded = parsed.mappings.slice(0, DEFAULT_COUNT).map((v: any, i: number) => {
            // Slots 37-46 (indices 36-45) are pan presets
            if (i >= 36 && i <= 45) {
              const presetIndex = i - 36;
              return {
                assignedCC: null,
                assignedNote: typeof v.assignedNote === 'number' ? v.assignedNote : 60 + presetIndex,
                targets: [],
                actionTarget: null,
                panPresetId: typeof v.panPresetId === 'string' ? v.panPresetId : (availablePanPresets[presetIndex]?.id || `preset${presetIndex + 1}`)
              };
            }
            // Slot 47 (index 46) is Stop Audio
            if (i === 46) {
              return {
                assignedCC: null,
                assignedNote: typeof v.assignedNote === 'number' ? v.assignedNote : 70,
                targets: [],
                actionTarget: 'stopAudio' as ButtonAction,
                panPresetId: null
              };
            }
            // Slot 48 (index 47) is Toggle Mic
            if (i === 47) {
              return {
                assignedCC: null,
                assignedNote: typeof v.assignedNote === 'number' ? v.assignedNote : 71,
                targets: [],
                actionTarget: 'toggleMic' as ButtonAction,
                panPresetId: null
              };
            }
            // Slot 49 (index 48) is Reset All FX
            if (i === 48) {
              return {
                assignedCC: null,
                assignedNote: typeof v.assignedNote === 'number' ? v.assignedNote : 72,
                targets: [],
                actionTarget: 'resetAllFX' as ButtonAction,
                panPresetId: null
              };
            }
            // For other slots (1-36), load normally
            return {
              assignedCC: typeof v.assignedCC === 'number' ? v.assignedCC : null, 
              assignedNote: typeof v.assignedNote === 'number' ? v.assignedNote : null,
              targets: Array.isArray(v.targets) ? v.targets : [],
              actionTarget: null,
              panPresetId: null
            };
          });
          // Pad to DEFAULT_COUNT if needed
          while (loaded.length < DEFAULT_COUNT) {
            const i = loaded.length;
            // Slots 37-46 (indices 36-45) are pan presets
            if (i >= 36 && i <= 45) {
              const presetIndex = i - 36;
              loaded.push({ 
                assignedCC: null, 
                assignedNote: 60 + presetIndex, 
                targets: [], 
                actionTarget: null, 
                panPresetId: availablePanPresets[presetIndex]?.id || `preset${presetIndex + 1}` 
              });
            } else if (i === 46) {
              loaded.push({ assignedCC: null, assignedNote: 70, targets: [], actionTarget: 'stopAudio' as ButtonAction, panPresetId: null });
            } else if (i === 47) {
              loaded.push({ assignedCC: null, assignedNote: 71, targets: [], actionTarget: 'toggleMic' as ButtonAction, panPresetId: null });
            } else if (i === 48) {
              loaded.push({ assignedCC: null, assignedNote: 72, targets: [], actionTarget: 'resetAllFX' as ButtonAction, panPresetId: null });
            } else {
              loaded.push({ assignedCC: null, assignedNote: null, targets: [], actionTarget: null, panPresetId: null });
            }
          }
          return loaded;
        }
      }
    } catch (e) {}
    const defaults = Array.from({ length: DEFAULT_COUNT }, (_, i) => {
      // Slots 37-46 (indices 36-45) are pan presets
      if (i >= 36 && i <= 45) {
        const presetIndex = i - 36;
        return { 
          assignedCC: null, 
          assignedNote: 60 + presetIndex, 
          targets: [], 
          actionTarget: null, 
          panPresetId: availablePanPresets[presetIndex]?.id || `preset${presetIndex + 1}` 
        };
      }
      // Slot 47 (index 46) is Stop Audio
      if (i === 46) return { assignedCC: null, assignedNote: 70, targets: [], actionTarget: 'stopAudio' as ButtonAction, panPresetId: null };
      // Slot 48 (index 47) is Toggle Mic
      if (i === 47) return { assignedCC: null, assignedNote: 71, targets: [], actionTarget: 'toggleMic' as ButtonAction, panPresetId: null };
      // Slot 49 (index 48) is Reset All FX
      if (i === 48) return { assignedCC: null, assignedNote: 72, targets: [], actionTarget: 'resetAllFX' as ButtonAction, panPresetId: null };
      return { assignedCC: null, assignedNote: null, targets: [], actionTarget: null, panPresetId: null };
    });
    return defaults;
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
  
  // Use refs to avoid stale closures in MIDI message handler
  const mappingsRef = useRef(mappings);
  const onButtonActionRef = useRef(onButtonAction);
  const onPanPresetRef = useRef(onPanPreset);

  // Param ranges - used to map 0..127 to param ranges
  const paramRanges = useParamRanges();

  useEffect(() => {
    // persist settings
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ mappings, channel }));
    } catch (e) {}
    // Update ref for MIDI handler
    mappingsRef.current = mappings;
  }, [mappings, channel]);
  
  useEffect(() => {
    onButtonActionRef.current = onButtonAction;
    onPanPresetRef.current = onPanPreset;
  }, [onButtonAction, onPanPreset]);

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
    // if any assigned (excluding action slots 36-37), skip
    if (mappings.slice(0, 36).some((s) => s.assignedCC !== null || (s.targets && s.targets.length > 0))) return;
    const effects = AudioFX.getEffects();
    if (!effects || effects.length === 0) return;
    // build list of candidate targets: [{effectId,paramKey}]
    // First, add bypass for each effect, then add numeric params
    const candidates: Array<{ effectId: string; paramKey: string }> = [];
    for (const eff of effects) {
      // Add bypass first for each effect
      candidates.push({ effectId: eff.id, paramKey: 'bypass' });
      // Then add numeric params
      const keys = Object.keys(eff.params || {}).filter(k => typeof (eff.params || {})[k] === 'number');
      for (const k of keys) {
        candidates.push({ effectId: eff.id, paramKey: k });
      }
    }
    if (candidates.length === 0) return;
    const next = mappings.slice();
    for (let i = 0; i < 36 && i < candidates.length; i++) { // Only assign first 36 slots
      // assign a default CC number from 1-36
      next[i] = { assignedCC: i + 1, assignedNote: null, targets: [candidates[i]], actionTarget: null, panPresetId: null };
    }
    
    // Special mappings: Params 34-36 (CC 34-36) for Overdrive effect
    const overdriveEffect = effects.find((e: any) => e.type === 'Overdrive');
    if (overdriveEffect) {
      // Param 34 (index 33) -> CC 34 -> outputGain
      next[33] = { assignedCC: 34, assignedNote: null, targets: [{ effectId: overdriveEffect.id, paramKey: 'outputGain' }], actionTarget: null, panPresetId: null };
      // Param 35 (index 34) -> CC 35 -> drive
      next[34] = { assignedCC: 35, assignedNote: null, targets: [{ effectId: overdriveEffect.id, paramKey: 'drive' }], actionTarget: null, panPresetId: null };
      // Param 36 (index 35) -> CC 36 -> curveAmount
      next[35] = { assignedCC: 36, assignedNote: null, targets: [{ effectId: overdriveEffect.id, paramKey: 'curveAmount' }], actionTarget: null, panPresetId: null };
    }
    
    setMappings(next);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleMidiMessage(ev: any) {
    const [status, data1, data2] = ev.data;
    const msgType = status & 0xf0;
    const ch = (status & 0x0f) + 1; // 1-16
    
    // Handle MIDI CC messages (0xB0)
    if (msgType === 0xB0) {
      const cc = data1;
      const val = data2; // 0-127
      // If we're learning, set mapping
      if (listeningRef.current !== null) {
        const idx = listeningRef.current as number;
        const next = mappingsRef.current.slice();
        next[idx] = { ...next[idx], assignedCC: cc, assignedNote: null };
        setMappings(next);
        listeningRef.current = null;
        return;
      }
      // respect global channel (1-16) or 0 for any
      if (channel !== 0 && ch !== channel) return;
      // find mappings assigned to this CC
      mappingsRef.current.forEach((slot, idx) => {
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
              let mapped = range.min + (val / 127) * (range.max - range.min) * midiCCScaler;
              // Clamp to range
              mapped = Math.max(range.min, Math.min(range.max, mapped));
              // Cast integer params to int
              if (paramName === 'bits' || paramName === 'algorithmIndex' || paramName === 'automakeup') {
                mapped = Math.round(mapped);
              }
              // Cast bypass to boolean
              if (paramName === 'bypass') {
                mapped = mapped > 0.5 ? 1 : 0;
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
    
    // Handle MIDI Note-On messages (0x90)
    if (msgType === 0x90) {
      const note = data1;
      const velocity = data2; // 0-127
      logger.info('[MIDI] Note-On received:', note, 'velocity:', velocity, 'channel:', ch);
      // Note-on with velocity 0 is often used as note-off, so ignore
      if (velocity === 0) return;
      
      // If we're learning, set note mapping
      if (listeningRef.current !== null) {
        const idx = listeningRef.current as number;
        const next = mappingsRef.current.slice();
        const currentSlot = next[idx];
        logger.debug('[MIDI] Learning note', note, 'for slot', idx, 'current targets:', currentSlot.targets);
        // Preserve everything but update the note, clearing CC
        // Ensure targets exist (should have bypass at minimum for notes)
        const targets = currentSlot.targets && currentSlot.targets.length > 0 ? currentSlot.targets : [];
        next[idx] = { ...currentSlot, assignedCC: null, assignedNote: note, targets };
        logger.debug('[MIDI] After learn:', 'targets:', next[idx].targets, 'note:', next[idx].assignedNote);
        setMappings(next);
        listeningRef.current = null;
        logger.debug('[MIDI] Learned note', note, 'for slot', idx);
        return;
      }
      
      // respect global channel (1-16) or 0 for any
      if (channel !== 0 && ch !== channel) {
        logger.debug('[MIDI] Note ignored - channel mismatch. Expected:', channel, 'Got:', ch);
        return;
      }
      
      logger.debug('[MIDI] Checking', mappingsRef.current.length, 'mappings for note', note);
      // find mappings assigned to this note
      mappingsRef.current.forEach((slot, idx) => {
        // logger.debug('[MIDI] Slot', idx, 'assignedNote:', slot.assignedNote, 'targets:', slot.targets?.length || 0, 'actionTarget:', slot.actionTarget, 'panPresetId:', slot.panPresetId);
        if (slot.assignedNote === note) {
          logger.debug('[MIDI] Match found! Slot', idx, 'has note', note);
          // visual flash
          setFlashSlots((s) => ({ ...s, [idx]: true }));
          setTimeout(() => setFlashSlots((s) => ({ ...s, [idx]: false })), 220);
          
          // If this slot has effect parameter targets, apply them (using velocity as MIDI value 0-127)
          logger.debug('[MIDI] Slot targets:', slot.targets);
          if (slot.targets && slot.targets.length > 0) {
            logger.debug('[MIDI] Applying', slot.targets.length, 'targets with velocity', velocity);
            for (const t of slot.targets) {
              try {
                const eff = AudioFX.getEffects().find((e: any) => e.id === t.effectId);
                if (!eff) {
                  logger.warn('[MIDI] Effect not found:', t.effectId);
                  continue;
                }
                const paramName = t.paramKey;
                let mapped: number;
                
                // Cast bypass to boolean - toggle on note press
                if (paramName === 'bypass') {
                  const currentBypass = eff.bypass ? 1 : 0;
                  mapped = currentBypass ? 0 : 1; // toggle
                  logger.debug('[MIDI] Bypass param - current:', currentBypass, '-> toggled to:', mapped);
                } else {
                  const range = paramRanges[paramName] || { min: 0, max: 1 };
                  mapped = range.min + (velocity / 127) * (range.max - range.min);
                  // Cast integer params to int
                  if (paramName === 'bits' || paramName === 'algorithmIndex' || paramName === 'automakeup') {
                    mapped = Math.round(mapped);
                  }
                }
                // call AudioFX.updateEffectParams
                try {
                  logger.debug('[MIDI] Updating param', paramName, 'to', mapped, 'for effect', t.effectId);
                  AudioFX.updateEffectParams(t.effectId, { [paramName]: mapped });
                  logger.debug('[MIDI] Successfully updated', paramName);

                  try {
                    window.dispatchEvent(new CustomEvent('audiofx:paramsUpdated', { detail: { effectId: t.effectId, paramName, value: mapped } }));
                  } catch (e) {}
                } catch (e) {}
              } catch (e) {
                // ignore per-target errors
              }
            }
          }
          
          // If this slot has an action target, trigger it
          const actionCallback = onButtonActionRef.current;
          logger.debug('[MIDI] Action callback exists?', !!actionCallback, 'actionTarget:', slot.actionTarget);
          if (slot.actionTarget && actionCallback) {
            try {
              logger.debug('[MIDI] Calling callback for action:', slot.actionTarget);
              actionCallback(slot.actionTarget);
              logger.debug('[MIDI] Triggered action:', slot.actionTarget, 'from note', note);
            } catch (e) {
              logger.warn('[MIDI] Failed to trigger action', slot.actionTarget, e);
            }
          }
          
          // If this slot has a pan preset, trigger it
          const panCallback = onPanPresetRef.current;
          logger.debug('[MIDI] Pan callback exists?', !!panCallback, 'panPresetId:', slot.panPresetId);
          if (slot.panPresetId && panCallback) {
            try {
              logger.debug('[MIDI] Calling callback for pan preset:', slot.panPresetId);
              panCallback(slot.panPresetId);
              logger.debug('[MIDI] Triggered pan preset:', slot.panPresetId, 'from note', note);
            } catch (e) {
              logger.warn('[MIDI] Failed to trigger pan preset', slot.panPresetId, e);
            }
          }
        }
      });
    }
  }

  function startLearn(idx: number) {
    listeningRef.current = idx;
  }

  function clearMapping(idx: number) {
    const next = mappings.slice();
    // Preserve actionTarget if it exists (for predefined action slots)
    const actionTarget = next[idx].actionTarget;
    next[idx] = { assignedCC: null, assignedNote: null, targets: [], actionTarget, panPresetId: null };
    setMappings(next);
  }

  function addTarget(idx: number) {
    const effects = AudioFX.getEffects();
    if (!effects || effects.length === 0) return;
    const eff = effects[0];
    // Prefer bypass as the first option, then any numeric param
    const paramKey = 'bypass';
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

  // Cleanup stored mappings: remove targets that reference missing effects or invalid params
  useEffect(() => {
    const effects = AudioFX.getEffects();
    if (!effects || effects.length === 0) return;
    let changed = false;
    const next = mappings.map((slot) => {
      const targets = (slot.targets || []).filter((t) => {
        const eff = effects.find((e: any) => e.id === t.effectId);
        if (!eff) return false;
        const paramValue = (eff.params || {})[t.paramKey];
        // Allow numeric params and bypass (boolean)
        return typeof paramValue === 'number' || t.paramKey === 'bypass';
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
        <strong>MIDI Mapper</strong>
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
                    <div className="mt-2 space-y-2">
                      {/* Show CC/Note toggle only for bypass and for action/preset slots */}
                      {slot.actionTarget || slot.panPresetId ? (
                        <div className="flex items-center gap-2">
                          <label className="text-xs text-gray-600 w-10">Note</label>
                          <input type="number" min={0} max={127} value={slot.assignedNote ?? ""} onChange={(e) => {
                            const v = e.target.value === "" ? null : Math.max(0, Math.min(127, Number(e.target.value)));
                            const next = mappings.slice(); next[i] = { ...next[i], assignedCC: null, assignedNote: v }; setMappings(next);
                          }} className="w-20 p-1 border text-xs" />
                        </div>
                      ) : (() => {
                        const hasBypassTarget = slot.targets && slot.targets.some((t) => t.paramKey === 'bypass');
                        return hasBypassTarget ? (
                          <div className="space-y-2">
                            {/* For bypass param, show both CC and Note options */}
                            <div className="flex items-center gap-2">
                              <label className="text-xs text-gray-600">
                                <input type="radio" checked={slot.assignedCC !== null || slot.assignedNote === null} onChange={() => {
                                  const next = mappings.slice(); next[i] = { ...next[i], assignedNote: null }; setMappings(next);
                                }} className="mr-1" />
                                CC
                              </label>
                              <input type="number" min={0} max={127} value={slot.assignedCC ?? ""} onChange={(e) => {
                                const v = e.target.value === "" ? null : Math.max(0, Math.min(127, Number(e.target.value)));
                                const next = mappings.slice(); next[i] = { ...next[i], assignedCC: v, assignedNote: null }; setMappings(next);
                              }} className="w-20 p-1 border text-xs" disabled={slot.assignedNote !== null} />
                            </div>
                            <div className="flex items-center gap-2">
                              <label className="text-xs text-gray-600">
                                <input type="radio" checked={slot.assignedNote !== null} onChange={() => {
                                  const next = mappings.slice();
                                  // When switching to Note mode, ensure targets are set with bypass if not already present
                                  const newTargets = slot.targets && slot.targets.length > 0 ? slot.targets : 
                                    (slot.targets?.some(t => t.paramKey === 'bypass') ? slot.targets : 
                                      [{ effectId: (AudioFX.getEffects()[0]?.id || ''), paramKey: 'bypass' }]);
                                  next[i] = { ...next[i], assignedCC: null, targets: newTargets }; 
                                  setMappings(next);
                                }} className="mr-1" />
                                Note
                              </label>
                              <input type="number" min={0} max={127} value={slot.assignedNote ?? ""} onChange={(e) => {
                                const v = e.target.value === "" ? null : Math.max(0, Math.min(127, Number(e.target.value)));
                                const next = mappings.slice(); 
                                // Ensure targets exist when setting note value
                                const newTargets = slot.targets && slot.targets.length > 0 ? slot.targets : 
                                  (slot.targets?.some(t => t.paramKey === 'bypass') ? slot.targets : 
                                    [{ effectId: (AudioFX.getEffects()[0]?.id || ''), paramKey: 'bypass' }]);
                                next[i] = { ...next[i], assignedCC: null, assignedNote: v, targets: newTargets }; 
                                setMappings(next);
                              }} className="w-20 p-1 border text-xs" disabled={slot.assignedCC !== null} />
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2">
                            <label className="text-xs text-gray-600 w-10">CC</label>
                            <input type="number" min={0} max={127} value={slot.assignedCC ?? ""} onChange={(e) => {
                              const v = e.target.value === "" ? null : Math.max(0, Math.min(127, Number(e.target.value)));
                              const next = mappings.slice(); next[i] = { ...next[i], assignedCC: v, assignedNote: null }; setMappings(next);
                            }} className="w-20 p-1 border text-xs" />
                          </div>
                        );
                      })()}
                      <div className="flex items-center gap-2">
                        <button onClick={() => startLearn(i)} className="px-2 py-1 border rounded text-xs">{listeningRef.current === i ? 'Listening…' : 'Learn'}</button>
                        <button onClick={() => clearMapping(i)} className="px-2 py-1 border rounded text-xs text-red-600">Clear</button>
                      </div>
                    </div>
                    <div className="mt-3">
                      {slot.actionTarget ? (
                        <div className="p-2 bg-blue-50 rounded border border-blue-200">
                          <div className="text-xs font-medium text-blue-800">Action: {slot.actionTarget}</div>
                        </div>
                      ) : slot.panPresetId ? (
                        <div className="p-2 bg-purple-50 rounded border border-purple-200">
                          <div className="text-xs font-medium text-purple-800">Pan Preset: {availablePanPresets.find(p => p.id === slot.panPresetId)?.name || slot.panPresetId}</div>
                          {/* Only allow removal for non-dedicated preset slots (before slot 37) */}
                          {i < 36 && (
                            <button onClick={() => {
                              const next = mappings.slice();
                              next[i] = { ...next[i], panPresetId: null };
                              setMappings(next);
                            }} className="mt-1 px-2 py-0.5 border rounded text-xs text-red-600">Remove</button>
                          )}
                        </div>
                      ) : (
                        <>
                          <div className="flex items-center gap-2">
                            <div className="text-xs font-medium">Targets</div>
                            <button onClick={() => addTarget(i)} className="px-2 py-0.5 border rounded text-xs">Add</button>
                            {/* Only allow adding pan preset for slots 1-36 (not dedicated preset/action slots) */}
                            {availablePanPresets.length > 0 && i < 36 && (
                              <button onClick={() => {
                                const next = mappings.slice();
                                next[i] = { ...next[i], panPresetId: availablePanPresets[0].id, targets: [], assignedNote: next[i].assignedNote ?? 62 + i };
                                setMappings(next);
                              }} className="px-2 py-0.5 border rounded text-xs bg-purple-50">Pan Preset</button>
                            )}
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
                                    // Add bypass option if not already present (defensive check for uniqueness)
                                    const allKeys = keys.includes('bypass') ? keys : ['bypass', ...keys];
                                    return allKeys.map((k) => <option key={k} value={k}>{k}</option>);
                                  })()}
                                </select>
                                <button onClick={() => removeTarget(i, ti)} className="px-2 py-0.5 border rounded text-xs text-red-600">Remove</button>
                              </div>
                            ))}
                          </div>
                        </>
                      )}
                      {slot.panPresetId && availablePanPresets.length > 0 && (
                        <div className="mt-2">
                          <select 
                            value={slot.panPresetId} 
                            onChange={(e) => {
                              const next = mappings.slice();
                              next[i] = { ...next[i], panPresetId: e.target.value };
                              setMappings(next);
                            }} 
                            className="p-1 text-xs border w-full"
                          >
                            {availablePanPresets.map((preset) => (
                              <option key={preset.id} value={preset.id}>{preset.name}</option>
                            ))}
                          </select>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <div className="mt-2 text-xs text-gray-600">Tip: click Learn, then move a CC controller or press a MIDI note. Effect bypass params can use CC or Notes, other params use CC only, Actions and Pan Presets use Notes.</div>
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
              const mappingsWithActions = config.midiMappings.map(m => ({
                ...m,
                actionTarget: m.actionTarget as ButtonAction | null
              }));
              setMappings(mappingsWithActions);
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
              const mappingsWithActions = config.midiMappings.map(m => ({
                ...m,
                actionTarget: m.actionTarget as ButtonAction | null
              }));
              setMappings(mappingsWithActions);
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
