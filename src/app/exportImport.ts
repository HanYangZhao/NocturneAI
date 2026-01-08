// Export/Import utilities for effect parameters and MIDI CC configurations

export interface PanPreset {
  id: string;
  name: string;
  pans: { [voiceId: string]: number };
}

export interface ExportedConfig {
  version: string;
  timestamp: string;
  effects: Array<{
    id: string;
    type: string;
    params: any;
    bypass?: boolean;
  }>;
  midiMappings?: Array<{
    assignedCC: number | null;
    assignedNote?: number | null;
    targets: Array<{ effectId: string; paramKey: string }>;
    actionTarget?: string | null;
    panPresetId?: string | null;
  }>;
  midiChannel?: number;
  panPresets?: PanPreset[];
  currentPanPresetId?: string;
}

/**
 * Export current effect parameters and MIDI CC configurations
 */
export function exportConfig(
  effectsList: Array<{ id: string; type: string; params: any; bypass?: boolean }>,
  midiMappings?: any[],
  midiChannel?: number,
  panPresets?: PanPreset[],
  currentPanPresetId?: string
): ExportedConfig {
  return {
    version: '1.0',
    timestamp: new Date().toISOString(),
    effects: effectsList.map((e) => ({
      id: e.id,
      type: e.type,
      params: e.params || {},
      bypass: e.bypass,
    })),
    midiMappings: midiMappings || [],
    midiChannel: midiChannel ?? 1,
    panPresets: panPresets || [],
    currentPanPresetId: currentPanPresetId,
  };
}

/**
 * Import effect parameters and MIDI CC configurations
 * Returns { effects, midiMappings, midiChannel, panPresets, currentPanPresetId } ready to be applied
 */
export function importConfig(configJson: string): {
  effects: Array<{ id: string; type: string; params: any; bypass?: boolean }>;
  midiMappings: Array<{ 
    assignedCC: number | null; 
    assignedNote: number | null;
    targets: Array<{ effectId: string; paramKey: string }>;
    actionTarget: string | null;
    panPresetId: string | null;
  }>;
  midiChannel: number;
  panPresets: PanPreset[];
  currentPanPresetId: string | null;
} {
  const config: ExportedConfig = JSON.parse(configJson);

  if (!config.version || !Array.isArray(config.effects)) {
    throw new Error('Invalid config format');
  }

  return {
    effects: config.effects.map((e) => ({
      id: e.id,
      type: e.type,
      params: e.params || {},
      bypass: e.bypass ?? false,
    })),
    midiMappings: (config.midiMappings || []).map((m) => ({
      assignedCC: m.assignedCC ?? null,
      assignedNote: m.assignedNote ?? null,
      targets: m.targets || [],
      actionTarget: m.actionTarget ?? null,
      panPresetId: m.panPresetId ?? null,
    })),
    midiChannel: config.midiChannel ?? 1,
    panPresets: config.panPresets || [],
    currentPanPresetId: config.currentPanPresetId ?? null,
  };
}

/**
 * Download config as JSON file
 */
export function downloadConfigAsFile(config: ExportedConfig, filename: string = 'nocturne-config.json') {
  const json = JSON.stringify(config, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Load config from file
 */
export function loadConfigFromFile(): Promise<string> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = (e: any) => {
      const file = e.target.files?.[0];
      if (!file) {
        reject(new Error('No file selected'));
        return;
      }
      const reader = new FileReader();
      reader.onload = (event) => {
        try {
          const content = event.target?.result as string;
          resolve(content);
        } catch (err) {
          reject(err);
        }
      };
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsText(file);
    };
    input.click();
  });
}

/**
 * Copy config to clipboard as JSON
 */
export async function copyConfigToClipboard(config: ExportedConfig): Promise<void> {
  const json = JSON.stringify(config, null, 2);
  try {
    await navigator.clipboard.writeText(json);
  } catch (err) {
    throw new Error('Failed to copy to clipboard');
  }
}

/**
 * Load config from clipboard
 */
export async function loadConfigFromClipboard(): Promise<string> {
  try {
    const text = await navigator.clipboard.readText();
    return text;
  } catch (err) {
    throw new Error('Failed to read from clipboard');
  }
}
