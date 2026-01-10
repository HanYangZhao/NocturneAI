/**
 * Transient Analyzer for detecting speech onsets and peaks
 * 
 * Designed for real-time pulsing with speech - fast attack and release
 * to follow syllables and speech rhythm.
 */

export class TransientAnalyzer {
  private audioContext: AudioContext;
  private analyser: AnalyserNode;
  private dataArray: Uint8Array;
  private smoothedBrightness: number = 0;

  constructor(audioContext: AudioContext) {
    this.audioContext = audioContext;
    this.analyser = audioContext.createAnalyser();
    this.analyser.fftSize = 256;
    this.analyser.smoothingTimeConstant = 0; // No smoothing - instant response
    const bufferLength = this.analyser.frequencyBinCount;
    this.dataArray = new Uint8Array(bufferLength);
  }

  /**
   * Connect the analyzer to a source node
   */
  connect(source: AudioNode): void {
    source.connect(this.analyser);
  }

  /**
   * Get the current brightness value based on audio energy (0-1)
   */
  getBrightness(): number {
    this.analyser.getByteFrequencyData(this.dataArray as any);
    
    // Focus on speech frequencies (bins 1-30 for 256 FFT)
    const startBin = 1;
    const endBin = Math.min(30, this.dataArray.length);
    
    let energy = 0;
    let maxValue = 0;
    
    for (let i = startBin; i < endBin; i++) {
      const value = this.dataArray[i];
      energy += value;
      if (value > maxValue) maxValue = value;
    }
    
    const avgEnergy = energy / (endBin - startBin);
    
    // Weight peak heavily for punchy response to consonants
    const combinedEnergy = (avgEnergy * 0.3 + maxValue * 0.7);
    
    // Normalize - use higher divisor so values vary dynamically (not always 1.0)
    const rawBrightness = Math.min(1, combinedEnergy / 180);
    
    // Very simple smoothing - just average with previous for slight smoothness
    // but still very responsive
    const smoothFactor = 0.1; // 10% old value, 90% new value - nearly instant
    this.smoothedBrightness = this.smoothedBrightness * smoothFactor + rawBrightness * (1 - smoothFactor);
    
    // Apply power curve to increase dynamic range (quieter parts dimmer, louder parts brighter)
    const output = Math.pow(this.smoothedBrightness, 0.6) * 1.2;
    
    return Math.max(0, Math.min(1, output));
  }

  /**
   * Disconnect the analyzer
   */
  disconnect(): void {
    try {
      this.analyser.disconnect();
    } catch (e) {
      // Ignore if already disconnected
    }
  }
}
