import React from "react";
import { Camera, ChevronRight, Plus, MapPin, Clock } from "lucide-react";

export default function ThumbnailStripMockup() {
  return (
    <div className="flex justify-center bg-black min-h-screen p-8 text-white font-sans">
      <div
        className="w-[390px] rounded-[40px] overflow-hidden shadow-2xl relative"
        style={{ backgroundColor: "#0D0D0D", border: "8px solid #1A1A1A" }}
      >
        {/* Status Bar Mock */}
        <div className="h-12 w-full flex items-center justify-between px-6 text-[14px] font-medium z-10 relative">
          <span>9:41</span>
          <div className="flex space-x-2">
            <div className="w-4 h-4 rounded-full border border-white" />
            <div className="w-4 h-4 rounded-full border border-white" />
          </div>
        </div>

        <div className="px-5 pb-10 overflow-y-auto h-[800px] no-scrollbar">
          
          {/* Header Area */}
          <div className="mt-4 mb-8">
            <h1 className="text-3xl font-bold mb-3 tracking-tight">Friday Night Bowling 🎳</h1>
            <div className="flex items-center space-x-2 text-gray-400 mb-2">
              <Clock size={16} />
              <span className="text-sm">Saturday Jul 12 · 8 PM</span>
            </div>
            <div className="flex items-center space-x-2 text-gray-400 mb-6">
              <MapPin size={16} />
              <span className="text-sm">Lucky Strike Lanes</span>
            </div>
            
            {/* Attendees */}
            <div className="flex -space-x-2">
              {[
                "linear-gradient(135deg, #4ade80, #3b82f6)",
                "linear-gradient(135deg, #f472b6, #db2777)",
                "linear-gradient(135deg, #fbbf24, #f59e0b)",
                "linear-gradient(135deg, #c084fc, #9333ea)"
              ].map((grad, i) => (
                <div 
                  key={i} 
                  className="w-8 h-8 rounded-full border-2 border-[#0D0D0D]"
                  style={{ background: grad }}
                />
              ))}
              <div className="w-8 h-8 rounded-full border-2 border-[#0D0D0D] bg-[#1A1A1A] flex items-center justify-center text-[10px] text-gray-400 font-bold">
                +4
              </div>
            </div>
          </div>

          <div className="w-full h-[1px] bg-[#1A1A1A] mb-8" />

          {/* STATE 1: Populated */}
          <div className="mb-10">
            <div className="text-[11px] uppercase tracking-wider text-gray-500 font-bold mb-4 ml-1">
              State: With Photos
            </div>
            
            <div className="bg-[#1A1A1A] rounded-2xl p-4">
              <div className="flex justify-between items-center mb-3">
                <div className="flex items-center space-x-2">
                  <h2 className="text-lg font-semibold">Vault</h2>
                  <span className="bg-white/10 text-white text-xs px-2 py-0.5 rounded-full font-medium">12 photos</span>
                </div>
                <div className="flex items-center text-sm font-medium text-gray-400">
                  View all <ChevronRight size={16} className="ml-0.5" />
                </div>
              </div>

              {/* Thumbnail Strip */}
              <div className="flex space-x-2">
                <div className="flex-1 aspect-square rounded-xl overflow-hidden relative" style={{ background: "linear-gradient(180deg, #1e3a8a, #0f172a)" }}>
                  <div className="absolute inset-0 bg-black/20" />
                </div>
                <div className="flex-1 aspect-square rounded-xl overflow-hidden relative" style={{ background: "linear-gradient(135deg, #c2410c, #7c2d12)" }}>
                  <div className="absolute inset-0 bg-white/10" />
                </div>
                <div className="flex-1 aspect-square rounded-xl overflow-hidden relative" style={{ background: "linear-gradient(45deg, #0f766e, #064e3b)" }}>
                  <div className="absolute inset-0 bg-black/10" />
                </div>
                <div className="flex-1 aspect-square rounded-xl bg-[#2A2A2A] flex items-center justify-center border border-white/5">
                  <Plus size={24} className="text-gray-400" />
                </div>
              </div>
            </div>
          </div>

          <div className="w-full h-[1px] bg-[#1A1A1A] mb-8" />

          {/* STATE 2: Empty */}
          <div>
            <div className="text-[11px] uppercase tracking-wider text-gray-500 font-bold mb-4 ml-1">
              State: Empty
            </div>
            
            <div className="bg-[#1A1A1A] rounded-2xl p-4">
              <h2 className="text-lg font-semibold mb-3">Vault</h2>
              
              <div className="border-2 border-dashed border-[#333333] rounded-xl p-6 flex flex-col items-center justify-center text-center">
                <div className="w-12 h-12 bg-white/5 rounded-full flex items-center justify-center mb-3">
                  <Camera size={24} className="text-gray-400" />
                </div>
                <h3 className="font-semibold text-base mb-1">Add the first photo</h3>
                <p className="text-sm text-gray-400 mb-5">Share moments with your squad</p>
                
                <button 
                  className="w-full py-3 rounded-full font-bold text-white shadow-lg flex items-center justify-center space-x-2"
                  style={{ background: "linear-gradient(135deg, #FF6B2C, #FFB23E)" }}
                >
                  <Plus size={18} />
                  <span>Upload Photos</span>
                </button>
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
