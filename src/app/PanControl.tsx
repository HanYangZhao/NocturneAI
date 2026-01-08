"use client";

import React, { useEffect, useState } from "react";

export interface PanPreset {
  id: string;
  name: string;
  pans: { [voiceId: string]: number }; // -1 to +1
}

// 10 default panning presets
export const DEFAULT_PAN_PRESETS: PanPreset[] = [
  {
    id: "preset1",
    name: "1",
    pans: { voice1: 0, voice2: 0, voice3: 0 }
  },
  {
    id: "preset2",
    name: "2",
    pans: { voice1: 0, voice2: 0, voice3: 0 }
  },
  {
    id: "preset3",
    name: "3",
    pans: { voice1: 0, voice2: 0, voice3: 0 }
  },
  {
    id: "preset4",
    name: "4",
    pans: { voice1: 0, voice2: 0, voice3: 0 }
  },
  {
    id: "preset5",
    name: "5",
    pans: { voice1: 0, voice2: 0, voice3: 0 }
  },
  {
    id: "preset6",
    name: "6",
    pans: { voice1: 0, voice2: 0, voice3: 0 }
  },
  {
    id: "preset7",
    name: "7",
    pans: { voice1: 0, voice2: 0, voice3: 0 }
  },
  {
    id: "preset8",
    name: "8",
    pans: { voice1: 0, voice2: 0, voice3: 0 }
  },
  {
    id: "preset9",
    name: "9",
    pans: { voice1: 0, voice2: 0, voice3: 0 }
  },
  {
    id: "preset10",
    name: "10",
    pans: { voice1: 0, voice2: 0, voice3: 0 }
  }
];

interface PanControlProps {
  voices: Array<{ 
    id: string; 
    name: string; 
    enabled: boolean;
    elevenLabsVoiceId?: string;
  }>;
  presets: PanPreset[];
  currentPresetId: string;
  onPanChange: (voiceId: string, pan: number) => void;
  onPresetChange: (preset: PanPreset) => void;
  onPresetsUpdate: (presets: PanPreset[]) => void;
}

export default function PanControl({ voices, presets, currentPresetId, onPanChange, onPresetChange, onPresetsUpdate }: PanControlProps) {
  const [pans, setPans] = useState<{ [voiceId: string]: number }>(() => {
    // Initialize with center panning
    const initial: { [voiceId: string]: number } = {};
    voices.forEach(v => {
      initial[v.id] = 0;
    });
    return initial;
  });
  
  const [editingPresetId, setEditingPresetId] = useState<string | null>(null);
  const [showAddPreset, setShowAddPreset] = useState(false);
  const [newPresetName, setNewPresetName] = useState("");

  // Sync internal pans state when preset changes externally (e.g., via MIDI)
  useEffect(() => {
    const preset = presets.find(p => p.id === currentPresetId);
    if (preset) {
      const newPans: { [voiceId: string]: number } = {};
      voices.forEach(v => {
        newPans[v.id] = preset.pans[v.id] ?? 0;
      });
      setPans(newPans);
    }
  }, [currentPresetId, presets, voices]);

  // Apply preset when selected
  const applyPreset = (presetId: string) => {
    const preset = presets.find(p => p.id === presetId);
    if (!preset) return;
    
    const newPans: { [voiceId: string]: number } = {};
    
    voices.forEach(v => {
      const pan = preset.pans[v.id] ?? 0;
      newPans[v.id] = pan;
      onPanChange(v.id, pan);
    });
    
    setPans(newPans);
    onPresetChange(preset);
  };

  const updatePresetName = (presetId: string, newName: string) => {
    const updated = presets.map(p => 
      p.id === presetId ? { ...p, name: newName } : p
    );
    onPresetsUpdate(updated);
  };

  const updateCurrentPresetPans = () => {
    const preset = presets.find(p => p.id === currentPresetId);
    if (!preset) return;
    
    const updated = presets.map(p => 
      p.id === currentPresetId ? { ...p, pans: { ...pans } } : p
    );
    onPresetsUpdate(updated);
  };

  const addNewPreset = () => {
    if (!newPresetName.trim()) return;
    
    const newId = `preset_${Date.now()}`;
    const newPreset: PanPreset = {
      id: newId,
      name: newPresetName,
      pans: { ...pans }
    };
    
    onPresetsUpdate([...presets, newPreset]);
    setNewPresetName("");
    setShowAddPreset(false);
    onPresetChange(newPreset);
  };

  const deletePreset = (presetId: string) => {
    if (presets.length <= 1) {
      alert("Cannot delete the last preset");
      return;
    }
    
    const filtered = presets.filter(p => p.id !== presetId);
    onPresetsUpdate(filtered);
    
    // If deleting current preset, switch to first available
    if (currentPresetId === presetId) {
      applyPreset(filtered[0].id);
    }
  };

  const handlePanChange = (voiceId: string, pan: number) => {
    setPans(prev => ({ ...prev, [voiceId]: pan }));
    onPanChange(voiceId, pan);
  };

  const enabledVoices = voices.filter(v => v.enabled && v.elevenLabsVoiceId);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <label className="block text-sm font-medium">Voice Panning</label>
        <div className="flex items-center gap-2">
          <label className="text-xs text-gray-600">Preset:</label>
          {editingPresetId === currentPresetId ? (
            <div className="flex items-center gap-1">
              <input
                type="text"
                value={presets.find(p => p.id === currentPresetId)?.name || ""}
                onChange={(e) => updatePresetName(currentPresetId, e.target.value)}
                className="text-sm p-1 border rounded w-32"
                autoFocus
              />
              <button
                onClick={() => setEditingPresetId(null)}
                className="text-xs px-2 py-1 border rounded bg-green-50 hover:bg-green-100"
              >
                ✓
              </button>
            </div>
          ) : (
            <>
              <select
                value={currentPresetId}
                onChange={(e) => applyPreset(e.target.value)}
                className="text-sm p-1 border rounded"
              >
                {presets.map(preset => (
                  <option key={preset.id} value={preset.id}>
                    {preset.name}
                  </option>
                ))}
              </select>
              <button
                onClick={() => setEditingPresetId(currentPresetId)}
                className="text-xs px-2 py-1 border rounded hover:bg-gray-100"
                title="Edit preset name"
              >
                ✏️
              </button>
              <button
                onClick={updateCurrentPresetPans}
                className="text-xs px-2 py-1 border rounded bg-blue-50 hover:bg-blue-100"
                title="Update preset with current values"
              >
                💾
              </button>
              <button
                onClick={() => setShowAddPreset(true)}
                className="text-xs px-2 py-1 border rounded bg-green-50 hover:bg-green-100"
                title="Add new preset"
              >
                ➕
              </button>
              <button
                onClick={() => {
                  if (confirm(`Delete preset "${presets.find(p => p.id === currentPresetId)?.name}"?`)) {
                    deletePreset(currentPresetId);
                  }
                }}
                className="text-xs px-2 py-1 border rounded bg-red-50 hover:bg-red-100"
                title="Delete preset"
              >
                🗑️
              </button>
            </>
          )}
        </div>
      </div>

      {showAddPreset && (
        <div className="p-3 border rounded bg-blue-50">
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium">New Preset Name:</label>
            <input
              type="text"
              value={newPresetName}
              onChange={(e) => setNewPresetName(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && addNewPreset()}
              className="text-sm p-1 border rounded flex-1"
              placeholder="Enter preset name"
              autoFocus
            />
            <button
              onClick={addNewPreset}
              className="text-xs px-2 py-1 border rounded bg-green-50 hover:bg-green-100"
            >
              Add
            </button>
            <button
              onClick={() => {
                setShowAddPreset(false);
                setNewPresetName("");
              }}
              className="text-xs px-2 py-1 border rounded hover:bg-gray-100"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {enabledVoices.length === 0 ? (
        <div className="text-xs text-gray-500 text-center py-2">
          No enabled voices
        </div>
      ) : (
        <div className="space-y-2">
          {enabledVoices.map(voice => (
            <div key={voice.id} className="flex items-center gap-3">
              <div className="w-20 text-sm font-medium truncate" title={voice.name}>
                {voice.name}
              </div>
              <div className="flex-1 flex items-center gap-2">
                <span className="text-xs text-gray-500 w-8 text-right">L</span>
                <input
                  type="range"
                  min="-1"
                  max="1"
                  step="0.01"
                  value={pans[voice.id] ?? 0}
                  onChange={(e) => handlePanChange(voice.id, parseFloat(e.target.value))}
                  className="flex-1"
                />
                <span className="text-xs text-gray-500 w-8">R</span>
                <span className="text-xs text-gray-600 w-12 text-right font-mono">
                  {(pans[voice.id] ?? 0).toFixed(2)}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
