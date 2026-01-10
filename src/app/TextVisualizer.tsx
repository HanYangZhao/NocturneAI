"use client";

import React, { useRef, useEffect, useState } from 'react';
import { useTranscript } from './TranscriptContext';
import * as THREE from 'three';

export default function TextVisualizer() {
  const { currentUserText, currentAssistantText, waveformData, textDisplaySpeed } = useTranscript();
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const particlesRef = useRef<THREE.Points | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const [displayedText, setDisplayedText] = useState('');
  const [currentWindowIndex, setCurrentWindowIndex] = useState(0);
  const textStartTimeRef = useRef<number | null>(null);
  const lastFullTextRef = useRef<string>('');

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

    // Create smoke clouds
    const smokeParticles: THREE.Mesh[] = [];
    const smokeGeometry = new THREE.PlaneGeometry(120, 120);
    const smokeTexture = createSmokeTexture();
    
    for (let i = 0; i < 18; i++) {
      const smokeMaterial = new THREE.MeshBasicMaterial({
        map: smokeTexture,
        transparent: true,
        opacity: 0.45 + Math.random() * 0.2,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      
      const smokeParticle = new THREE.Mesh(smokeGeometry, smokeMaterial);
      
      // Vary initial scale for more organic look
      const initialScale = 0.7 + Math.random() * 0.6;
      smokeParticle.scale.set(initialScale, initialScale, initialScale);
      
      smokeParticle.position.set(
        Math.random() * 120 - 60,
        Math.random() * 120 - 60,
        Math.random() * 60 - 110
      );
      smokeParticle.rotation.z = Math.random() * Math.PI * 2;
      
      // Store initial properties for variation
      (smokeParticle as any).speed = 0.4 + Math.random() * 0.3;
      (smokeParticle as any).rotationSpeed = 0.003 + Math.random() * 0.008;
      (smokeParticle as any).turbulencePhase = Math.random() * Math.PI * 2;
      
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

    // Helper function to create smoke texture
    function createSmokeTexture() {
      const canvas = document.createElement('canvas');
      canvas.width = 256;
      canvas.height = 256;
      const ctx = canvas.getContext('2d')!;
      
      // Create softer, more organic gradient
      const gradient = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
      gradient.addColorStop(0, 'rgba(70, 70, 70, 1)');
      gradient.addColorStop(0.1, 'rgba(55, 55, 55, 0.95)');
      gradient.addColorStop(0.25, 'rgba(40, 40, 40, 0.85)');
      gradient.addColorStop(0.4, 'rgba(25, 25, 25, 0.65)');
      gradient.addColorStop(0.6, 'rgba(15, 15, 15, 0.35)');
      gradient.addColorStop(0.8, 'rgba(8, 8, 8, 0.15)');
      gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
      
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, 256, 256);
      
      // Add some noise for organic texture
      const imageData = ctx.getImageData(0, 0, 256, 256);
      const data = imageData.data;
      for (let i = 0; i < data.length; i += 4) {
        const noise = (Math.random() - 0.5) * 20;
        data[i] += noise;     // R
        data[i + 1] += noise; // G
        data[i + 2] += noise; // B
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

        // Audio-reactive particle size
        const material = particlesRef.current.material as THREE.PointsMaterial;
        material.size = 0.5 + audioMax * 1.5;
      }

      // Animate smoke particles
      smokeParticles.forEach((smoke, i) => {
        const speed = (smoke as any).speed || 0.5;
        const rotSpeed = (smoke as any).rotationSpeed || 0.005;
        const turbPhase = (smoke as any).turbulencePhase || 0;
        
        // Varied rotation speeds for organic swirling
        smoke.rotation.z += rotSpeed;
        
        // Layered turbulent motion with multiple sine waves
        const turbulence1 = Math.sin(time * 0.8 + turbPhase + i) * 0.5;
        const turbulence2 = Math.cos(time * 0.6 + turbPhase * 1.5) * 0.35;
        const turbulence3 = Math.sin(time * 1.2 + i * 0.3) * 0.25;
        
        // Rising motion with varied speeds and gentle swaying
        smoke.position.y += speed + turbulence1 * 0.3;
        smoke.position.x += turbulence1 + turbulence2 + Math.cos(time * 0.4 + i * 0.7) * 0.3;
        smoke.position.z += turbulence3 * 0.2 + Math.sin(time * 0.3 + i) * 0.15;
        
        // Reset smoke that drifts too high with varied positions
        if (smoke.position.y > 120) {
          smoke.position.y = -60 - Math.random() * 20;
          smoke.position.x = Math.random() * 120 - 60;
          smoke.position.z = Math.random() * 60 - 110;
          smoke.rotation.z = Math.random() * Math.PI * 2;
        }
        
        // Dynamic opacity with layered variation
        const material = smoke.material as THREE.MeshBasicMaterial;
        const baseOpacity = 0.35 + Math.sin(time * 0.5 + i * 0.7) * 0.15;
        const audioOpacity = audioAverage * 0.4;
        const depthFade = 1 - Math.abs(smoke.position.z) / 150; // Fade based on depth
        material.opacity = (baseOpacity + audioOpacity) * depthFade;
        
        // Organic pulsing scale with audio reactivity
        const breathe = Math.sin(time * 0.6 + i * 0.5) * 0.15;
        const pulse = Math.cos(time * 0.9 + i * 0.3) * 0.1;
        const scale = 1 + breathe + pulse + audioMax * 0.25;
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
            className="text-gray-400 text-center drop-shadow-[0_0_20px_rgba(74,144,226,0.5)]"
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
