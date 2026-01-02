/**
 * Audio Mixer for managing multiple TTS voice playback simultaneously
 * Each voice gets its own gain node for independent volume control
 */

export interface VoiceChannel {
  id: string;
  name: string;
  gainNode: GainNode;
  volume: number;
  muted: boolean;
  activeSource: AudioBufferSourceNode | null;
}

export class AudioMixer {
  private audioContext: AudioContext;
  private masterGain: GainNode;
  private channels: Map<string, VoiceChannel> = new Map();
  private destination: AudioNode;

  constructor(audioContext: AudioContext, destination: AudioNode) {
    this.audioContext = audioContext;
    this.destination = destination;
    
    // Create master gain node
    // Note: Master gain does NOT connect to destination here.
    // The effects chain will be connected between masterGain and destination.
    this.masterGain = audioContext.createGain();
    this.masterGain.gain.value = 1.0;
  }

  /**
   * Create or get a voice channel
   */
  getOrCreateChannel(id: string, name: string, defaultVolume: number = 1.0): VoiceChannel {
    if (this.channels.has(id)) {
      return this.channels.get(id)!;
    }

    const gainNode = this.audioContext.createGain();
    gainNode.gain.value = defaultVolume;
    gainNode.connect(this.masterGain);

    const channel: VoiceChannel = {
      id,
      name,
      gainNode,
      volume: defaultVolume,
      muted: false,
      activeSource: null,
    };

    this.channels.set(id, channel);
    return channel;
  }

  /**
   * Play audio buffer on a specific channel
   */
  playOnChannel(
    channelId: string,
    buffer: AudioBuffer,
    onEnded?: () => void
  ): AudioBufferSourceNode {
    const channel = this.channels.get(channelId);
    if (!channel) {
      throw new Error(`Channel ${channelId} not found`);
    }

    // Stop any existing audio on this channel
    if (channel.activeSource) {
      try {
        channel.activeSource.stop();
        channel.activeSource.disconnect();
      } catch (e) {
        // ignore if already stopped
      }
    }

    const source = this.audioContext.createBufferSource();
    source.buffer = buffer;
    source.connect(channel.gainNode);

    source.onended = () => {
      if (channel.activeSource === source) {
        channel.activeSource = null;
      }
      if (onEnded) {
        onEnded();
      }
    };

    channel.activeSource = source;
    source.start();

    return source;
  }

  /**
   * Set volume for a specific channel (0.0 to 1.0)
   */
  setChannelVolume(channelId: string, volume: number) {
    const channel = this.channels.get(channelId);
    if (channel) {
      channel.volume = Math.max(0, Math.min(1, volume));
      channel.gainNode.gain.value = channel.muted ? 0 : channel.volume;
    }
  }

  /**
   * Mute or unmute a specific channel
   */
  setChannelMute(channelId: string, muted: boolean) {
    const channel = this.channels.get(channelId);
    if (channel) {
      channel.muted = muted;
      channel.gainNode.gain.value = muted ? 0 : channel.volume;
    }
  }

  /**
   * Stop playback on a specific channel
   */
  stopChannel(channelId: string) {
    const channel = this.channels.get(channelId);
    if (channel && channel.activeSource) {
      try {
        channel.activeSource.stop();
        channel.activeSource.disconnect();
      } catch (e) {
        // ignore
      }
      channel.activeSource = null;
    }
  }

  /**
   * Stop all channels
   */
  stopAll() {
    for (const [channelId] of this.channels) {
      this.stopChannel(channelId);
    }
  }

  /**
   * Set master volume (affects all channels)
   */
  setMasterVolume(volume: number) {
    this.masterGain.gain.value = Math.max(0, Math.min(1, volume));
  }

  /**
   * Get the master gain node for connecting effects chain
   */
  getMasterGain(): GainNode {
    return this.masterGain;
  }

  /**
   * Get all channels
   */
  getChannels(): VoiceChannel[] {
    return Array.from(this.channels.values());
  }

  /**
   * Get a specific channel
   */
  getChannel(channelId: string): VoiceChannel | undefined {
    return this.channels.get(channelId);
  }

  /**
   * Remove a channel
   */
  removeChannel(channelId: string) {
    const channel = this.channels.get(channelId);
    if (channel) {
      this.stopChannel(channelId);
      try {
        channel.gainNode.disconnect();
      } catch (e) {
        // ignore
      }
      this.channels.delete(channelId);
    }
  }

  /**
   * Clean up all resources
   */
  dispose() {
    this.stopAll();
    for (const [channelId] of this.channels) {
      this.removeChannel(channelId);
    }
    try {
      this.masterGain.disconnect();
    } catch (e) {
      // ignore
    }
  }
}
