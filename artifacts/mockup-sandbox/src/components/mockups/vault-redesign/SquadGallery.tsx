import React from 'react';
import { ChevronRight, ArrowLeft, Upload, Plus, Heart, Image as ImageIcon, Video, LayoutGrid } from 'lucide-react';

export default function SquadGallery() {
  return (
    <div className="flex flex-col gap-12 bg-[#050505] text-white p-8 items-center min-h-screen">
      {/* Screen 1: Squad Picker */}
      <div className="w-[390px] h-[844px] bg-[#0D0D0D] rounded-[40px] overflow-hidden border border-[#222] shadow-2xl relative flex flex-col font-sans">
        {/* Header */}
        <div className="px-6 pt-16 pb-6">
          <h1 className="text-4xl font-extrabold tracking-tight mb-1">Vault</h1>
          <p className="text-[#888] text-sm font-semibold">47 memories</p>
        </div>

        {/* Squad Cards List */}
        <div className="flex-1 px-4 overflow-y-hidden flex flex-col gap-4">
          
          {/* Card 1 */}
          <div className="relative h-[180px] w-full rounded-3xl overflow-hidden group cursor-pointer shadow-lg">
            <div className="absolute inset-0 bg-gradient-to-br from-indigo-600 via-purple-600 to-teal-500 opacity-90 mix-blend-overlay"></div>
            <div className="absolute inset-0 bg-black/20"></div>
            
            <div className="absolute inset-0 p-5 flex flex-col justify-between">
              <div>
                <h2 className="text-2xl font-bold text-white mb-1 shadow-sm">🎳 Friday Crew</h2>
                <p className="text-white/80 text-sm font-semibold">28 photos</p>
              </div>
              
              <div className="flex items-center justify-between w-full">
                <div className="flex -space-x-2">
                  <div className="w-8 h-8 rounded-full border-2 border-black bg-pink-500 flex items-center justify-center text-xs font-bold text-white shadow-sm">A</div>
                  <div className="w-8 h-8 rounded-full border-2 border-black bg-blue-500 flex items-center justify-center text-xs font-bold text-white shadow-sm">J</div>
                  <div className="w-8 h-8 rounded-full border-2 border-black bg-emerald-500 flex items-center justify-center text-xs font-bold text-white shadow-sm">M</div>
                </div>
                <div className="w-8 h-8 rounded-full bg-black/30 backdrop-blur-md flex items-center justify-center border border-white/10">
                  <ChevronRight size={18} className="text-white" />
                </div>
              </div>
            </div>
          </div>

          {/* Card 2 */}
          <div className="relative h-[180px] w-full rounded-3xl overflow-hidden group cursor-pointer shadow-lg">
            <div className="absolute inset-0 bg-gradient-to-br from-orange-500 via-rose-500 to-pink-600 opacity-90 mix-blend-overlay"></div>
            <div className="absolute inset-0 bg-black/20"></div>
            
            <div className="absolute inset-0 p-5 flex flex-col justify-between">
              <div>
                <h2 className="text-2xl font-bold text-white mb-1 shadow-sm">🌮 Brunch Club</h2>
                <p className="text-white/80 text-sm font-semibold">12 photos</p>
              </div>
              
              <div className="flex items-center justify-between w-full">
                <div className="flex -space-x-2">
                  <div className="w-8 h-8 rounded-full border-2 border-black bg-amber-500 flex items-center justify-center text-xs font-bold text-white shadow-sm">S</div>
                  <div className="w-8 h-8 rounded-full border-2 border-black bg-purple-500 flex items-center justify-center text-xs font-bold text-white shadow-sm">K</div>
                </div>
                <div className="w-8 h-8 rounded-full bg-black/30 backdrop-blur-md flex items-center justify-center border border-white/10">
                  <ChevronRight size={18} className="text-white" />
                </div>
              </div>
            </div>
          </div>

          {/* Card 3 (Partial) */}
          <div className="relative h-[180px] w-full rounded-t-3xl overflow-hidden group cursor-pointer translate-y-2 shadow-lg">
            <div className="absolute inset-0 bg-gradient-to-br from-cyan-500 via-blue-500 to-indigo-600 opacity-90 mix-blend-overlay"></div>
            <div className="absolute inset-0 bg-black/20"></div>
            
            <div className="absolute inset-0 p-5 flex flex-col justify-between">
              <div>
                <h2 className="text-2xl font-bold text-white mb-1 shadow-sm">🏖️ Lake House</h2>
                <p className="text-white/80 text-sm font-semibold">18 photos</p>
              </div>
            </div>
          </div>
          
        </div>
      </div>

      {/* Screen 2: Squad Gallery */}
      <div className="w-[390px] h-[844px] bg-[#0D0D0D] rounded-[40px] overflow-hidden border border-[#222] shadow-2xl relative flex flex-col font-sans">
        
        {/* Top Nav */}
        <div className="px-4 pt-14 pb-4 flex items-center justify-between border-b border-[#222]/50 bg-[#0D0D0D] z-10">
          <div className="flex items-center gap-3">
            <button className="w-10 h-10 rounded-full bg-[#1A1A1A] flex items-center justify-center hover:bg-[#222] transition-colors">
              <ArrowLeft size={20} className="text-white" />
            </button>
            <div>
              <h2 className="text-lg font-bold leading-tight">Friday Crew</h2>
              <p className="text-[#888] text-xs font-semibold">28 photos</p>
            </div>
          </div>
          <button className="bg-gradient-to-r from-[#FF6B2C] to-[#FFB23E] px-4 py-2 rounded-full font-bold text-sm flex items-center gap-2 shadow-lg shadow-[#FF6B2C]/20 hover:opacity-90 transition-opacity">
            <Upload size={16} />
            Upload
          </button>
        </div>

        {/* Filters */}
        <div className="px-4 py-4 flex gap-2 overflow-x-auto no-scrollbar bg-[#0D0D0D] z-10">
          <button className="px-4 py-2 bg-white text-black rounded-full text-sm font-bold flex items-center gap-2 shadow-sm">
            <LayoutGrid size={14} /> All
          </button>
          <button className="px-4 py-2 bg-[#1A1A1A] text-[#888] rounded-full text-sm font-bold flex items-center gap-2 border border-[#333] hover:text-white transition-colors">
            <ImageIcon size={14} /> Photos
          </button>
          <button className="px-4 py-2 bg-[#1A1A1A] text-[#888] rounded-full text-sm font-bold flex items-center gap-2 border border-[#333] hover:text-white transition-colors">
            <Video size={14} /> Videos
          </button>
        </div>

        {/* Photo Grid */}
        <div className="flex-1 overflow-y-auto px-1">
          <div className="grid grid-cols-3 gap-[2px] pb-10">
            
            {/* Add Photo Tile */}
            <div className="aspect-square bg-[#1A1A1A] flex flex-col items-center justify-center text-[#888] gap-2 cursor-pointer hover:bg-[#222] transition-colors relative">
               <div className="absolute inset-1 border-2 border-dashed border-[#333] rounded-sm pointer-events-none"></div>
              <div className="w-8 h-8 rounded-full bg-[#222] flex items-center justify-center">
                <Plus size={18} />
              </div>
              <span className="text-[11px] font-bold uppercase tracking-wider text-[#666]">Add</span>
            </div>

            {/* Photos */}
            {Array.from({length: 17}).map((_, i) => {
              const gradients = [
                "from-blue-400 to-emerald-400",
                "from-rose-400 to-orange-300",
                "from-violet-500 to-fuchsia-400",
                "from-cyan-400 to-blue-500",
                "from-amber-300 to-orange-500",
                "from-pink-500 to-rose-400"
              ];
              const gradient = gradients[i % gradients.length];
              const showHeart = i % 4 === 1;
              const avatar = ['A', 'J', 'M'][i % 3];
              
              return (
                <div key={i} className="aspect-square relative group cursor-pointer bg-[#1A1A1A]">
                  <div className={`absolute inset-0 bg-gradient-to-br ${gradient} opacity-80 mix-blend-overlay`}></div>
                  <div className="absolute inset-0 bg-black/10"></div>
                  
                  {/* Uploader Avatar */}
                  <div className="absolute top-1.5 right-1.5 w-[22px] h-[22px] rounded-full bg-black/40 backdrop-blur-md flex items-center justify-center text-[9px] font-bold text-white border border-white/20 shadow-sm">
                    {avatar}
                  </div>

                  {/* Heart count */}
                  {showHeart && (
                    <div className="absolute bottom-1.5 left-1.5 bg-black/50 backdrop-blur-md px-1.5 py-0.5 rounded-full flex items-center gap-1 border border-white/10">
                      <span className="text-[10px]">❤️</span>
                      <span className="text-[10px] font-bold text-white">{i + 2}</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

    </div>
  );
}
