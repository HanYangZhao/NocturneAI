"use client";

import React, { useRef, useEffect, useState } from 'react';
import { useTranscript } from './TranscriptContext';
import * as THREE from 'three';

export default function TextVisualizer() {
  const { currentUserText, currentAssistantText, waveformData, textDisplaySpeed, particleBrightness } = useTranscript();
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const particlesRef = useRef<THREE.Points | null>(null);
  const particleOriginalColorsRef = useRef<Float32Array | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const particleBrightnessRef = useRef<number>(0);
  const smoothedBrightnessRef = useRef<number>(0); // Smoothed value for rendering
  const [displayedText, setDisplayedText] = useState('');
  const [currentWindowIndex, setCurrentWindowIndex] = useState(0);
  const textStartTimeRef = useRef<number | null>(null);
  const lastFullTextRef = useRef<string>('');

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
    const wordsPerWindow = 25;
    const totalWindows = Math.ceil(words.length / wordsPerWindow);
    
    // Use speed from context (milliseconds per word)
    const millisecondsPerWord = textDisplaySpeed;
    const millisecondsPerWindow = wordsPerWindow * millisecondsPerWord;

    const updateWindow = () => {
      if (!textStartTimeRef.current) return;
      
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

  useEffect(() => {
    if (!containerRef.current) return;

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
    renderer.setClearColor(0x000000, 1);
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

    // Store original colors for brightness adjustment (only once)
    particleOriginalColorsRef.current = new Float32Array(colors);

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

    // Create volumetric tornado/fire vortex effect (side view of glass container)
    const smokeParticles: THREE.Mesh[] = [];
    const smokeTexture = createSmokeTexture();
    
    // Vortex container parameters
    const vortexBaseRadius = 75;  // Radius at the bottom (wider)
    const vortexTopRadius = 30;   // Radius at the top (tighter funnel)
    const vortexHeight = 140;
    const totalParticles = 65;
    
    // Light source position (bottom right)
    const lightPos = new THREE.Vector3(60, -50, 30);
    
    for (let i = 0; i < totalParticles; i++) {
      // Varied geometry sizes - larger for more volumetric look
      const geoSize = 65 + Math.random() * 55;
      const smokeGeometry = new THREE.PlaneGeometry(geoSize, geoSize);
      
      const smokeMaterial = new THREE.MeshBasicMaterial({
        map: smokeTexture,
        transparent: true,
        opacity: 0.2 + Math.random() * 0.15,
        depthWrite: false,
        blending: THREE.NormalBlending,
        side: THREE.DoubleSide,
        color: new THREE.Color(0.15, 0.15, 0.15), // Base dark gray
      });
      
      const smokeParticle = new THREE.Mesh(smokeGeometry, smokeMaterial);
      
      // Distribute particles throughout the vortex height
      const heightRatio = Math.random(); // 0 = bottom, 1 = top
      const y = (heightRatio - 0.5) * vortexHeight;
      
      // Radius varies with height (tornado funnel shape)
      const radiusAtHeight = vortexBaseRadius - (vortexBaseRadius - vortexTopRadius) * heightRatio;
      const angle = Math.random() * Math.PI * 2;
      const radius = radiusAtHeight * (0.4 + Math.random() * 0.6);
      
      const initialScale = 0.5 + Math.random() * 0.5;
      smokeParticle.scale.set(initialScale, initialScale, initialScale);
      
      // Position in cylindrical coordinates, offset back for side view
      smokeParticle.position.set(
        Math.cos(angle) * radius,
        y,
        -70 + Math.sin(angle) * radius * 0.6  // Compress Z for side view
      );
      smokeParticle.rotation.z = Math.random() * Math.PI * 2;
      
      // Store properties for tornado vortex animation
      (smokeParticle as any).orbitAngle = angle;
      (smokeParticle as any).baseRadius = radius;
      (smokeParticle as any).heightRatio = heightRatio;
      // Faster spin at top (like a tornado), slower at bottom
      (smokeParticle as any).orbitSpeed = 0.8 + heightRatio * 1.5 + Math.random() * 0.4;
      // Upward velocity increases toward center
      (smokeParticle as any).riseSpeed = 0.4 + (1 - radius / vortexBaseRadius) * 0.8 + Math.random() * 0.3;
      (smokeParticle as any).rotationSpeed = 0.01 + Math.random() * 0.015;
      (smokeParticle as any).turbulencePhase = Math.random() * Math.PI * 2;
      (smokeParticle as any).baseOpacity = 0.25 + Math.random() * 0.15;
      (smokeParticle as any).flickerPhase = Math.random() * Math.PI * 2;
      
      scene.add(smokeParticle);
      smokeParticles.push(smokeParticle);
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

    // Helper function to create smoke texture with soft edges for volumetric lighting
    function createSmokeTexture() {
      const canvas = document.createElement('canvas');
      canvas.width = 256;
      canvas.height = 256;
      const ctx = canvas.getContext('2d')!;
      
      // Create very soft, cloud-like gradient for better lighting
      const gradient = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
      gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
      gradient.addColorStop(0.1, 'rgba(240, 240, 240, 0.9)');
      gradient.addColorStop(0.25, 'rgba(200, 200, 200, 0.7)');
      gradient.addColorStop(0.4, 'rgba(150, 150, 150, 0.5)');
      gradient.addColorStop(0.6, 'rgba(100, 100, 100, 0.3)');
      gradient.addColorStop(0.8, 'rgba(50, 50, 50, 0.1)');
      gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
      
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, 256, 256);
      
      // Add subtle noise for organic texture
      const imageData = ctx.getImageData(0, 0, 256, 256);
      const data = imageData.data;
      for (let i = 0; i < data.length; i += 4) {
        const noise = (Math.random() - 0.5) * 15;
        data[i] = Math.min(255, Math.max(0, data[i] + noise));     // R
        data[i + 1] = Math.min(255, Math.max(0, data[i + 1] + noise)); // G
        data[i + 2] = Math.min(255, Math.max(0, data[i + 2] + noise)); // B
      }
      ctx.putImageData(imageData, 0, 0);
      
      const texture = new THREE.CanvasTexture(canvas);
      texture.needsUpdate = true;
      return texture;
    }

    // Animation loop
    let time = 0;
    const animate = () => {
      animationFrameRef.current = requestAnimationFrame(animate);
      time += 0.01;

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

        const positions = particlesRef.current.geometry.attributes.position.array as Float32Array;
        const colors = particlesRef.current.geometry.attributes.color.array as Float32Array;
        
        for (let i = 0; i < positions.length; i += 3) {
          const audioInfluence = audioData && i / 3 < audioData.length 
            ? Math.abs(audioData[i / 3]) * 5 
            : 0;
          
          positions[i + 1] += Math.sin(time + i) * 0.02 + audioInfluence * 0.1;
          
          // Wrap around
          if (positions[i + 1] > 100) positions[i + 1] = -100;
          if (positions[i + 1] < -100) positions[i + 1] = 100;
        }
        
        particlesRef.current.geometry.attributes.position.needsUpdate = true;

        // Apply brightness to particle colors (use ref updated directly from BroadcastChannel)
        // Smooth the brightness to avoid jittery/glitchy appearance
        const targetBrightness = particleBrightnessRef.current;
        const smoothingFactor = 0.15; // Lower = smoother but slower response
        smoothedBrightnessRef.current += (targetBrightness - smoothedBrightnessRef.current) * smoothingFactor;
        const currentBrightness = smoothedBrightnessRef.current;
        
        if (particleOriginalColorsRef.current) {
          const originalColors = particleOriginalColorsRef.current;
          // Brightness effect: base 1.0 + up to 1.25x boost based on audio
          const brightnessFactor = 0.5 + currentBrightness * 1.1;
          
          for (let i = 0; i < colors.length; i += 3) {
            // Get original color and apply brightness amplification
            colors[i] = Math.min(1, originalColors[i] * brightnessFactor);
            colors[i + 1] = Math.min(1, originalColors[i + 1] * brightnessFactor);
            colors[i + 2] = Math.min(1, originalColors[i + 2] * brightnessFactor);
          }
          
          // Smoothly interpolate opacity and size based on brightness
          const material = particlesRef.current.material as THREE.PointsMaterial;
          const baseOpacity = 0.6;
          const baseSize = 0.5;
          material.opacity = baseOpacity + currentBrightness * 0.7;
          material.size = baseSize + currentBrightness * 0.4;
          
          particlesRef.current.geometry.attributes.color.needsUpdate = true;
        }
      }

      // Animate smoke particles as tornado/fire vortex with volumetric lighting
      smokeParticles.forEach((smoke, i) => {
        const orbitSpeed = (smoke as any).orbitSpeed || 1.0;
        const riseSpeed = (smoke as any).riseSpeed || 0.5;
        const rotSpeed = (smoke as any).rotationSpeed || 0.01;
        const turbPhase = (smoke as any).turbulencePhase || 0;
        const baseOpacity = (smoke as any).baseOpacity || 0.3;
        const flickerPhase = (smoke as any).flickerPhase || 0;
        let heightRatio = (smoke as any).heightRatio || 0.5;
        
        // Update orbital angle - faster spin creates tornado effect
        (smoke as any).orbitAngle += orbitSpeed * 0.02;
        const angle = (smoke as any).orbitAngle;
        
        // Update height ratio as particle rises
        heightRatio += riseSpeed * 0.003;
        (smoke as any).heightRatio = heightRatio;
        
        // Calculate current Y position and radius based on height
        const y = (heightRatio - 0.5) * vortexHeight;
        
        // Tornado funnel: tighter at top, wider at bottom
        const radiusAtHeight = vortexBaseRadius - (vortexBaseRadius - vortexTopRadius) * Math.min(heightRatio, 1);
        const baseRadius = (smoke as any).baseRadius;
        const radiusRatio = baseRadius / vortexBaseRadius;
        const currentRadius = radiusAtHeight * radiusRatio;
        
        // Highly turbulent fire-like motion - chaotic but mainly upward
        const turbIntensity = 1 - heightRatio * 0.3; // More turbulence at bottom
        const fireTurbX = (
          Math.sin(time * 3.5 + turbPhase + i * 0.3) * 8 +
          Math.sin(time * 5.2 + turbPhase * 2.1 + i * 0.7) * 5 +
          Math.cos(time * 7.0 + i * 1.2) * 3
        ) * turbIntensity;
        const fireTurbY = (
          Math.sin(time * 4.0 + turbPhase * 1.3) * 4 +
          Math.cos(time * 6.5 + i * 0.9) * 2
        ) * 0.5; // Less vertical turbulence to keep upward direction
        const fireTurbZ = (
          Math.cos(time * 3.0 + i * 0.5) * 6 +
          Math.sin(time * 5.8 + turbPhase * 0.7) * 4 +
          Math.cos(time * 8.0 + i * 1.5) * 2
        ) * turbIntensity;
        
        // Swirling vortex position with enhanced turbulence
        smoke.position.x = Math.cos(angle) * currentRadius + fireTurbX;
        smoke.position.y = y + fireTurbY;
        smoke.position.z = -70 + Math.sin(angle) * currentRadius * 0.6 + fireTurbZ;
        
        // More chaotic self-rotation for turbulent swirling texture
        smoke.rotation.z += rotSpeed + Math.sin(time * 3.5 + i) * 0.01 + Math.cos(time * 5 + turbPhase) * 0.005;
        
        // Reset particle when it reaches the top - respawn at bottom
        if (heightRatio > 1.1) {
          (smoke as any).heightRatio = -0.1 + Math.random() * 0.1;
          (smoke as any).orbitAngle = Math.random() * Math.PI * 2;
          (smoke as any).baseRadius = vortexBaseRadius * (0.4 + Math.random() * 0.6);
          // Randomize speeds slightly on respawn for variation
          (smoke as any).orbitSpeed = 0.8 + Math.random() * 1.5;
          (smoke as any).riseSpeed = 0.5 + Math.random() * 0.9;
        }
        
        // Calculate lighting from bottom-right light source
        const material = smoke.material as THREE.MeshBasicMaterial;
        
        // Vector from smoke to light (bottom right at x:60, y:-50, z:30)
        const toLight = new THREE.Vector3(
          lightPos.x - smoke.position.x,
          lightPos.y - smoke.position.y,
          lightPos.z - smoke.position.z
        );
        const distToLight = toLight.length();
        toLight.normalize();
        
        // Simulate light intensity based on position (facing the light = brighter)
        // Particles on the right side and bottom get more light
        const lightFacing = (smoke.position.x + 60) / 120; // 0 to 1, right side brighter
        const bottomBias = (1 - (smoke.position.y + 70) / 140); // Bottom is brighter
        const depthFactor = 1 - Math.abs(smoke.position.z + 70) / 50; // Front particles catch more light
        
        // Combined lighting intensity
        const lightIntensity = Math.max(0.1, Math.min(1, 
          lightFacing * 0.5 + bottomBias * 0.3 + depthFactor * 0.3
        ));
        
        // Falloff based on distance from light
        const lightFalloff = Math.max(0.2, 1 - distToLight / 180);
        
        // Apply color based on lighting - brighter areas are lighter gray/white
        const litColor = 0.1 + lightIntensity * lightFalloff * 0.5;
        const shadowColor = 0.05;
        const finalColor = shadowColor + (litColor - shadowColor) * lightIntensity;
        material.color.setRGB(finalColor, finalColor, finalColor * 0.95); // Slightly warm tint
        
        // Opacity with volumetric depth
        const centerBrightness = 1 - (radiusRatio * 0.3);
        const verticalFade = heightRatio < 0.2 ? heightRatio * 5 : (heightRatio > 0.8 ? (1 - heightRatio) * 5 : 1);
        const flicker = 0.9 + Math.sin(time * 4 + flickerPhase + i * 2) * 0.1; // Subtle flicker
        const audioBoost = audioAverage * 0.3 + audioMax * 0.2;
        
        material.opacity = Math.max(0.08, Math.min(0.5, 
          (baseOpacity + audioBoost) * centerBrightness * verticalFade * flicker * (0.8 + lightIntensity * 0.4)
        ));
        
        // Scale varies with height (larger at bottom, smaller wisps at top)
        const heightScale = 1.2 - heightRatio * 0.5;
        const pulseScale = 1 + Math.sin(time * 1.5 + i * 0.4) * 0.1;
        const audioScale = 1 + audioMax * 0.25;
        const scale = heightScale * pulseScale * audioScale;
        smoke.scale.set(scale, scale, scale);
      });

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
      <div ref={containerRef} className="absolute inset-0" />
      
      <div className="relative z-10 w-full px-8 pointer-events-none">
        {displayedText && (
          <div className="text-center">
            <div className={`text-sm uppercase tracking-wider mb-4 ${
              textRole === 'user' ? 'text-blue-400' : 'text-green-400'
            }`}>
              {textRole === 'user' ? 'USER' : 'NOCTURNE AI'}
            </div>
            <p 
              className="leading-tight"
              style={{
                fontSize: '36px',
                fontFamily: 'Lexend-Medium, Arial, sans-serif',
                fontWeight: 'normal',
                display: 'flex',
                flexWrap: 'wrap',
                justifyContent: 'center',
                gap: '8px'
              }}
            >
              {displayedText.split(/\s+/).map((word, index) => (
                <span
                  key={`${word}-${index}-${currentWindowIndex}`}
                  style={{
                    display: 'inline-block',
                    animation: 'glitchIn 0.4s ease-out forwards',
                    animationDelay: `${index * 50}ms`,
                    opacity: 0
                  }}
                >
                  {word}
                </span>
              ))}
            </p>
          </div>
        )}
        {!displayedText && (
          <p 
            className="text-white text-center drop-shadow-[0_0_20px_rgba(74,144,226,0.5)]"
            style={{
              fontSize: '36px',
              fontFamily: 'Lexend-Medium, Arial, sans-serif'
            }}
          >
            Waiting for conversation...
          </p>
        )}
      </div>
    </div>
  );
}
