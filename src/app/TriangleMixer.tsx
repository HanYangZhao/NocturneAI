"use client";

import React, { useRef, useState, useEffect } from "react";

interface TriangleMixerProps {
  voices: Array<{ 
    id: string; 
    name: string; 
    enabled: boolean;
    elevenLabsVoiceId?: string;
  }>;
  onMixChange: (mix: { [voiceId: string]: number }) => void;
  onToggleVoice?: (voiceId: string) => void;
  isAudioPlaying?: boolean;
}

/**
 * Circular multi-voice mixer with 2D control
 * Place a dot in the circle to control the mix of all enabled voices
 * Center = equal mix, edges favor individual voices
 */
export default function TriangleMixer({ voices, onMixChange, onToggleVoice, isAudioPlaying }: TriangleMixerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [position, setPosition] = useState({ x: 0.5, y: 0.5 }); // Normalized 0-1
  const [isAnimating, setIsAnimating] = useState(false);
  const [rotationDuration, setRotationDuration] = useState(10); // seconds for full rotation
  const animationStartTime = useRef<number>(0);
  const animationFrameId = useRef<number | null>(null);
  
  const size = 220;
  const radius = size / 2;
  const center = { x: radius, y: radius };

  // Calculate voice volumes based on position using barycentric-like coordinates
  const calculateMix = (x: number, y: number): { [key: string]: number } => {
    const enabledVoices = voices.filter(v => v.enabled && v.elevenLabsVoiceId);
    const numVoices = enabledVoices.length;
    
    if (numVoices === 0) return {};
    if (numVoices === 1) return { [enabledVoices[0].id]: 1.0 };
    
    // Convert normalized coordinates to centered coordinates (-1 to 1)
    const cx = (x - 0.5) * 2;
    const cy = (y - 0.5) * 2;
    
    // Calculate distance from center
    const distance = Math.sqrt(cx * cx + cy * cy);
    
    // Calculate angle (0 = right, counterclockwise)
    let angle = Math.atan2(cy, cx);
    if (angle < 0) angle += 2 * Math.PI;
    
    // Position voices evenly around the circle
    const voiceAngles = [];
    for (let i = 0; i < numVoices; i++) {
      voiceAngles.push((i * 2 * Math.PI) / numVoices);
    }
    
    // Calculate angular distance and proximity to each voice
    const proximities = voiceAngles.map(voiceAngle => {
      const angleDiff = Math.min(
        Math.abs(angle - voiceAngle),
        2 * Math.PI - Math.abs(angle - voiceAngle)
      );
      const maxAngleDiff = (2 * Math.PI) / numVoices;
      return Math.max(0, 1 - angleDiff / maxAngleDiff);
    });
    
    // Apply distance factor: center = equal mix, edges = favor one voice
    const distanceFactor = Math.min(distance, 1); // Clamp to circle
    
    // Calculate mix for each voice
    const mixes = proximities.map(proximity => {
      return (1 - distanceFactor) / numVoices + distanceFactor * proximity;
    });
    
    // Normalize to sum to 1
    const total = mixes.reduce((sum, mix) => sum + mix, 0);
    const normalizedMixes = mixes.map(mix => mix / total);
    
    // Build result object
    const result: { [key: string]: number } = {};
    enabledVoices.forEach((voice, idx) => {
      result[voice.id] = normalizedMixes[idx];
    });
    
    return result;
  };

  // Draw the mixer visualization
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    
    // Clear canvas
    ctx.clearRect(0, 0, size, size);
    
    // Draw outer circle
    ctx.beginPath();
    ctx.arc(center.x, center.y, radius - 10, 0, 2 * Math.PI);
    ctx.strokeStyle = "#cbd5e0";
    ctx.lineWidth = 2;
    ctx.stroke();
    
    // Draw three sections with subtle shading
    const voice1Angle = 0;
    const voice2Angle = (2 * Math.PI) / 3;
    const enabledVoices = voices.filter(v => v.enabled && v.elevenLabsVoiceId);
    const numVoices = enabledVoices.length;
    
    if (numVoices === 0) return;
    
    // Clear canvas
    ctx.clearRect(0, 0, size, size);
    
    // Draw outer circle
    ctx.beginPath();
    ctx.arc(center.x, center.y, radius - 10, 0, 2 * Math.PI);
    ctx.strokeStyle = "#cbd5e0";
    ctx.lineWidth = 2;
    ctx.stroke();
    
    const sectionRadius = radius - 10;
    const colors = ["#fecaca", "#bfdbfe", "#d9f99d", "#fde68a", "#ddd6fe", "#fbcfe8"]; // 6 colors
    const darkColors = ["#ef4444", "#3b82f6", "#84cc16", "#f59e0b", "#8b5cf6", "#ec4899"];
    
    // Calculate angles for each voice
    const voiceAngles = [];
    for (let i = 0; i < numVoices; i++) {
      voiceAngles.push((i * 2 * Math.PI) / numVoices);
    }
    
    const sectionAngle = (2 * Math.PI) / numVoices;
    
    // Draw section backgrounds
    voiceAngles.forEach((angle, idx) => {
      ctx.beginPath();
      ctx.moveTo(center.x, center.y);
      ctx.arc(
        center.x, 
        center.y, 
        sectionRadius, 
        angle - sectionAngle / 2, 
        angle + sectionAngle / 2
      );
      ctx.closePath();
      ctx.fillStyle = colors[idx % colors.length];
      ctx.globalAlpha = 0.15;
      ctx.fill();
      ctx.globalAlpha = 1.0;
    });
    
    // Draw dividing lines
    voiceAngles.forEach((angle) => {
      const lineAngle = angle - sectionAngle / 2;
      
      ctx.beginPath();
      ctx.moveTo(center.x, center.y);
      ctx.lineTo(
        center.x + Math.cos(lineAngle) * sectionRadius,
        center.y + Math.sin(lineAngle) * sectionRadius
      );
      ctx.strokeStyle = "#cbd5e0";
      ctx.lineWidth = 1;
      ctx.stroke();
    });
    
    // Draw voice labels
    voiceAngles.forEach((angle, idx) => {
      const labelRadius = sectionRadius + 20;
      const x = center.x + Math.cos(angle) * labelRadius;
      const y = center.y + Math.sin(angle) * labelRadius;
      
      ctx.fillStyle = darkColors[idx % darkColors.length];
      ctx.font = "11px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(enabledVoices[idx].name, x, y);
    });
    
    // Draw center point indicator
    ctx.beginPath();
    ctx.arc(center.x, center.y, 2, 0, 2 * Math.PI);
    ctx.fillStyle = "#9ca3af";
    ctx.fill();
    
    // Draw control dot
    const dotX = center.x + (position.x - 0.5) * 2 * (sectionRadius - 5);
    const dotY = center.y + (position.y - 0.5) * 2 * (sectionRadius - 5);
    
    ctx.beginPath();
    ctx.arc(dotX, dotY, 7, 0, 2 * Math.PI);
    ctx.fillStyle = "#1f2937";
    ctx.fill();
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 2;
    ctx.stroke();
    
  }, [position, voices, center.x, center.y, radius, size]);

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    setIsDragging(true);
    updatePosition(e);
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDragging) return;
    updatePosition(e);
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  const updatePosition = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    // Convert to normalized coordinates
    const nx = x / size;
    const ny = y / size;
    
    // Clamp to circle
    const cx = (nx - 0.5) * 2;
    const cy = (ny - 0.5) * 2;
    const distance = Math.sqrt(cx * cx + cy * cy);
    
    let finalX = nx;
    let finalY = ny;
    
    if (distance > 1) {
      // Clamp to circle edge
      const angle = Math.atan2(cy, cx);
      finalX = 0.5 + Math.cos(angle) * 0.5;
      finalY = 0.5 + Math.sin(angle) * 0.5;
    }
    
    setPosition({ x: finalX, y: finalY });
    
    // Calculate and emit mix
    const mix = calculateMix(finalX, finalY);
    onMixChange(mix);
  };

  // Initialize with center position
  useEffect(() => {
    const mix = calculateMix(0.5, 0.5);
    onMixChange(mix);
  }, []);

  // Auto-crossfade animation loop
  useEffect(() => {
    if (!isAnimating) {
      if (animationFrameId.current) {
        cancelAnimationFrame(animationFrameId.current);
        animationFrameId.current = null;
      }
      return;
    }

    animationStartTime.current = Date.now();

    const animate = () => {
      const elapsed = (Date.now() - animationStartTime.current) / 1000; // seconds
      const progress = (elapsed % rotationDuration) / rotationDuration; // 0 to 1
      
      // Calculate angle for current progress (full circle = 2π)
      const angle = progress * 2 * Math.PI;
      
      // Convert angle to position on circle edge (1.0 = exactly on the edge)
      const distanceFromCenter = 1.0;
      const x = 0.5 + Math.cos(angle) * distanceFromCenter * 0.5;
      const y = 0.5 + Math.sin(angle) * distanceFromCenter * 0.5;
      
      setPosition({ x, y });
      
      // Calculate and emit mix
      const mix = calculateMix(x, y);
      onMixChange(mix);
      
      animationFrameId.current = requestAnimationFrame(animate);
    };

    animate();

    return () => {
      if (animationFrameId.current) {
        cancelAnimationFrame(animationFrameId.current);
      }
    };
  }, [isAnimating, rotationDuration]);

  const toggleAnimation = () => {
    setIsAnimating(!isAnimating);
  };

  return (
    <div className="flex gap-4 items-start">
      {/* Voice selector - left side vertical box */}
      <div className="p-2 border rounded bg-gray-50 h-fit">
        <div className="text-xs font-medium mb-2">Voice Selector {isAudioPlaying && <span className="text-orange-500">(Locked during playback)</span>}</div>
        <div className="space-y-1">
          {voices.map((voice) => (
            <label key={voice.id} className={`flex items-center gap-2 text-xs ${isAudioPlaying ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:bg-gray-100'} p-1 rounded`}>
              <input
                type="checkbox"
                checked={voice.enabled}
                onChange={() => onToggleVoice?.(voice.id)}
                disabled={isAudioPlaying}
                className="w-3 h-3"
              />
              <span className={voice.enabled ? 'text-gray-900 font-medium' : 'text-gray-400 line-through'}>
                {voice.name}
              </span>
            </label>
          ))}
        </div>
      </div>
      
      {/* Mixer and controls - right side */}
      <div className="flex flex-col items-center">
        <canvas
          ref={canvasRef}
          width={size}
          height={size}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          className="cursor-pointer border rounded"
          style={{ touchAction: "none" }}
        />
        <div className="mt-2 text-xs text-gray-600 text-center">
          {isAnimating ? 'Auto-crossfade active' : 'Drag the dot to adjust voice mix'}
        </div>
        
        {/* Auto-crossfade controls */}
        <div className="mt-3 w-full max-w-[300px] p-2 border rounded bg-gray-50">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium">Auto-Crossfade</span>
            <button
              onClick={toggleAnimation}
              className={`text-xs px-3 py-1 rounded font-medium transition-colors ${
                isAnimating 
                  ? 'bg-red-500 text-white hover:bg-red-600' 
                  : 'bg-blue-500 text-white hover:bg-blue-600'
              }`}
            >
              {isAnimating ? '⏸ Stop' : '▶ Start'}
            </button>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-gray-600 whitespace-nowrap">Duration:</label>
            <input
              type="range"
              min="2"
              max="300"
              step="1"
              value={rotationDuration}
              onChange={(e) => setRotationDuration(Number(e.target.value))}
              className="flex-1"
              disabled={isAnimating}
            />
            <span className="text-xs font-medium w-8 text-right">{rotationDuration}s</span>
          </div>
        </div>
        
        {/* Show current mix percentages */}
        <div className="mt-2 flex gap-3 text-xs flex-wrap justify-center">
          {voices.filter(v => v.enabled && v.elevenLabsVoiceId).map((voice, idx) => {
            const mix = calculateMix(position.x, position.y);
            const percentage = Math.round((mix[voice.id] || 0) * 100);
            const colors = ["text-red-600", "text-blue-600", "text-green-600", "text-yellow-600", "text-purple-600", "text-pink-600"];
            return (
              <div key={voice.id} className={colors[idx % colors.length]}>
                {voice.name}: <strong>{percentage}%</strong>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
