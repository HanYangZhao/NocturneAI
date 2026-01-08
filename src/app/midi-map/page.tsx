"use client";

import React from "react";
import MidiController from "../midi";

export default function MidiMapPage() {
  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-5xl mx-auto bg-white p-6 rounded shadow">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-lg font-semibold">MIDI Mapper</h1>
          <div className="text-sm text-gray-500">Manage 32 CC slots, assign targets, and test mappings</div>
        </div>
        <div className="border rounded p-4">
          <MidiController />
        </div>
      </div>
    </div>
  );
}
