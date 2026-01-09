"use client";

import React from 'react';
import { useTranscript } from './TranscriptContext';

export default function TextVisualizer() {
  const { currentUserText, currentAssistantText } = useTranscript();

  // Prefer showing the latest user partial; fall back to assistant output.
  const displayText = currentUserText || currentAssistantText;
  const textRole: 'user' | 'assistant' | null = currentUserText
    ? 'user'
    : currentAssistantText
    ? 'assistant'
    : null;

  return (
    <div className="fixed inset-0 bg-black text-white flex items-center justify-center overflow-hidden" 
         style={{
           boxShadow: `inset 14px 24px 16px -21px rgba(209, 217, 230, 0.34), 
                       inset 14px 28px 20px -21px rgba(209, 217, 230, 0.4), 
                       inset 14px 35px 27px -21px rgba(209, 217, 230, 0.48), 
                       inset 14px 54px 43px -21px rgba(209, 217, 230, 0.67), 
                       inset -36px -63px 47px -21px rgba(255, 255, 255, 0.75), 
                       inset -36px -36.8341px 24.6719px -21px rgba(255, 255, 255, 0.54), 
                       inset -36px -31.3638px 17.026px -21px rgba(255, 255, 255, 0.45), 
                       inset -36px -28.4185px 16px -21px rgba(255, 255, 255, 0.38)`
         }}>
      <div className="w-full px-8">
        {displayText && (
          <div className="text-center">
            <div className={`text-sm uppercase tracking-wider mb-4 ${
              textRole === 'user' ? 'text-blue-400' : 'text-green-400'
            }`}>
              {/* {textRole === 'user' ? 'User' : 'Response'} */}
            </div>
            <p className="text-6xl font-bold leading-tight animate-pulse">
              {displayText}
            </p>
          </div>
        )}
        {!displayText && (
          <p className="text-2xl text-gray-500 animate-pulse text-center">
            Waiting for conversation...
          </p>
        )}
      </div>
    </div>
  );
}
