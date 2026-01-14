
import logger from "./logger";
/**
 * Particle Effects System
 * Applies visual effects to particles that mirror audio effects
 * Similar to how audio effects are applied to sound, these particle effects
 * create visual manifestations of the same effects
 */

// Store effects from context (cross-tab compatible)
let cachedEffects: Array<{ id: string; type: string; params: any; bypass?: boolean }> = [];

/**
 * Update cached effects from TranscriptContext
 * Call this to sync effects from the main tab
 */
export function updateCachedEffects(effects: Array<{ id: string; type: string; params: any; bypass?: boolean }>) {
  cachedEffects = effects || [];
}

/**
 * Clear cached effects - called when resetting particle FX
 */
export function clearCachedEffects() {
  cachedEffects = [];
  resetPhaserState(); // Reset phaser state when clearing effects
  logger.info('[ParticleFX] Cached effects cleared - reset to default state');
}

/**
 * Get effects - tries TranscriptContext cache first, falls back to AudioFX
 */
function getEffects(): Array<{ id: string; type: string; params: any; bypass?: boolean }> {
  // First try cached effects (from TranscriptContext/BroadcastChannel)
  if (cachedEffects.length > 0) {
    return cachedEffects;
  }
  
  // Fallback: try direct AudioFX import (same-tab only)
  try {
    const AudioFX = require('./audiofx');
    if (AudioFX && AudioFX.getEffects) {
      return AudioFX.getEffects();
    }
  } catch (e) {
    // AudioFX not available in this context
  }
  
  return [];
}

export interface ParticleEffectState {
  delay?: {
    wetLevel: number;      // How much of the delayed effect to show
    delayTime: number;     // Delay time in ms
    feedback: number;      // Feedback amount
  };
  phaser?: {
    depth: number;         // Visual phasing depth
    rate: number;          // Modulation rate
  };
  tremolo?: {
    intensity: number;     // Amplitude modulation intensity
    rate: number;          // Modulation rate
  };
  bitcrusher?: {
    bits: number;          // Bit depth (affects particle pixelation/size)
  };
  filter?: {
    frequency: number;     // Filter frequency (affects particle spread/scatter)
    Q: number;             // Resonance
  };
  chorus?: {
    depth: number;         // Depth of chorus effect
    rate: number;          // Modulation rate
  };
  overdrive?: {
    drive: number;         // Drive amount (affects particle intensity/speed)
    outputGain: number;    // Output level
  };
  compressor?: {
    threshold: number;     // Compression threshold
    ratio: number;         // Compression ratio
  };
  radial?: {
    depth: number;         // Wave intensity/amplitude
    rate: number;          // Pulse frequency
  };
}

/**
 * Get current particle effect state based on active audio effects
 */
let lastEffectSummary = '';

export function getParticleEffectState(): ParticleEffectState {
  const audioEffects = getEffects(); // Use our cross-tab compatible getter
  
  // Log effect status with bypass state
  const effectSummary = audioEffects.map(e => `${e.type}(${e.bypass ? 'bypassed' : 'active'})`).join(',');
  if (effectSummary !== lastEffectSummary) {
    logger.debug(`[ParticleFX] getParticleEffectState effects: ${effectSummary || 'NONE'}`);
    logger.debug('[ParticleFX] Full effect list:', audioEffects.map(e => ({ type: e.type, bypass: e.bypass })));
    lastEffectSummary = effectSummary;
  }
  
  const state: ParticleEffectState = {};

  for (const effect of audioEffects) {
    if (effect.bypass) {
      continue; // Skip bypassed effects
    }

    switch (effect.type) {
      case 'Delay':
        state.delay = {
          wetLevel: effect.params?.wetLevel ?? 0.5,
          delayTime: effect.params?.delayTime ?? 100,
          feedback: effect.params?.feedback ?? 0.45,
        };
        break;

      case 'Phaser':
        state.phaser = {
          depth: effect.params?.depth ?? 0.6,
          rate: effect.params?.rate ?? 0.1,
        };
        break;

      case 'Tremolo':
        state.tremolo = {
          intensity: effect.params?.intensity ?? 0.3,
          rate: effect.params?.rate ?? 5,
        };
        break;

      case 'Bitcrusher':
        state.bitcrusher = {
          bits: effect.params?.bits ?? 4,
        };
        break;

      case 'Filter':
        state.filter = {
          frequency: effect.params?.frequency ?? 800,
          Q: effect.params?.Q ?? 1,
        };
        break;

      case 'Chorus':
        state.chorus = {
          depth: effect.params?.depth ?? 0.7,
          rate: effect.params?.rate ?? 1.5,
        };
        break;

      case 'Overdrive':
        state.overdrive = {
          drive: effect.params?.drive ?? 0.197,
          outputGain: effect.params?.outputGain ?? -9.154,
        };
        break;

      case 'Compressor':
        state.compressor = {
          threshold: effect.params?.threshold ?? -20,
          ratio: effect.params?.ratio ?? 4,
        };
        break;

      case 'RingModulator':
      {
        // RingModulator can be visually intense; scale down defaults and clamp values
        const paramDepth = effect.params?.depth ?? 0.8;
        const paramRate = effect.params?.frequency ?? 30; // RingModulator uses 'frequency', not 'rate'

        // Reduce default depth to 40% of provided/default to make modulation gentler
        const depth = Math.max(0, Math.min(1, paramDepth * 0.4));
        // Scale frequency directly to wave rate - higher frequency = faster waves (0.1Hz to 50Hz range)
        const rate = Math.max(0.025, paramRate * 0.025); // Scale down by 20x to get reasonable wave speeds

        state.radial = { depth, rate };
        break;
      }
    }
  }

  return state;
}

/**
 * Apply delay effect to particles
 * Creates echo/trailing particles that fade out
 */
export function applyDelayToParticles(
  positions: Float32Array,
  colors: Float32Array,
  delay: ParticleEffectState['delay'],
  time: number,
  particleCount: number
): { delayedPositions: Float32Array[]; delayedColors: Float32Array[] } {
  if (!delay || !delay.delayTime || delay.wetLevel === 0) {
    return { delayedPositions: [], delayedColors: [] };
  }

  // Use delayTime to determine spacing between copies (in units)
  const delayDistance = delay.delayTime * 0.005; // Convert delay time to spatial distance
  const delayedPositions: Float32Array[] = [];
  const delayedColors: Float32Array[] = [];

  // Create multiple delayed copies - limit to max 16 to prevent accumulation
  const numDelayedCopies = Math.min(16, Math.max(1, Math.floor(delay.feedback * 16)));
  
  for (let d = 1; d <= numDelayedCopies; d++) {
    // Calculate fade more conservatively
    const delayFade = 1 - (d / (numDelayedCopies + 2)); // More conservative fade
    const feedbackFactor = Math.pow(Math.max(0, Math.min(1, delay.feedback * 2)), d); // Clamp feedback to 0-1
    const wetAmount = delay.wetLevel * delayFade * feedbackFactor;

    if (wetAmount < 0.02) break; // Skip very faint copies

    const delayedPos = new Float32Array(positions.length);
    const delayedCol = new Float32Array(colors.length);

    // Copy positions with distance offset and colors with fade applied
    for (let i = 0; i < positions.length; i += 3) {
      // Offset position based on delay distance and copy index
      delayedPos[i] = positions[i] + delayDistance * d;
      delayedPos[i + 1] = positions[i + 1];
      delayedPos[i + 2] = positions[i + 2];
    }

    for (let i = 0; i < colors.length; i += 3) {
      delayedCol[i] = colors[i] * wetAmount;
      delayedCol[i + 1] = colors[i + 1] * wetAmount;
      delayedCol[i + 2] = colors[i + 2] * wetAmount;
    }

    delayedPositions.push(delayedPos);
    delayedColors.push(delayedCol);
  }

  return { delayedPositions, delayedColors };
}

/**
 * Apply phaser effect to particles
 * Creates a sweeping modulation of particle positions
 * Uses accumulated phase to prevent jitter when rate changes
 */
let phaserAccumulatedPhase = 0;
let lastPhaserRate = 0;
let lastPhaserDepth = 0;
const phaserPhaseSmoothing = 0.15; // How quickly to smooth rate changes (0-1, lower = smoother)
const depthSmoothing = 0.12; // Smooth depth changes to prevent pops

export function applyPhaserToParticles(
  positions: Float32Array,
  phaser: ParticleEffectState['phaser'],
  time: number,
  particleCount: number,
  deltaTime: number = 0.016 // ~60fps default
): Float32Array {
  if (!phaser || phaser.depth === 0) {
    return new Float32Array(positions);
  }

  const modPositions = new Float32Array(positions);
  
  // Smooth rate changes to prevent discontinuities
  // Exponential smoothing: smoothedValue += (targetValue - smoothedValue) * smoothingFactor
  lastPhaserRate += (phaser.rate - lastPhaserRate) * phaserPhaseSmoothing;
  lastPhaserDepth += (phaser.depth - lastPhaserDepth) * depthSmoothing;

  // Accumulate phase based on smoothed rate to prevent jitter
  // This ensures continuous phase progression even when rate changes
  phaserAccumulatedPhase += lastPhaserRate * deltaTime * Math.PI * 2;
  
  // Use accumulated phase instead of raw time for smooth transitions
  const phase = Math.sin(phaserAccumulatedPhase * 0.5);
  const sweepIntensity = lastPhaserDepth * 2.5; // Use smoothed depth

  for (let i = 0; i < modPositions.length; i += 3) {
    // Apply gentle sweep to X and Z axes with varying phase per particle
    const particlePhase = Math.cos(i * 0.1);
    modPositions[i] += phase * sweepIntensity * particlePhase;
    modPositions[i + 2] += phase * sweepIntensity * Math.sin(i * 0.1);
  }

  return modPositions as any;
}

/**
 * Reset phaser state - call when effects are cleared or audio stops
 */
export function resetPhaserState() {
  phaserAccumulatedPhase = 0;
  lastPhaserRate = 0;
  lastPhaserDepth = 0;
}

/**
 * Apply tremolo effect to particles
 * Modulates opacity/brightness of particles
 */
export function applyTremoloToParticles(
  colors: Float32Array,
  tremolo: ParticleEffectState['tremolo'],
  time: number
): Float32Array {
  if (!tremolo || tremolo.intensity === 0) {
    return new Float32Array(colors);
  }

  const modColors = new Float32Array(colors);
  const tremoloAmount = 0.5 + Math.sin(time * tremolo.rate * 2 * Math.PI) * 0.5; // 0 to 1
  // Create modulation that oscillates but never goes negative
  // At intensity=1: oscillates between 0.1 (dim) and 1.0 (bright)
  // At intensity=0.5: oscillates between 0.55 and 1.0
  const minBrightness = 0.3; // Never go below 10% brightness
  const modulationAmount = minBrightness + (1 - minBrightness) * (1 - tremolo.intensity * (1 - tremoloAmount));

  for (let i = 0; i < modColors.length; i++) {
    modColors[i] *= modulationAmount;
  }

  return modColors as any;
}

/**
 * Apply bitcrusher effect to particles
 * Reduces color bit depth for quantization effect
 */
export function applyBitcrusherToParticles(
  colors: Float32Array,
  bits: number
): Float32Array {
  if (!bits || bits >= 16) {
    return new Float32Array(colors);
  }
  if (bits < 2) {
    bits = 2; // Minimum 2 bits to avoid complete loss
  }

  const quantColors = new Float32Array(colors);
  const levels = Math.pow(2, bits);
  const step = 1 / (levels - 1);

  // Calculate desaturation amount: lower bits = more desaturation
  // Range: 16 bits = 0% desaturation, 2 bits = 100% desaturation
  const desaturation = Math.pow((16 - bits) / 14, 1.5);

  for (let i = 0; i < quantColors.length; i += 3) {
    // Apply quantization
    quantColors[i] = Math.round(quantColors[i] / step) * step;
    quantColors[i + 1] = Math.round(quantColors[i + 1] / step) * step;
    quantColors[i + 2] = Math.round(quantColors[i + 2] / step) * step;

    // Apply desaturation by moving colors toward gray
    const avg = (quantColors[i] + quantColors[i + 1] + quantColors[i + 2]) / 3;
    quantColors[i] = quantColors[i] * (1 - desaturation) + avg * desaturation;
    quantColors[i + 1] = quantColors[i + 1] * (1 - desaturation) + avg * desaturation;
    quantColors[i + 2] = quantColors[i + 2] * (1 - desaturation) + avg * desaturation;
  }

  return quantColors as any;
}

/**
 * Apply filter effect to particles
 * Affects particle scatter/spread based on cutoff frequency
 */
export function applyFilterToParticles(
  positions: Float32Array,
  filter: ParticleEffectState['filter'],
  time: number,
  particleCount: number
): Float32Array {
  if (!filter || !filter.frequency) {
    return new Float32Array(positions);
  }

  const modPositions = new Float32Array(positions);

  // High frequency = tight, centered particles
  // Low frequency = scattered, dispersed particles
  // Normalize frequency to 0-1 range (20Hz to 20000Hz)
  const normalizedFreq = Math.log2(filter.frequency / 20) / Math.log2(20000 / 20);
  const tightness = Math.max(0, Math.min(1, normalizedFreq)); // 0 = scattered, 1 = tight
  const scatter = (1 - tightness) * 30; // Increase from 15 to 30 for more visible scatter

  for (let i = 0; i < modPositions.length; i += 3) {
    // Add scatter noise based on frequency
    modPositions[i] += (Math.random() - 0.5) * scatter;
    modPositions[i + 1] += (Math.random() - 0.5) * scatter;
    modPositions[i + 2] += (Math.random() - 0.5) * scatter;
  }

  return modPositions as any;
}

/**
 * Apply chorus effect to particles
 * Creates multiple slightly offset copies that sweep
 */
export function applyChorusToParticles(
  positions: Float32Array,
  colors: Float32Array,
  chorus: ParticleEffectState['chorus'],
  time: number,
  particleCount: number
): { positions: Float32Array[]; colors: Float32Array[] } {
  if (!chorus || chorus.depth === 0) {
    return { positions: [new Float32Array(positions)], colors: [new Float32Array(colors)] };
  }

  const chorusPositions: Float32Array[] = [];
  const chorusColors: Float32Array[] = [];

  // Create 2-3 chorus copies
  const numCopies = 2;
  for (let c = 0; c < numCopies; c++) {
    const phase = (c / numCopies) * Math.PI * 2;
    const modAmount = chorus.depth * 3 * Math.sin(time * chorus.rate * 2 * Math.PI + phase);

    const pos = new Float32Array(positions);
    const col = new Float32Array(colors);

    for (let i = 0; i < pos.length; i += 3) {
      pos[i] += modAmount;
      pos[i + 1] += modAmount * 0.5;
      pos[i + 2] += modAmount * 0.7;
    }

    // Apply slight opacity reduction for blend effect
    for (let i = 0; i < col.length; i++) {
      col[i] *= 0.7;
    }

    chorusPositions.push(pos);
    chorusColors.push(col);
  }

  return { positions: chorusPositions, colors: chorusColors };
}

/**
 * Apply overdrive effect to particles
 * Increases intensity and speed of particles
 */
export function applyOverdriveToParticles(
  positions: Float32Array,
  colors: Float32Array,
  overdrive: ParticleEffectState['overdrive'],
  time: number
): { positions: Float32Array; colors: Float32Array; speedMultiplier: number } {
  if (!overdrive || overdrive.drive === 0) {
    return { positions: new Float32Array(positions), colors: new Float32Array(colors), speedMultiplier: 1 };
  }

  const driveAmount = Math.max(0, overdrive.drive); // 0 to 1+
  const speedMultiplier = 1 + driveAmount * 2; // Up to 3x speed

  const modPositions = new Float32Array(positions);
  const modColors = new Float32Array(colors);

  // Apply saturation to colors (clipping effect)
  const saturation = 1 + driveAmount * 0.5;
  for (let i = 0; i < modColors.length; i++) {
    modColors[i] = Math.min(1, modColors[i] * saturation);
  }

  return { positions: modPositions as any, colors: modColors as any, speedMultiplier };
}

/**
 * Apply radial modulation effect to particles
 * Creates expanding/contracting waves from the center point
 */
let lastRadialCenterRef: [number, number, number] | null = null;
let radialCenterSmoothingFactor = 0.1; // Smooth center changes to prevent jittering

export function applyRadialModulationToParticles(
  positions: Float32Array,
  colors: Float32Array,
  radial: ParticleEffectState['radial'],
  time: number,
  particleCount: number
): { positions: Float32Array; colors: Float32Array } {
  if (!radial || radial.depth === 0) {
    return { positions: new Float32Array(positions), colors: new Float32Array(colors) };
  }

  const modPositions = new Float32Array(positions);
  const modColors = new Float32Array(colors);

  // Calculate center of particle cloud with smoothing to prevent jitter
  let centerX = 0, centerY = 0, centerZ = 0;
  for (let i = 0; i < modPositions.length; i += 3) {
    centerX += modPositions[i];
    centerY += modPositions[i + 1];
    centerZ += modPositions[i + 2];
  }
  centerX /= particleCount;
  centerY /= particleCount;
  centerZ /= particleCount;

  // Smooth the center to prevent sudden jumps
  if (lastRadialCenterRef === null) {
    lastRadialCenterRef = [centerX, centerY, centerZ];
  } else {
    centerX = lastRadialCenterRef[0] + (centerX - lastRadialCenterRef[0]) * radialCenterSmoothingFactor;
    centerY = lastRadialCenterRef[1] + (centerY - lastRadialCenterRef[1]) * radialCenterSmoothingFactor;
    centerZ = lastRadialCenterRef[2] + (centerZ - lastRadialCenterRef[2]) * radialCenterSmoothingFactor;
    lastRadialCenterRef = [centerX, centerY, centerZ];
  }

  // Normalize depth to reasonable range (0-1 maps to visible-dramatic)
  // This allows good control while keeping particles visible
  const normalizedDepth = Math.max(0, Math.min(1, radial.depth));
  const waveIntensity = normalizedDepth * 2.5; // Moderate wave intensity
  const waveFrequency = Math.max(0.1, radial.rate); // Prevent zero or negative frequency
  const baseDistance = 15; // Reference distance for wave scaling

  for (let i = 0; i < particleCount; i++) {
    const posIdx = i * 3;
    const colorIdx = i * 3;

    // Get particle's distance from center
    const dx = modPositions[posIdx] - centerX;
    const dy = modPositions[posIdx + 1] - centerY;
    const dz = modPositions[posIdx + 2] - centerZ;
    const distanceFromCenter = Math.sqrt(dx * dx + dy * dy + dz * dz);

    // Apply effect while maintaining minimum distance to prevent clustering
    if (distanceFromCenter > 0.0001) {
      const normalizedDx = dx / distanceFromCenter;
      const normalizedDy = dy / distanceFromCenter;
      const normalizedDz = dz / distanceFromCenter;

      // Create a traveling wave that expands and contracts
      // Uses distance-dependent phase for expanding ripple pattern
      const wavePhase = time * waveFrequency - distanceFromCenter * 1.5;
      const waveDisplacement = Math.sin(wavePhase) * waveIntensity;

      // Apply radial displacement with strong movement for visibility
      modPositions[posIdx] += normalizedDx * waveDisplacement;
      modPositions[posIdx + 1] += normalizedDy * waveDisplacement * 0.7;
      modPositions[posIdx + 2] += normalizedDz * waveDisplacement;

      // Add perpendicular motion for more interesting patterns
      const perpPhase = wavePhase + Math.PI / 2;
      const perpDisplacement = Math.sin(perpPhase) * waveIntensity * 0.4;
      modPositions[posIdx] += -normalizedDz * perpDisplacement * 0.4;
      modPositions[posIdx + 2] += normalizedDx * perpDisplacement * 0.4;
    } else {
      // Particles at center - apply minimal repulsive force to spread them out
      const repulsion = waveIntensity * 0.05;
      modPositions[posIdx] += (Math.random() - 0.5) * repulsion;
      modPositions[posIdx + 1] += (Math.random() - 0.5) * repulsion;
      modPositions[posIdx + 2] += (Math.random() - 0.5) * repulsion;
    }
  }

  logger.debug('[ParticleFX] Radial modulation applied - depth:', normalizedDepth, 'frequency:', waveFrequency, 'intensity:', waveIntensity);
  return { positions: modPositions, colors: modColors };
}

/**
 * Apply compressor effect to particles
 * Reduces dynamic range - makes bright particles dimmer and dim particles brighter
 */
export function applyCompressorToParticles(
  colors: Float32Array,
  compressor: ParticleEffectState['compressor']
): Float32Array {
  if (!compressor) {
    return new Float32Array(colors);
  }

  const modColors = new Float32Array(colors);
  // Normalize threshold from dB to 0-1 range (-60dB to 0dB)
  const thresholdNorm = Math.max(0, Math.min(1, (compressor.threshold + 60) / 60));
  const ratio = compressor.ratio || 4;

  for (let i = 0; i < modColors.length; i++) {
    const brightness = modColors[i];
    if (brightness > thresholdNorm) {
      // Compress the peak
      const excess = brightness - thresholdNorm;
      const compressed = thresholdNorm + excess / ratio;
      modColors[i] = Math.min(1, compressed);
    }
  }

  return modColors as any;
}

/**
 * Apply visual tint based on active effects for debugging/visibility
 * This is an optional overlay that makes effects more obvious
 */
export function applyEffectDebugTint(
  colors: Float32Array,
  effectState: ParticleEffectState
): Float32Array {
  // Debug tint disabled - effects are visible without color modification
  return new Float32Array(colors);
}

let isFirstCall = true;
let lastEffectUpdateTime = 0;

export function applyAllParticleEffects(
  positions: Float32Array,
  colors: Float32Array,
  time: number,
  particleCount: number,
  deltaTime?: number
): {
  positions: Float32Array;
  colors: Float32Array;
  delayedParticles?: Array<{ positions: Float32Array; colors: Float32Array }>;
  chorusParticles?: Array<{ positions: Float32Array; colors: Float32Array }>;
  speedMultiplier: number;
} {
  if (isFirstCall) {
    logger.info('[ParticleFX] applyAllParticleEffects() called for first time - system is running');
    isFirstCall = false;
  }
  
  // Calculate deltaTime if not provided
  const dt = deltaTime ?? 0.016; // Default to ~60fps (16ms)
  
  const effectState = getParticleEffectState();
  let currentPositions: any = new Float32Array(positions);
  let currentColors: any = new Float32Array(colors);
  let speedMultiplier = 1;
  const delayedParticles: Array<{ positions: Float32Array; colors: Float32Array }> = [];
  const chorusParticles: Array<{ positions: Float32Array; colors: Float32Array }> = [];

  // Apply phaser
  if (effectState.phaser) {
    currentPositions = applyPhaserToParticles(currentPositions, effectState.phaser, time, particleCount, dt);
  }

//   // Apply filter
//   if (effectState.filter) {
//     currentPositions = applyFilterToParticles(currentPositions, effectState.filter, time, particleCount);
//   }

  // Apply tremolo
  if (effectState.tremolo) {
    currentColors = applyTremoloToParticles(currentColors, effectState.tremolo, time);
  }

  // Apply bitcrusher
  if (effectState.bitcrusher) {
    currentColors = applyBitcrusherToParticles(currentColors, effectState.bitcrusher.bits);
  }

  // Apply compressor
  if (effectState.compressor) {
    currentColors = applyCompressorToParticles(currentColors, effectState.compressor);
  }

  // Apply radial modulation (creates expanding/contracting waves)
  if (effectState.radial) {
    const result = applyRadialModulationToParticles(currentPositions, currentColors, effectState.radial, time, particleCount);
    currentPositions = result.positions;
    currentColors = result.colors;
  }

  // Apply overdrive (affects speed)
  if (effectState.overdrive) {
    const result = applyOverdriveToParticles(currentPositions, currentColors, effectState.overdrive, time);
    currentPositions = result.positions;
    currentColors = result.colors;
    speedMultiplier = result.speedMultiplier;
  }

  // Apply delay (creates additional particles)
  if (effectState.delay) {
    const { delayedPositions, delayedColors } = applyDelayToParticles(
      currentPositions,
      currentColors,
      effectState.delay,
      time,
      particleCount
    );
    for (let i = 0; i < delayedPositions.length; i++) {
      delayedParticles.push({
        positions: delayedPositions[i],
        colors: delayedColors[i],
      });
    }
  }

  // Apply chorus (creates multiple offset copies)
  if (effectState.chorus) {
    const { positions: chorusPos, colors: chorusCol } = applyChorusToParticles(
      currentPositions,
      currentColors,
      effectState.chorus,
      time,
      particleCount
    );
    for (let i = 0; i < chorusPos.length; i++) {
      chorusParticles.push({
        positions: chorusPos[i],
        colors: chorusCol[i],
      });
    }
  }

  // Apply debug tint to make effects visually obvious
//   const tintedColors = applyEffectDebugTint(currentColors, effectState);

  return {
    positions: currentPositions,
    colors: currentColors,
    delayedParticles: delayedParticles.length > 0 ? delayedParticles : undefined,
    chorusParticles: chorusParticles.length > 0 ? chorusParticles : undefined,
    speedMultiplier,
  };
}
