"use client";

import React, { createContext, useContext, useState, useRef, useEffect } from 'react';
import logger from "./logger";

export interface TranscriptMessage {
  role: 'user' | 'assistant';
  text: string;
  timestamp: number;
  partial?: boolean;
}

interface TranscriptContextType {
  messages: TranscriptMessage[];
  currentUserText: string;
  currentAssistantText: string;
  addUserText: (text: string, partial?: boolean) => void;
  addAssistantText: (text: string, partial?: boolean) => void;
  clearMessages: () => void;
  activeEffects: Array<{ id: string; type: string; params: any; bypass?: boolean }>;
  setActiveEffects: (effects: Array<{ id: string; type: string; params: any; bypass?: boolean }>) => void;
  waveformData: Float32Array | null;
  textDisplaySpeed: number; // milliseconds per word (default 400)
  setTextDisplaySpeed: (speed: number) => void;
  particleBrightness: number; // 0-1, brightness of main particles based on audio transients
  setParticleBrightness: (brightness: number) => void;
  resetParticles: () => void; // Trigger particle position reset
  isAudioPlaying: boolean; // Track if audio (mic or output) is currently playing
  setIsAudioPlaying: (playing: boolean) => void; // Set audio playing state
  waitingForAIResponse: boolean; // When true, suppress partial transcripts
  setWaitingForAIResponse: (waiting: boolean) => void;
}

const TranscriptContext = createContext<TranscriptContextType | undefined>(undefined);

export function TranscriptProvider({ children }: { children: React.ReactNode }) {
  const [messages, setMessages] = useState<TranscriptMessage[]>([]);
  const [currentUserText, setCurrentUserText] = useState('');
  const [currentAssistantText, setCurrentAssistantText] = useState('');
  const [activeEffects, setActiveEffects] = useState<Array<{ id: string; type: string; params: any; bypass?: boolean }>>([]);
  const [waveformData, setWaveformData] = useState<Float32Array | null>(null);
  const [textDisplaySpeed, setTextDisplaySpeed] = useState(400); // ms per word
  const [particleBrightness, setParticleBrightness] = useState(0); // 0-1 based on audio transients
  const [resetParticlesFlag, setResetParticlesFlag] = useState(0); // Counter to trigger reset
  const [isAudioPlaying, setIsAudioPlaying] = useState(false); // Track if audio is currently playing
  const [lastUserUpdate, setLastUserUpdate] = useState(0);
  const [lastAssistantUpdate, setLastAssistantUpdate] = useState(0);
  const lastUserMessageRef = useRef<TranscriptMessage | null>(null);
  const lastAssistantMessageRef = useRef<TranscriptMessage | null>(null);
  const channelRef = useRef<BroadcastChannel | null>(null);
  const [waitingForAIResponse, setWaitingForAIResponse] = useState(false);

  // Initialize BroadcastChannel for cross-tab communication
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const channel = new BroadcastChannel('nocturne-visualizer');
    channelRef.current = channel;
    logger.debug('[TranscriptContext] BroadcastChannel initialized');

    // Listen for messages from other tabs
    channel.onmessage = (event) => {
      const { type, data } = event.data;
      
      // Debug: log all incoming messages
      if (type === 'PARTICLE_BRIGHTNESS' && data > 0.01) {
        logger.debug(`[TranscriptContext] Received message type=${type} data=${data}`);
      }

      switch (type) {
        case 'USER_TEXT': {
          const text = typeof data?.text === 'string' ? data.text : '';
          const isPartial = Boolean(data?.partial);

          if (isPartial) {
            if (!waitingForAIResponse) {
              setCurrentUserText(text);
              setCurrentAssistantText('');
            } else {
              logger.debug('[TranscriptContext] Ignoring incoming partial USER_TEXT while waiting for AI response');
            }
          } else {
            setCurrentUserText(text);
            if (text.trim() && data?.message) {
              setMessages(prev => [...prev, data.message]);
            }
          }
          break;
        }
        case 'ASSISTANT_TEXT': {
          const text = typeof data?.text === 'string' ? data.text : '';
          const isPartial = Boolean(data?.partial);

          if (isPartial && waitingForAIResponse) {
            logger.debug('[TranscriptContext] Ignoring incoming partial ASSISTANT_TEXT while waiting for AI response');
          } else {
            setCurrentAssistantText(text);
            if (text) {
              setCurrentUserText('');
            }
          }

          if (!isPartial && text.trim() && data?.message) {
            setMessages(prev => [...prev, data.message]);
          }
          break;
        }
        case 'ACTIVE_EFFECTS':
          logger.debug('[TranscriptContext] Received ACTIVE_EFFECTS:', data);
          setActiveEffects(data);
          break;
        case 'WAVEFORM_DATA':
          if (data && data instanceof Float32Array) {
            setWaveformData(data);
          }
          break;
        case 'TEXT_DISPLAY_SPEED':
          if (typeof data === 'number') {
            setTextDisplaySpeed(data);
          }
          break;
        case 'PARTICLE_BRIGHTNESS':
          if (typeof data === 'number') {
            // Only log significant changes to reduce spam
            setParticleBrightness(Math.max(0, Math.min(1, data)));
          }
          break;
        case 'RESET_PARTICLES':
          logger.debug('[TranscriptContext] Received RESET_PARTICLES signal');
          setResetParticlesFlag(prev => prev + 1);
          break;
        case 'AUDIO_PLAYING':
          if (typeof data === 'boolean') {
            logger.debug('[TranscriptContext] Received AUDIO_PLAYING:', data);
            setIsAudioPlaying(data);
          }
          break;
        case 'CLEAR_MESSAGES':
          setMessages([]);
          setCurrentUserText('');
          setCurrentAssistantText('');
          break;
      }
    };

    return () => {
      channel.close();
    };
  }, []);

  const addUserText = (text: string, partial: boolean = false) => {
    const now = Date.now();
    setLastUserUpdate(now);
    
    if (partial) {
      // If we're waiting for an AI response, suppress partials
      if (waitingForAIResponse) {
        logger.debug('[TranscriptContext] Suppressing local partial USER_TEXT while waiting for AI response');
        return;
      }

      // User is speaking - show partial transcript
      setCurrentUserText(text);

      // Broadcast partial text to other tabs
      channelRef.current?.postMessage({
        type: 'USER_TEXT',
        data: { text, partial, message: null, timestamp: now },
      });
    } else {
      // User finished speaking - commit to history but keep text visible
      setCurrentUserText(text);
      
      if (text.trim()) {
        const message: TranscriptMessage = {
          role: 'user',
          text,
          timestamp: now,
          partial: false,
        };
        
        lastUserMessageRef.current = message;
        setMessages(prev => [...prev, message]);
        
        // Broadcast to other tabs
        channelRef.current?.postMessage({
          type: 'USER_TEXT',
          data: { text, partial, message, timestamp: now },
        });
      }
    }
  };

  const addAssistantText = (text: string, partial: boolean = false) => {
    const now = Date.now();
    setLastAssistantUpdate(now);
    // If we're waiting for AI response, suppress assistant partials (avoid flicker)
    if (partial && waitingForAIResponse) {
      logger.debug('[TranscriptContext] Suppressing local partial ASSISTANT_TEXT while waiting for AI response');
      return;
    }

    // Assistant is responding - show it and clear user text
    setCurrentAssistantText(text);
    setCurrentUserText('');
    
    if (!partial && text.trim()) {
      // Final response - commit to history
      const message: TranscriptMessage = {
        role: 'assistant',
        text,
        timestamp: now,
        partial: false,
      };
      
      lastAssistantMessageRef.current = message;
      setMessages(prev => [...prev, message]);
      
      // Broadcast to other tabs
      channelRef.current?.postMessage({
        type: 'ASSISTANT_TEXT',
        data: { text, partial, message, timestamp: now },
      });
    } else if (partial) {
      // Broadcast partial text to other tabs
      channelRef.current?.postMessage({
        type: 'ASSISTANT_TEXT',
        data: { text, partial, message: null, timestamp: now },
      });
    }
  };

  const setWaitingForAIResponseWithBroadcast = (waiting: boolean) => {
    setWaitingForAIResponse(waiting);
    try {
      channelRef.current?.postMessage({ type: 'WAITING_FOR_RESPONSE', data: waiting });
    } catch (e) {
      // ignore
    }
  };

  const clearMessages = () => {
    setMessages([]);
    setCurrentUserText('');
    setCurrentAssistantText('');
    lastUserMessageRef.current = null;
    lastAssistantMessageRef.current = null;
    
    // Broadcast to other tabs
    channelRef.current?.postMessage({ type: 'CLEAR_MESSAGES' });
  };

  const setActiveEffectsWithBroadcast = (effects: Array<{ id: string; type: string; params: any; bypass?: boolean }>) => {
    logger.debug('[TranscriptContext] Broadcasting ACTIVE_EFFECTS:', effects);
    setActiveEffects(effects);
    
    // Broadcast to other tabs
    channelRef.current?.postMessage({
      type: 'ACTIVE_EFFECTS',
      data: effects,
    });
  };

  const setTextDisplaySpeedWithBroadcast = (speed: number) => {
    setTextDisplaySpeed(speed);
    
    // Broadcast to other tabs
    channelRef.current?.postMessage({
      type: 'TEXT_DISPLAY_SPEED',
      data: speed,
    });
  };

  const setParticleBrightnessWithBroadcast = (brightness: number) => {
    const clamped = Math.max(0, Math.min(1, brightness));
    setParticleBrightness(clamped);
    
    // Broadcast to other tabs
    channelRef.current?.postMessage({
      type: 'PARTICLE_BRIGHTNESS',
      data: clamped,
    });
  };

  const resetParticlesWithBroadcast = () => {
    logger.debug('[TranscriptContext] Broadcasting RESET_PARTICLES signal');
    setResetParticlesFlag(prev => prev + 1);
    
    // Broadcast to other tabs
    channelRef.current?.postMessage({
      type: 'RESET_PARTICLES',
      data: true,
    });
  };

  const setIsAudioPlayingWithBroadcast = (playing: boolean) => {
    setIsAudioPlaying(playing);
    
    // Broadcast to other tabs
    channelRef.current?.postMessage({
      type: 'AUDIO_PLAYING',
      data: playing,
    });
  };

  return (
    <TranscriptContext.Provider
      value={{
        messages,
        currentUserText,
        currentAssistantText,
        addUserText,
        addAssistantText,
        clearMessages,
        activeEffects,
        setActiveEffects: setActiveEffectsWithBroadcast,
        waveformData,
        textDisplaySpeed,
        setTextDisplaySpeed: setTextDisplaySpeedWithBroadcast,
        particleBrightness,
        setParticleBrightness: setParticleBrightnessWithBroadcast,
        resetParticles: resetParticlesWithBroadcast,
        isAudioPlaying,
        setIsAudioPlaying: setIsAudioPlayingWithBroadcast,
        waitingForAIResponse,
        setWaitingForAIResponse: setWaitingForAIResponseWithBroadcast,
      }}
    >
      {children}
    </TranscriptContext.Provider>
  );
}

export function useTranscript() {
  const context = useContext(TranscriptContext);
  if (context === undefined) {
    throw new Error('useTranscript must be used within a TranscriptProvider');
  }
  return context;
}
