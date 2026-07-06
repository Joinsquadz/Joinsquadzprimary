import React from "react";
import { Camera, Plus, ChevronRight, MoreHorizontal, Calendar, MapPin, Info } from "lucide-react";

export default function InlineGallery() {
  return (
    <div className="flex items-center justify-center min-h-screen bg-black/50 p-4">
      {/* Mobile Device Container */}
      <div 
        className="relative overflow-hidden shadow-2xl ring-1 ring-white/10"
        style={{
          width: 390,
          height: 844,
          backgroundColor: "#0D0D0D",
          borderRadius: 40,
        }}
      >
        {/* Status Bar Mock */}
        <div className="h-12 flex items-end justify-between px-6 pb-2 text-white/90 text-sm font-medium">
          <span>9:41</span>
          <div className="flex gap-1.5 items-center">
            <div className="w-4 h-3 bg-white/90 rounded-sm"></div>
            <div className="w-3 h-3 bg-white/90 rounded-full"></div>
            <div className="w-5 h-3 bg-white/90 rounded-sm"></div>
          </div>
        </div>

        {/* Header Image / Map area placeholder */}
        <div className="h-48 w-full bg-gradient-to-br from-blue-900/40 to-purple-900/40 relative">
          <div className="absolute inset-0 bg-black/20" />
          <div className="absolute top-4 left-4 w-10 h-10 bg-black/40 backdrop-blur-md rounded-full flex items-center justify-center">
             <ChevronRight className="w-6 h-6 text-white rotate-180" />
          </div>
          <div className="absolute top-4 right-4 w-10 h-10 bg-black/40 backdrop-blur-md rounded-full flex items-center justify-center">
             <MoreHorizontal className="w-6 h-6 text-white" />
          </div>
        </div>

        {/* Scrollable Content */}
        <div className="h-[calc(844px-48px-192px)] overflow-y-auto pb-24 px-4 pt-5">
          {/* Event Header */}
          <div className="mb-8">
            <div className="inline-block px-3 py-1 bg-[#1A1A1A] rounded-full text-[#FF6B2C] text-xs font-semibold mb-3 border border-[#FF6B2C]/20">
              TOMORROW, 8:00 PM
            </div>
            <h1 className="text-3xl font-bold text-white mb-4 leading-tight">
              Friday Night Bowling 🎳
            </h1>
            
            {/* Attendees */}
            <div className="flex items-center gap-3">
              <div className="flex -space-x-2">
                {[
                  "bg-gradient-to-tr from-pink-500 to-rose-500",
                  "bg-gradient-to-tr from-blue-500 to-cyan-500",
                  "bg-gradient-to-tr from-emerald-400 to-teal-500",
                  "bg-gradient-to-tr from-amber-400 to-orange-500"
                ].map((bg, i) => (
                  <div key={i} className={`w-8 h-8 rounded-full border-2 border-[#0D0D0D] ${bg}`} />
                ))}
                <div className="w-8 h-8 rounded-full border-2 border-[#0D0D0D] bg-[#1A1A1A] flex items-center justify-center text-xs font-medium text-white">
                  +2
                </div>
              </div>
              <span className="text-white/60 text-sm">attending</span>
            </div>
          </div>

          <div className="h-[1px] w-full bg-white/10 mb-6" />

          {/* Inline Gallery Section */}
          <section className="mb-8">
            {/* Section Header */}
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <h2 className="text-xl font-semibold text-white">Photos</h2>
                <div className="px-2 py-0.5 rounded-full bg-gradient-to-r from-[#FF6B2C] to-[#FFB23E] text-white text-xs font-bold">
                  12
                </div>
              </div>
              <button className="flex items-center text-sm font-medium text-[#FFB23E]">
                See all <ChevronRight className="w-4 h-4 ml-0.5" />
              </button>
            </div>

            {/* 3-column grid */}
            <div className="grid grid-cols-3 gap-1.5 mb-3">
              {[
                "bg-gradient-to-br from-green-400 to-emerald-600",
                "bg-gradient-to-br from-purple-500 to-indigo-600",
                "bg-gradient-to-br from-orange-400 to-rose-500",
                "bg-gradient-to-br from-blue-400 to-cyan-600",
                "bg-gradient-to-br from-pink-400 to-fuchsia-600",
                "bg-gradient-to-br from-yellow-400 to-amber-600",
              ].map((bg, i) => (
                <div key={i} className={`aspect-square rounded-[12px] ${bg} shadow-inner relative overflow-hidden`}>
                   <div className="absolute inset-0 bg-black/10 mix-blend-overlay"></div>
                </div>
              ))}
              
              {/* Add Button (Slot 7) */}
              <div className="aspect-square rounded-[12px] border-2 border-dashed border-white/20 bg-[#1A1A1A] flex items-center justify-center">
                <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center">
                  <Plus className="w-5 h-5 text-white/60" />
                </div>
              </div>
            </div>

            <button className="w-full py-3.5 rounded-xl bg-[#1A1A1A] text-white/80 font-medium text-sm active:bg-white/5 transition-colors">
              See all 12 photos
            </button>
          </section>

          <div className="h-[1px] w-full bg-white/10 mb-6" />

          {/* Details (Mock content) */}
          <section className="space-y-4 mb-8">
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 rounded-full bg-[#1A1A1A] flex items-center justify-center">
                <Calendar className="w-5 h-5 text-white/80" />
              </div>
              <div>
                <div className="text-white font-medium text-sm">Friday, Oct 24</div>
                <div className="text-white/60 text-xs">8:00 PM - 10:30 PM</div>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 rounded-full bg-[#1A1A1A] flex items-center justify-center">
                <MapPin className="w-5 h-5 text-white/80" />
              </div>
              <div>
                <div className="text-white font-medium text-sm">Lucky Strike Lanes</div>
                <div className="text-white/60 text-xs">123 Bowling Alley</div>
              </div>
            </div>
            <div className="flex gap-4">
              <div className="w-10 h-10 rounded-full bg-[#1A1A1A] flex items-center justify-center shrink-0">
                <Info className="w-5 h-5 text-white/80" />
              </div>
              <div className="pt-2 text-white/80 text-sm leading-relaxed">
                We've got lanes 4 and 5 booked for 2 hours. I pre-paid the deposit but we'll split shoes and food there.
              </div>
            </div>
          </section>

        </div>

        {/* Floating Action Button */}
        <div className="absolute bottom-8 right-6">
          <button className="w-[60px] h-[60px] rounded-full bg-gradient-to-br from-[#FF6B2C] to-[#FFB23E] flex items-center justify-center shadow-lg shadow-[#FF6B2C]/30 hover:scale-105 transition-transform active:scale-95">
            <Camera className="w-7 h-7 text-white fill-current/10" />
          </button>
        </div>

        {/* Home Indicator */}
        <div className="absolute bottom-2 left-1/2 -translate-x-1/2 w-[120px] h-1.5 bg-white rounded-full opacity-80" />
      </div>
    </div>
  );
}
