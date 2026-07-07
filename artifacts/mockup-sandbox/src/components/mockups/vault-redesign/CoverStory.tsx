import React from "react";
import { Filter, Camera, Plus, ChevronRight } from "lucide-react";

export default function CoverStory() {
  return (
    <div 
      className="relative w-full max-w-[390px] h-[844px] overflow-hidden flex flex-col font-sans"
      style={{ backgroundColor: "#0D0D0D", color: "#FFFFFF" }}
    >
      {/* Header */}
      <div className="px-5 pt-12 pb-4 shrink-0 z-10 bg-[#0D0D0D]/90 backdrop-blur-md sticky top-0">
        <div className="flex justify-between items-center mb-5">
          <h1 className="text-[28px] font-bold tracking-tight">Photos</h1>
          <div className="flex gap-4">
            <button className="text-white/80 hover:text-white transition-colors">
              <Filter className="w-6 h-6" />
            </button>
            <button className="text-white/80 hover:text-white transition-colors">
              <Camera className="w-6 h-6" />
            </button>
          </div>
        </div>

        {/* Segmented Control */}
        <div className="flex p-1 bg-[#1A1A1A] rounded-full">
          <button className="flex-1 py-2 text-sm font-medium rounded-full bg-gradient-to-r from-[#FF6B2C] to-[#FFB23E] text-white shadow-sm">
            My uploads
          </button>
          <button className="flex-1 py-2 text-sm font-medium rounded-full text-white/50 hover:text-white transition-colors">
            Favorites
          </button>
        </div>
      </div>

      {/* Scrollable Content */}
      <div className="flex-1 overflow-y-auto px-5 pb-32 no-scrollbar flex flex-col gap-8">
        
        {/* First Memory Block */}
        <div className="flex flex-col gap-3">
          {/* Hero */}
          <div className="relative w-full h-[220px] rounded-xl overflow-hidden bg-gradient-to-br from-teal-800 to-slate-900 shadow-lg">
            {/* Overlay Gradient for readability */}
            <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
            
            {/* Bottom Left Label */}
            <div className="absolute bottom-3 left-3 bg-black/40 backdrop-blur-md px-3 py-1.5 rounded-lg border border-white/10">
              <span className="text-sm font-medium">🎳 Friday Night Bowling · Jul 12</span>
            </div>
            
            {/* Bottom Right Count */}
            <div className="absolute bottom-3 right-3 bg-black/40 backdrop-blur-md px-3 py-1.5 rounded-lg border border-white/10 flex items-center gap-1">
              <span className="text-sm font-medium">12</span>
              <ChevronRight className="w-4 h-4 text-white/70" />
            </div>
          </div>

          {/* Thumbnails Strip */}
          <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
            <div className="w-[60px] h-[60px] shrink-0 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600" />
            <div className="w-[60px] h-[60px] shrink-0 rounded-lg bg-gradient-to-br from-cyan-600 to-blue-800" />
            <div className="w-[60px] h-[60px] shrink-0 rounded-lg bg-gradient-to-br from-emerald-500 to-teal-700" />
            <button className="w-[60px] h-[60px] shrink-0 rounded-lg bg-[#1A1A1A] border border-white/10 flex items-center justify-center text-white/50 hover:bg-[#252525] transition-colors">
              <Plus className="w-6 h-6" />
            </button>
          </div>
        </div>

        {/* Second Memory Block */}
        <div className="flex flex-col gap-3">
          {/* Hero */}
          <div className="relative w-full h-[220px] rounded-xl overflow-hidden bg-gradient-to-br from-amber-500 to-orange-700 shadow-lg">
            {/* Overlay Gradient for readability */}
            <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
            
            {/* Bottom Left Label */}
            <div className="absolute bottom-3 left-3 bg-black/40 backdrop-blur-md px-3 py-1.5 rounded-lg border border-white/10">
              <span className="text-sm font-medium">🏖️ Lake House Trip · Jul 4–6</span>
            </div>
            
            {/* Bottom Right Count */}
            <div className="absolute bottom-3 right-3 bg-black/40 backdrop-blur-md px-3 py-1.5 rounded-lg border border-white/10 flex items-center gap-1">
              <span className="text-sm font-medium">48</span>
              <ChevronRight className="w-4 h-4 text-white/70" />
            </div>
          </div>

          {/* Thumbnails Strip */}
          <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
            <div className="w-[60px] h-[60px] shrink-0 rounded-lg bg-gradient-to-br from-yellow-500 to-orange-500" />
            <div className="w-[60px] h-[60px] shrink-0 rounded-lg bg-gradient-to-br from-orange-400 to-red-500" />
            <div className="w-[60px] h-[60px] shrink-0 rounded-lg bg-gradient-to-br from-red-500 to-rose-700" />
            <button className="w-[60px] h-[60px] shrink-0 rounded-lg bg-[#1A1A1A] border border-white/10 flex items-center justify-center text-white/50 hover:bg-[#252525] transition-colors">
              <Plus className="w-6 h-6" />
            </button>
          </div>
        </div>

      </div>

      {/* FAB */}
      <button className="absolute bottom-8 right-6 w-14 h-14 rounded-full bg-gradient-to-r from-[#FF6B2C] to-[#FFB23E] shadow-[0_8px_16px_rgba(255,107,44,0.3)] flex items-center justify-center text-white z-20 hover:scale-105 active:scale-95 transition-transform">
        <Camera className="w-6 h-6" />
      </button>

      {/* Inline styles for hiding scrollbar where tailwind plugin might be missing */}
      <style dangerouslySetInnerHTML={{__html: `
        .no-scrollbar::-webkit-scrollbar {
          display: none;
        }
        .no-scrollbar {
          -ms-overflow-style: none;  /* IE and Edge */
          scrollbar-width: none;  /* Firefox */
        }
      `}} />
    </div>
  );
}
