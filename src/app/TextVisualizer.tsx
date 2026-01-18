"use client";

import React, { useRef, useEffect, useState } from 'react';
import { useTranscript } from './TranscriptContext';
import * as THREE from 'three';
import * as ParticleFX from './particlefx';
import logger from './logger';
export default function TextVisualizer() {
  const { currentUserText, currentAssistantText, waveformData, textDisplaySpeed, particleBrightness, activeEffects, resetParticles, isAudioPlaying } = useTranscript();
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const particlesRef = useRef<THREE.Points | null>(null);
  const particleOriginalColorsRef = useRef<Float32Array | null>(null);
  const particleOriginalPositionsRef = useRef<Float32Array | null>(null);
  const delayedParticlesRef = useRef<THREE.Points[]>([]);
  const chorusParticlesRef = useRef<THREE.Points[]>([]);
  const animationFrameRef = useRef<number | null>(null);
  const particleBrightnessRef = useRef<number>(0);
  const smoothedBrightnessRef = useRef<number>(0); // Smoothed value for rendering
  const lastLoggedEffectsRef = useRef<string>(''); // Track last logged effects to avoid spam
  const isAudioPlayingRef = useRef<boolean>(false);
  const smokeParticlesOriginalDataRef = useRef<Array<{ scale: number; opacity: number }>>([]);
  const smokeAnimationTimeRef = useRef<number>(0);
  const wasAudioPlayingRef = useRef<boolean>(false);
  const smokeAnimationDurationRef = useRef<number>(0.3); // 0.3 seconds for expand/contract animation
  const textDisplayDelayRef = useRef<number>(0); // Delay before showing text after audio starts
  const audioStartTimeRef = useRef<number | null>(null); // Track when audio started
  const [displayedText, setDisplayedText] = useState('');
  const [currentWindowIndex, setCurrentWindowIndex] = useState(0);
  const textStartTimeRef = useRef<number | null>(null);
  const lastFullTextRef = useRef<string>('');
  const textMeshesRef = useRef<THREE.Mesh[]>([]);
  const textSpriteRef = useRef<THREE.Sprite | null>(null);
  const labelSpriteRef = useRef<THREE.Sprite | null>(null);
  const displayedTextRef = useRef<string>('');
  const textRoleRef = useRef<'user' | 'assistant' | null>(null);
  
  // Sprite sheet animation state
  const spriteCurrentFrameRef = useRef<number>(0);
  const spriteFrameTimeRef = useRef<number>(0);
  const spriteConfigRef = useRef({ horizontal: 8, vertical: 8, total: 64, duration: 50 });

  // Update particle effects cache when activeEffects changes
  useEffect(() => {
    ParticleFX.updateCachedEffects(activeEffects);
    logger.debug('[ParticleFX] Updated cached effects from context:', activeEffects);
  }, [activeEffects]);

  // Listen directly to BroadcastChannel for brightness updates (for cross-tab communication)
  // Also sync from context's particleBrightness for same-tab usage
  useEffect(() => {
    if (typeof window === 'undefined') return;
    
    const channel = new BroadcastChannel('nocturne-visualizer');
    
    channel.onmessage = (event) => {
      const { type, data } = event.data;
      if (type === 'PARTICLE_BRIGHTNESS' && typeof data === 'number') {
        // Update ref directly - no React state involved
        particleBrightnessRef.current = data;
      } else if (type === 'AUDIO_PLAYING' && typeof data === 'boolean') {
        isAudioPlayingRef.current = data;
        // When audio stops, reset particles to idle state
        if (!data) {
          logger.debug('[TextVisualizer] Audio stopped, resetting particles to idle state');
          if (particlesRef.current && particleOriginalPositionsRef.current) {
            const posAttr = particlesRef.current.geometry.attributes.position as THREE.BufferAttribute;
            const posArray = posAttr.array as Float32Array;
            
            // Restore original positions
            for (let i = 0; i < particleOriginalPositionsRef.current.length; i++) {
              posArray[i] = particleOriginalPositionsRef.current[i];
            }
            posAttr.needsUpdate = true;
            logger.info('[TextVisualizer] Particles reset to idle state');
          }
        }
      } else if (type === 'RESET_PARTICLES') {
        // Reset particles to original positions
        logger.debug('[TextVisualizer] Received RESET_PARTICLES signal from BroadcastChannel');
        if (particlesRef.current && particleOriginalPositionsRef.current) {
          const posAttr = particlesRef.current.geometry.attributes.position as THREE.BufferAttribute;
          const posArray = posAttr.array as Float32Array;
          
          // Restore original positions
          for (let i = 0; i < particleOriginalPositionsRef.current.length; i++) {
            posArray[i] = particleOriginalPositionsRef.current[i];
          }
          posAttr.needsUpdate = true;
          logger.info('[TextVisualizer] Particle positions reset to original layout');
        }
      }
    };
    
    return () => {
      channel.close();
    };
  }, []);

  // Sync brightness from context (for same-tab usage where BroadcastChannel doesn't work)
  useEffect(() => {
    particleBrightnessRef.current = particleBrightness;
  }, [particleBrightness]);

  // Sync audio playing state from context
  useEffect(() => {
    isAudioPlayingRef.current = isAudioPlaying;
    
    if (isAudioPlaying) {
      // Audio just started - record the start time
      audioStartTimeRef.current = Date.now();
      textDisplayDelayRef.current = smokeAnimationDurationRef.current * 1000; // Convert to ms
    } else {
      // Audio stopped
      audioStartTimeRef.current = null;
      textDisplayDelayRef.current = 0;
    }
    
    // When audio stops, reset particles to idle state
    if (!isAudioPlaying) {
      logger.debug('[TextVisualizer] Audio stopped, resetting particles to idle state');
      if (particlesRef.current && particleOriginalPositionsRef.current) {
        const posAttr = particlesRef.current.geometry.attributes.position as THREE.BufferAttribute;
        const posArray = posAttr.array as Float32Array;
        
        // Restore original positions
        for (let i = 0; i < particleOriginalPositionsRef.current.length; i++) {
          posArray[i] = particleOriginalPositionsRef.current[i];
        }
        posAttr.needsUpdate = true;
        logger.info('[TextVisualizer] Particles reset to idle state');
      }
    }
  }, [isAudioPlaying]);

  // Prefer showing the latest user partial; fall back to assistant output.
  const fullText = currentUserText || currentAssistantText;
  const textRole: 'user' | 'assistant' | null = currentUserText
    ? 'user'
    : currentAssistantText
    ? 'assistant'
    : null;

  // Audio-synced text display with 25-word windows
  useEffect(() => {
    if (!fullText) {
      setDisplayedText('');
      setCurrentWindowIndex(0);
      textStartTimeRef.current = null;
      lastFullTextRef.current = '';
      return;
    }

    // Reset if text changed (new speaker)
    if (fullText !== lastFullTextRef.current) {
      lastFullTextRef.current = fullText;
      textStartTimeRef.current = Date.now();
      setCurrentWindowIndex(0);
    }

    const words = fullText.trim().split(/\s+/);
    const wordsPerWindow = 30;
    const totalWindows = Math.ceil(words.length / wordsPerWindow);
    
    // Use speed from context (milliseconds per word)
    const millisecondsPerWord = textDisplaySpeed;
    const millisecondsPerWindow = wordsPerWindow * millisecondsPerWord;

    const updateWindow = () => {
      if (!textStartTimeRef.current) return;
      
      // For assistant text, don't show until audio is actually playing AND delay period has passed
      if (textRole === 'assistant' && !isAudioPlayingRef.current) {
        setDisplayedText('');
        return;
      }
      
      // Check if we should start showing text (wait for cloud animation to finish)
      // Only apply the display delay for assistant text so user partials aren't hidden
      if (textRole === 'assistant' && audioStartTimeRef.current) {
        const timeSinceAudioStart = Date.now() - audioStartTimeRef.current;
        if (timeSinceAudioStart < textDisplayDelayRef.current) {
          // Still in the delay period - don't show assistant text yet
          setDisplayedText('');
          return;
        }
      }
      
      const elapsed = Date.now() - textStartTimeRef.current;
      const targetWindow = Math.floor(elapsed / millisecondsPerWindow);
      
      if (targetWindow >= totalWindows) {
        // Show last window
        const startIdx = Math.max(0, words.length - wordsPerWindow);
        const windowWords = words.slice(startIdx).join(' ');
        setDisplayedText(windowWords);
        setCurrentWindowIndex(totalWindows - 1);
      } else {
        // Show current window
        const startIdx = targetWindow * wordsPerWindow;
        const endIdx = Math.min(startIdx + wordsPerWindow, words.length);
        const windowWords = words.slice(startIdx, endIdx).join(' ');
        setDisplayedText(windowWords);
        setCurrentWindowIndex(targetWindow);
      }
    };

    updateWindow();
    const interval = setInterval(updateWindow, 100);

    return () => {
      clearInterval(interval);
    };
  }, [fullText]);

  // Update refs when displayedText or textRole changes
  useEffect(() => {
    displayedTextRef.current = displayedText;
    textRoleRef.current = textRole;
  }, [displayedText, textRole]);

  useEffect(() => {
    if (!containerRef.current) return;

    logger.info('[ParticleFX] TextVisualizer mounted - Particle effects system initialized');

    // Scene setup
    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x000000, 50, 200);
    sceneRef.current = scene;

    // Camera setup
    const camera = new THREE.PerspectiveCamera(
      75,
      window.innerWidth / window.innerHeight,
      0.1,
      1000
    );
    camera.position.z = 50;
    cameraRef.current = camera;

    // Renderer setup
    const renderer = new THREE.WebGLRenderer({ 
      antialias: true, 
      alpha: true 
    });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0); // Transparent background
    rendererRef.current = renderer;
    containerRef.current.appendChild(renderer.domElement);

    // Add particle system
    const particleCount = 1000;
    const particlesGeometry = new THREE.BufferGeometry();
    const positions = new Float32Array(particleCount * 3);
    const colors = new Float32Array(particleCount * 3);

    for (let i = 0; i < particleCount * 3; i += 3) {
      positions[i] = (Math.random() - 0.5) * 200;
      positions[i + 1] = (Math.random() - 0.5) * 200;
      positions[i + 2] = (Math.random() - 0.5) * 200;

      const color = new THREE.Color();
      color.setHSL(0.5 + Math.random() * 0.2, 0.7, 0.5);
      colors[i] = color.r;
      colors[i + 1] = color.g;
      colors[i + 2] = color.b;
    }

    particlesGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    particlesGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    // Store original colors AND positions for brightness adjustment and reset (only once)
    particleOriginalColorsRef.current = new Float32Array(colors);
    particleOriginalPositionsRef.current = new Float32Array(positions);

    const particlesMaterial = new THREE.PointsMaterial({
      size: 0.5,
      vertexColors: true,
      transparent: true,
      opacity: 0.6,
      blending: THREE.AdditiveBlending,
    });

    const particles = new THREE.Points(particlesGeometry, particlesMaterial);
    scene.add(particles);
    particlesRef.current = particles;

    // Create simple static smoke planes (like 2015-master)
    const smokeParticles: THREE.Mesh[] = [];
    
    // Load actual sprite-smoke.png from 2015-master
    const textureLoader = new THREE.TextureLoader();
    const smokeTexture = textureLoader.load('/sprite-smoke.png');
    smokeTexture.wrapS = smokeTexture.wrapT = THREE.RepeatWrapping;
    const config = spriteConfigRef.current;
    smokeTexture.repeat.set(1 / config.horizontal, 1 / config.vertical);
    smokeTexture.offset.set(0, 1 - 1 / config.vertical);
    
    // Static smoke layer configuration (like 2015-master)
    const smokeLayers = 5;
    const resize = 1.25
    const smokeData = [
      { positionX: 10.7, positionY: 3.9, positionZ: 17.8, rotationZ: 2.7, scale: 3.9 * resize },
      { positionX: -2.8, positionY: 2.6, positionZ: -11, rotationZ: 0.7, scale: 7.7 * resize },
      { positionX: 13, positionY: 19.5, positionZ: -1.3, rotationZ: 2, scale: 2.7 * resize },
      { positionX: -8, positionY: -5, positionZ: 8, rotationZ: 1.5, scale: 5 * resize },
      { positionX: 5, positionY: -10, positionZ: -5, rotationZ: 3, scale: 4 * resize }
    ];
    
    const frontColor = new THREE.Color('#9d8ca3');
    const backColor = new THREE.Color('#b87a88');
    
    for (let i = 0; i < smokeLayers; i++) {
      const geometry = new THREE.PlaneGeometry(10, 10);
      
      // Use predefined positions or random
      const positionX = smokeData[i]?.positionX ?? (Math.random() - 0.5) * 40;
      const positionY = smokeData[i]?.positionY ?? (Math.random() - 0.5) * 40;
      const positionZ = smokeData[i]?.positionZ ?? (Math.random() - 0.5) * 40;
      const rotationZ = smokeData[i]?.rotationZ ?? Math.random() * Math.PI;
      const scale = smokeData[i]?.scale ?? 1 + Math.random() * 9;
      
      // Front layers use frontColor, back layers use backColor
      const color = positionZ < 0 ? backColor : frontColor;
      
      const material = new THREE.MeshBasicMaterial({
        map: smokeTexture,
        depthWrite: false,
        depthTest: true,
        transparent: true,
        opacity: 0.2,
        color: color
      });
      
      const plane = new THREE.Mesh(geometry, material);
      plane.position.set(positionX, positionY, positionZ);
      plane.rotation.z = rotationZ;
      plane.scale.set(scale, scale, 1);
      
      scene.add(plane);
      smokeParticles.push(plane);
      
      // Store original scale and opacity for animation
      smokeParticlesOriginalDataRef.current.push({
        scale: scale,
        opacity: 0.2
      });
    }

    // Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.3);
    scene.add(ambientLight);

    const pointLight1 = new THREE.PointLight(0x4a90e2, 2, 100);
    pointLight1.position.set(20, 20, 20);
    scene.add(pointLight1);

    const pointLight2 = new THREE.PointLight(0xe24a90, 1.5, 100);
    pointLight2.position.set(-20, -20, 20);
    scene.add(pointLight2);

    const pointLight3 = new THREE.PointLight(0x90e24a, 1, 100);
    pointLight3.position.set(0, 20, -20);
    scene.add(pointLight3);

    // Helper function to create animated smoke sprite sheet (8x8 grid = 64 frames)
    function createSmokeSpriteSheet() {
      const config = spriteConfigRef.current;
      const cellSize = 256;
      const canvas = document.createElement('canvas');
      canvas.width = cellSize * config.horizontal;
      canvas.height = cellSize * config.vertical;
      const ctx = canvas.getContext('2d')!;
      
      // Generate 64 frames of animated smoke
      for (let row = 0; row < config.vertical; row++) {
        for (let col = 0; col < config.horizontal; col++) {
          const frameIndex = row * config.horizontal + col;
          if (frameIndex >= config.total) break;
          
          const x = col * cellSize;
          const y = row * cellSize;
          
          // Each frame has slightly different smoke pattern
          const frameOffset = frameIndex / config.total;
          const turbulence = frameOffset * Math.PI * 2;
          
          // Organic, animated smoke gradient
          const offsetX = Math.cos(turbulence * 1.7) * 30;
          const offsetY = Math.sin(turbulence * 2.3) * 30;
          const gradient = ctx.createRadialGradient(
            x + cellSize/2 + offsetX,
            y + cellSize/2 + offsetY,
            0,
            x + cellSize/2,
            y + cellSize/2,
            cellSize/2
          );
          
          // Density varies per frame for animation effect
          const density = 0.85 + Math.sin(frameOffset * Math.PI * 3) * 0.15;
          gradient.addColorStop(0, `rgba(255, 255, 255, ${density})`);
          gradient.addColorStop(0.1, `rgba(240, 240, 240, ${0.9 * density})`);
          gradient.addColorStop(0.25, `rgba(200, 200, 200, ${0.7 * density})`);
          gradient.addColorStop(0.4, `rgba(150, 150, 150, ${0.5 * density})`);
          gradient.addColorStop(0.6, 'rgba(100, 100, 100, 0.3)');
          gradient.addColorStop(0.8, 'rgba(50, 50, 50, 0.1)');
          gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
          
          ctx.fillStyle = gradient;
          ctx.fillRect(x, y, cellSize, cellSize);
          
          // Add wispy noise variation per frame
          const imageData = ctx.getImageData(x, y, cellSize, cellSize);
          const data = imageData.data;
          for (let i = 0; i < data.length; i += 4) {
            const noise = (Math.random() - 0.5) * 15;
            const wisp = Math.sin((i / 4 + frameOffset * 1000) * 0.1) * 8;
            data[i] = Math.min(255, Math.max(0, data[i] + noise + wisp));
            data[i + 1] = Math.min(255, Math.max(0, data[i + 1] + noise + wisp));
            data[i + 2] = Math.min(255, Math.max(0, data[i + 2] + noise + wisp));
          }
          ctx.putImageData(imageData, x, y);
        }
      }
      
      const texture = new THREE.CanvasTexture(canvas);
      texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
      // Show only one sprite cell at a time
      texture.repeat.set(1 / config.horizontal, 1 / config.vertical);
      // Start at first frame (bottom-left in texture coordinates)
      texture.offset.set(0, 1 - 1 / config.vertical);
      texture.needsUpdate = true;
      return texture;
    }

    // Animation loop
    let time = 0;
    let lastFrameTime = Date.now();
    const animate = () => {
      animationFrameRef.current = requestAnimationFrame(animate);
      time += 0.01;
      
      // Update sprite sheet animation (UV offset)
      const currentTime = Date.now();
      const delta = currentTime - lastFrameTime;
      lastFrameTime = currentTime;
      
      spriteFrameTimeRef.current += delta;
      const config = spriteConfigRef.current;
      
      // Advance frame when duration elapsed
      while (spriteFrameTimeRef.current > config.duration) {
        spriteFrameTimeRef.current -= config.duration;
        spriteCurrentFrameRef.current++;
        
        // Loop back to first frame
        if (spriteCurrentFrameRef.current >= config.total) {
          spriteCurrentFrameRef.current = 0;
        }
        
        // Calculate UV offset for current frame
        const frame = spriteCurrentFrameRef.current;
        const row = Math.floor(frame / config.horizontal);
        const col = frame % config.horizontal;
        
        // Update texture offset (flip Y for proper orientation)
        smokeTexture.offset.x = col / config.horizontal;
        smokeTexture.offset.y = 1 - (row + 1) / config.vertical;
        smokeTexture.needsUpdate = true;
      }

      // Get audio data
      const audioData = waveformData;
      let audioAverage = 0;
      let audioMax = 0;

      if (audioData && audioData.length > 0) {
        const sum = audioData.reduce((acc, val) => acc + Math.abs(val), 0);
        audioAverage = sum / audioData.length;
        audioMax = Math.max(...Array.from(audioData).map(Math.abs));
      }

      // Animate particles
      if (particlesRef.current) {
        particlesRef.current.rotation.y += 0.0005;
        particlesRef.current.rotation.x += 0.0003;

        const positionArray = particlesRef.current.geometry.attributes.position.array as Float32Array;
        const colorArray = particlesRef.current.geometry.attributes.color.array as Float32Array;
        const particleCount = positionArray.length / 3;
        
        // Create working copies for animation
        // IMPORTANT: Start from original positions to prevent cumulative drift from effects
        const positions = particleOriginalPositionsRef.current 
          ? new Float32Array(particleOriginalPositionsRef.current)
          : new Float32Array(positionArray);
        
        // Start with original colors and apply brightness FIRST
        let colors: Float32Array;
        if (particleOriginalColorsRef.current) {
          const originalColors = particleOriginalColorsRef.current;
          colors = new Float32Array(originalColors.length);
          
          // Smooth the brightness
          const targetBrightness = particleBrightnessRef.current;
          const smoothingFactor = 0.15;
          smoothedBrightnessRef.current += (targetBrightness - smoothedBrightnessRef.current) * smoothingFactor;
          const currentBrightness = smoothedBrightnessRef.current;
          const brightnessFactor = 0.15 + currentBrightness * 1.01;
          
          for (let i = 0; i < colors.length; i += 3) {
            colors[i] = Math.min(1, originalColors[i] * brightnessFactor);
            colors[i + 1] = Math.min(1, originalColors[i + 1] * brightnessFactor);
            colors[i + 2] = Math.min(1, originalColors[i + 2] * brightnessFactor);
          }
          
          // Update opacity and size based on brightness
          const material = particlesRef.current.material as THREE.PointsMaterial;
          const baseOpacity = 0.6;
          const baseSize = 0.5;
          material.opacity = baseOpacity + currentBrightness * 0.7;
          material.size = baseSize + currentBrightness * 0.4;
        } else {
          colors = new Float32Array(colorArray);
        }
        
        // Apply base animation
        for (let i = 0; i < positions.length; i += 3) {
          const audioInfluence = audioData && i / 3 < audioData.length 
            ? Math.abs(audioData[i / 3]) * 5 
            : 0;
          
          positions[i + 1] += Math.sin(time + i) * 0.01 + audioInfluence * 0.05;
          
          // Note: Removed wrapping to allow particle effects to expand/contract particles naturally
        }

        // Apply particle effects based on audio effects (only when audio is playing)
        let effectsResult: any;
        if (isAudioPlayingRef.current) {
          const deltaSeconds = delta / 1000; // Convert delta from ms to seconds
          effectsResult = ParticleFX.applyAllParticleEffects(
            positions,
            colors,
            time,
            particleCount,
            deltaSeconds
          );
        } else {
          // When audio is not playing, use unmodified positions and colors
          effectsResult = {
            positions: new Float32Array(positions),
            colors: new Float32Array(colors),
            delayedParticles: [],
            chorusParticles: []
          };
        }

        // Debug: Log if any effects are active
        const activeEffects = ParticleFX.getParticleEffectState();
        const effectKeys = Object.keys(activeEffects).sort().join(',');
        if (effectKeys !== lastLoggedEffectsRef.current) {
          if (effectKeys) {
            logger.debug('[ParticleFX] ✓ Effects detected and ACTIVE:', effectKeys);
          } else {
            logger.debug('[ParticleFX] No effects currently active');
          }
          lastLoggedEffectsRef.current = effectKeys;
        }

        // Copy processed positions and colors back to the geometry
        for (let i = 0; i < positionArray.length; i++) {
          positionArray[i] = effectsResult.positions[i];
          colorArray[i] = effectsResult.colors[i];
        }
        
        particlesRef.current.geometry.attributes.position.needsUpdate = true;
        particlesRef.current.geometry.attributes.color.needsUpdate = true;

        // Update delayed particles if delay effect is active
        if (effectsResult.delayedParticles && effectsResult.delayedParticles.length > 0) {
          // Ensure we have enough particle meshes for delayed copies
          while (delayedParticlesRef.current.length < effectsResult.delayedParticles.length) {
            const delayGeometry = new THREE.BufferGeometry();
            const delayMaterial = new THREE.PointsMaterial({
              size: 0.5,
              vertexColors: true,
              transparent: true,
              opacity: 0.4,
              blending: THREE.AdditiveBlending,
            });
            const delayParticles = new THREE.Points(delayGeometry, delayMaterial);
            sceneRef.current?.add(delayParticles);
            delayedParticlesRef.current.push(delayParticles);
          }

          // Update each delayed particle mesh
          effectsResult.delayedParticles.forEach((delayed: any, idx: number) => {
            const delayMesh = delayedParticlesRef.current[idx];
            delayMesh.visible = true; // Make sure it's visible when effect is active
            if (delayMesh.geometry.attributes.position === undefined) {
              delayMesh.geometry.setAttribute('position', new THREE.BufferAttribute(delayed.positions, 3));
              delayMesh.geometry.setAttribute('color', new THREE.BufferAttribute(delayed.colors, 3));
            } else {
              const posAttr = delayMesh.geometry.attributes.position as THREE.BufferAttribute;
              const colAttr = delayMesh.geometry.attributes.color as THREE.BufferAttribute;
              if (posAttr.array.length === delayed.positions.length) {
                for (let i = 0; i < delayed.positions.length; i++) {
                  (posAttr.array as Float32Array)[i] = delayed.positions[i];
                  (colAttr.array as Float32Array)[i] = delayed.colors[i];
                }
                posAttr.needsUpdate = true;
                colAttr.needsUpdate = true;
              }
            }
          });

          // Hide extra delayed particles
          for (let i = effectsResult.delayedParticles.length; i < delayedParticlesRef.current.length; i++) {
            delayedParticlesRef.current[i].visible = false;
          }
        } else {
          // Hide all delayed particles if no delay effect
          delayedParticlesRef.current.forEach((p) => (p.visible = false));
        }

        // Update chorus particles if chorus effect is active
        if (effectsResult.chorusParticles && effectsResult.chorusParticles.length > 0) {
          // Ensure we have enough particle meshes for chorus copies
          while (chorusParticlesRef.current.length < effectsResult.chorusParticles.length) {
            const chorusGeometry = new THREE.BufferGeometry();
            const chorusMaterial = new THREE.PointsMaterial({
              size: 0.5,
              vertexColors: true,
              transparent: true,
              opacity: 0.35,
              blending: THREE.AdditiveBlending,
            });
            const chorusParticles = new THREE.Points(chorusGeometry, chorusMaterial);
            sceneRef.current?.add(chorusParticles);
            chorusParticlesRef.current.push(chorusParticles);
          }

          // Update each chorus particle mesh
          effectsResult.chorusParticles.forEach((chorus: any, idx: number) => {
            const chorusMesh = chorusParticlesRef.current[idx];
            chorusMesh.visible = true; // Make sure it's visible when effect is active
            if (chorusMesh.geometry.attributes.position === undefined) {
              chorusMesh.geometry.setAttribute('position', new THREE.BufferAttribute(chorus.positions, 3));
              chorusMesh.geometry.setAttribute('color', new THREE.BufferAttribute(chorus.colors, 3));
            } else {
              const posAttr = chorusMesh.geometry.attributes.position as THREE.BufferAttribute;
              const colAttr = chorusMesh.geometry.attributes.color as THREE.BufferAttribute;
              if (posAttr.array.length === chorus.positions.length) {
                for (let i = 0; i < chorus.positions.length; i++) {
                  (posAttr.array as Float32Array)[i] = chorus.positions[i];
                  (colAttr.array as Float32Array)[i] = chorus.colors[i];
                }
                posAttr.needsUpdate = true;
                colAttr.needsUpdate = true;
              }
            }
          });

          // Hide extra chorus particles
          for (let i = effectsResult.chorusParticles.length; i < chorusParticlesRef.current.length; i++) {
            chorusParticlesRef.current[i].visible = false;
          }
        } else {
          // Hide all chorus particles if no chorus effect
          chorusParticlesRef.current.forEach((p) => (p.visible = false));
        }

        // Apply brightness to particle colors (use ref updated directly from BroadcastChannel)
        // Smooth the brightness to avoid jittery/glitchy appearance
        // (Brightness is now applied before particle effects - see above)
      }

      // Animate smoke planes: expand and fade out when audio plays, reverse when audio stops
      if (isAudioPlayingRef.current && !wasAudioPlayingRef.current) {
        // Audio just started - begin expand animation
        smokeAnimationTimeRef.current = 0;
        wasAudioPlayingRef.current = true;
      } else if (!isAudioPlayingRef.current && wasAudioPlayingRef.current) {
        // Audio just stopped - begin contract animation
        smokeAnimationTimeRef.current = 0;
        wasAudioPlayingRef.current = false;
      }

      // Update smoke animation progress
      if (isAudioPlayingRef.current || (!isAudioPlayingRef.current && smokeAnimationTimeRef.current < smokeAnimationDurationRef.current)) {
        smokeAnimationTimeRef.current += delta / 1000; // Convert to seconds
        const animationProgress = Math.min(smokeAnimationTimeRef.current / smokeAnimationDurationRef.current, 1);
        
        // Apply easing function for smooth animation (ease-in-out cubic)
        const easeProgress = animationProgress < 0.5
          ? 4 * animationProgress * animationProgress * animationProgress
          : 1 - Math.pow(-2 * animationProgress + 2, 3) / 2;
        
        smokeParticles.forEach((plane, idx) => {
          const originalData = smokeParticlesOriginalDataRef.current[idx];
          if (!originalData) return;
          
          if (isAudioPlayingRef.current) {
            // Expand and fade out
            const expandScale = 1 + easeProgress * 3; // Scale up to 4x
            const fadeOpacity = originalData.opacity * (1 - easeProgress);
            
            plane.scale.set(
              originalData.scale * expandScale,
              originalData.scale * expandScale,
              1
            );
            (plane.material as THREE.MeshBasicMaterial).opacity = fadeOpacity;
          } else {
            // Contract and fade in (reverse animation)
            const contractScale = 1 + (1 - easeProgress) * 3; // Scale from 4x back to 1x
            const fadeOpacity = originalData.opacity * easeProgress; // Fade in as it contracts
            
            plane.scale.set(
              originalData.scale * contractScale,
              originalData.scale * contractScale,
              1
            );
            (plane.material as THREE.MeshBasicMaterial).opacity = fadeOpacity;
          }
          (plane.material as THREE.MeshBasicMaterial).needsUpdate = true;
        });
      }

      // Animate lights
      pointLight1.intensity = 2 + audioMax * 2;
      pointLight2.intensity = 1.5 + audioAverage * 3;
      pointLight3.intensity = 1 + Math.sin(time) * 0.5 + audioMax;

      // Camera movement
      camera.position.x = Math.sin(time * 0.1) * 5;
      camera.position.y = Math.cos(time * 0.15) * 5;
      camera.lookAt(0, 0, 0);

      renderer.render(scene, camera);
    };

    animate();

    // Handle window resize
    const handleResize = () => {
      if (!cameraRef.current || !rendererRef.current) return;
      
      cameraRef.current.aspect = window.innerWidth / window.innerHeight;
      cameraRef.current.updateProjectionMatrix();
      rendererRef.current.setSize(window.innerWidth, window.innerHeight);
    };

    window.addEventListener('resize', handleResize);

    // Cleanup
    return () => {
      window.removeEventListener('resize', handleResize);
      
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      
      // Dispose of delayed particles
      delayedParticlesRef.current.forEach((particles) => {
        particles.geometry.dispose();
        if (particles.material instanceof THREE.Material) {
          particles.material.dispose();
        }
      });
      delayedParticlesRef.current = [];

      // Dispose of chorus particles
      chorusParticlesRef.current.forEach((particles) => {
        particles.geometry.dispose();
        if (particles.material instanceof THREE.Material) {
          particles.material.dispose();
        }
      });
      chorusParticlesRef.current = [];
      
      if (rendererRef.current && containerRef.current) {
        containerRef.current.removeChild(rendererRef.current.domElement);
        rendererRef.current.dispose();
      }
      
      if (sceneRef.current) {
        sceneRef.current.traverse((object) => {
          if (object instanceof THREE.Mesh) {
            object.geometry.dispose();
            if (object.material instanceof THREE.Material) {
              object.material.dispose();
            }
          }
        });
      }
    };
  }, [waveformData]);

  return (
    <div className="fixed inset-0 bg-black text-white flex items-center justify-center overflow-hidden">
      <style>{`
        @keyframes dotPulse {
          0%, 20% { opacity: 0.4; }
          50% { opacity: 1; }
          100% { opacity: 0.4; }
        }
        .dot {
          display: inline-block;
          animation: dotPulse 1.4s infinite;
        }
        .dot:nth-child(1) { animation-delay: 0s; }
        .dot:nth-child(2) { animation-delay: 0.2s; }
        .dot:nth-child(3) { animation-delay: 0.4s; }
      `}</style>
      
      {/* Text layer - behind canvas */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-0">
        {displayedText && (
          <div className="text-center max-w-6xl">
            <div className={`text-sm uppercase tracking-wider mb-4 ${
              textRole === 'user' ? 'text-blue-400' : 'text-green-400'
            }`}>
              {textRole === 'user' ? 'USER' : 'NOCTURNE AI'}
            </div>
            <p 
              className="leading-relaxed"
              style={{
                fontSize: '40px',
                fontFamily: 'Lexend-Medium, Arial, sans-serif',
                fontWeight: 'normal',
                lineHeight: '1.8'
              }}
            >
              {displayedText}
            </p>
          </div>
        )}
        {!displayedText && !isAudioPlaying && !currentUserText && !currentAssistantText && (
          <p 
            className="text-white text-center drop-shadow-[0_0_20px_rgba(74,144,226,0.5)]"
            style={{
              fontSize: '40px',
              fontFamily: 'Lexend-Medium, Arial, sans-serif'
            }}
          >
            Nocturne AI 
            <span className="dot mx-1">.</span>
            <span className="dot mx-1">.</span>
            <span className="dot mx-1">.</span>
          </p>
        )}
      </div>
      
      {/* Three.js canvas layer - on top */}
      <div ref={containerRef} className="absolute inset-0 z-10" />
    </div>
  );
}
