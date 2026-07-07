import React from 'react';
import { ChevronLeft, Search, Camera, Heart, MessageCircle, Plus } from 'lucide-react';

export default function MemoriesTimeline() {
  return (
    <div className="relative w-full max-w-[390px] mx-auto h-[844px] overflow-hidden rounded-[40px] border-[8px] border-neutral-900 bg-[#0D0D0D] text-white flex flex-col font-sans shadow-2xl">
      
      {/* Top Bar */}
      <div className="pt-14 pb-2 px-4 flex items-center justify-between z-10 bg-[#0D0D0D]/90 backdrop-blur-md sticky top-0">
        <button className="p-2 -ml-2 rounded-full hover:bg-white/10 transition-colors">
          <ChevronLeft className="w-6 h-6 text-white" />
        </button>
        <h1 className="text-xl font-bold tracking-tight">Memories</h1>
        <button className="p-2 -mr-2 rounded-full hover:bg-white/10 transition-colors">
          <Search className="w-6 h-6 text-white" />
        </button>
      </div>

      {/* Filter Chips */}
      <div className="flex px-4 pb-4 gap-2 overflow-x-auto scrollbar-hide shrink-0 bg-[#0D0D0D]/90 backdrop-blur-md sticky top-[88px] z-10 border-b border-white/5">
        <button className="px-4 py-1.5 rounded-full bg-gradient-to-r from-[#FF6B2C] to-[#FFB23E] text-white font-medium text-sm whitespace-nowrap shadow-lg shadow-[#FF6B2C]/20">
          All · 47
        </button>
        <button className="px-4 py-1.5 rounded-full bg-white/10 text-white/80 font-medium text-sm whitespace-nowrap hover:bg-white/20 transition-colors">
          My Squad
        </button>
        <button className="px-4 py-1.5 rounded-full bg-white/10 text-white/80 font-medium text-sm whitespace-nowrap hover:bg-white/20 transition-colors">
          Jul 2026
        </button>
      </div>

      {/* Scrollable Content */}
      <div className="flex-1 overflow-y-auto pb-32">
        
        {/* First Event Group */}
        <div className="pt-6 pb-8 px-4">
          <div className="flex justify-between items-baseline mb-1">
            <h2 className="text-2xl font-bold tracking-tight">🎳 Friday Night Bowling</h2>
            <span className="text-sm font-medium text-white/40">12 photos</span>
          </div>
          <p className="text-sm text-white/60 mb-4 font-medium tracking-wide">
            Jul 12 · Lucky Strike · 6 people
          </p>

          <div className="grid grid-cols-2 gap-2 mb-3">
            {/* Left tall photo */}
            <div className="relative aspect-[2/3] rounded-2xl overflow-hidden bg-gradient-to-br from-blue-600 via-indigo-800 to-purple-900 shadow-md">
              <div className="absolute inset-0 bg-black/10"></div>
              <div className="absolute bottom-2 left-2 w-6 h-6 rounded-full bg-white/20 backdrop-blur-md border border-white/30 flex items-center justify-center text-[10px] font-bold">
                J
              </div>
            </div>
            
            {/* Right stacked photos */}
            <div className="flex flex-col gap-2">
              <div className="relative flex-1 rounded-2xl overflow-hidden bg-gradient-to-br from-amber-500 via-orange-600 to-red-600 shadow-md">
                <div className="absolute inset-0 bg-black/10"></div>
                <div className="absolute bottom-2 left-2 w-6 h-6 rounded-full bg-white/20 backdrop-blur-md border border-white/30 flex items-center justify-center text-[10px] font-bold">
                  S
                </div>
              </div>
              <div className="relative flex-1 rounded-2xl overflow-hidden bg-gradient-to-br from-emerald-500 via-teal-600 to-cyan-700 shadow-md">
                <div className="absolute inset-0 bg-black/10"></div>
                <div className="absolute bottom-2 left-2 w-6 h-6 rounded-full bg-white/20 backdrop-blur-md border border-white/30 flex items-center justify-center text-[10px] font-bold">
                  M
                </div>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#1A1A1A] border border-white/5 hover:bg-[#252525] transition-colors">
              <Heart className="w-4 h-4 text-rose-500 fill-rose-500" />
              <span className="text-sm font-medium">8</span>
            </button>
            <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#1A1A1A] border border-white/5 hover:bg-[#252525] transition-colors">
              <MessageCircle className="w-4 h-4 text-white/70" />
              <span className="text-sm font-medium text-white/80">3 comments</span>
            </button>
            <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#1A1A1A] border border-white/5 hover:bg-[#252525] transition-colors ml-auto">
              <Plus className="w-4 h-4 text-white/70" />
              <span className="text-sm font-medium text-white/80">Add photo</span>
            </button>
          </div>
        </div>

        {/* Second Event Group */}
        <div className="px-4">
          <div className="flex justify-between items-baseline mb-1">
            <h2 className="text-2xl font-bold tracking-tight">🏖️ Lake House Trip</h2>
            <span className="text-sm font-medium text-white/40">18 photos</span>
          </div>
          <p className="text-sm text-white/60 mb-4 font-medium tracking-wide">
            Jul 4–6
          </p>

          <div className="grid grid-cols-3 gap-2">
            <div className="aspect-square rounded-2xl bg-gradient-to-br from-cyan-400 via-blue-500 to-indigo-600 shadow-md relative overflow-hidden">
               <div className="absolute inset-0 bg-black/10"></div>
            </div>
            <div className="aspect-square rounded-2xl bg-gradient-to-br from-yellow-300 via-amber-400 to-orange-500 shadow-md relative overflow-hidden">
               <div className="absolute inset-0 bg-black/10"></div>
            </div>
            <div className="aspect-square rounded-2xl bg-gradient-to-br from-pink-400 via-rose-500 to-red-600 shadow-md relative overflow-hidden">
               <div className="absolute inset-0 bg-black/10"></div>
            </div>
          </div>
        </div>
      </div>

      {/* FAB */}
      <button className="absolute bottom-8 right-6 w-14 h-14 rounded-full bg-gradient-to-br from-[#FF6B2C] to-[#FFB23E] text-white flex items-center justify-center shadow-lg shadow-[#FF6B2C]/30 hover:scale-105 active:scale-95 transition-all z-20 border border-white/20">
        <Camera className="w-6 h-6" />
      </button>

      {/* Fade at bottom */}
      <div className="absolute bottom-0 left-0 right-0 h-24 bg-gradient-to-t from-[#0D0D0D] to-transparent pointer-events-none z-10" />

    </div>
  );
}
