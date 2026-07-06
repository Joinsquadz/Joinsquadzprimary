import React from "react";
import { Camera, Calendar, ChevronRight, Plus } from "lucide-react";

export default function MemoriesFeed() {
  return (
    <div className="flex flex-col md:flex-row gap-8 p-8 bg-[#0a0a0a] min-h-screen text-white font-sans items-center justify-center">
      {/* Screen 1: Memories Strip in Event Page */}
      <div
        className="w-[390px] h-[844px] bg-[#0D0D0D] rounded-[40px] border-[8px] border-[#1a1a1a] overflow-hidden flex flex-col relative shrink-0 shadow-2xl"
        style={{
          boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.7)",
        }}
      >
        <div className="flex-1 overflow-y-auto pb-8 scrollbar-hide">
          {/* Header */}
          <div className="px-6 pt-14 pb-6">
            <h1 className="text-3xl font-bold mb-1 tracking-tight">Lake House Trip 🏖️</h1>
            <p className="text-[#a0a0a0] font-medium">Jul 4–6 • Summer Squad</p>
          </div>

          {/* Other event details mock */}
          <div className="px-6 mb-8 flex gap-3">
            <div className="h-12 w-12 rounded-full bg-[#1c1c1c] flex items-center justify-center">
              <span className="text-xl">📍</span>
            </div>
            <div className="flex flex-col justify-center">
              <span className="font-semibold text-[15px]">142 Sunny Cove</span>
              <span className="text-[#808080] text-[13px]">Lake Tahoe</span>
            </div>
          </div>

          {/* Memories Strip */}
          <div className="mb-8">
            <div className="px-6 flex justify-between items-center mb-4">
              <h2 className="text-xl font-bold">Memories <span className="text-[#808080] text-[15px] font-medium">· 18 photos</span></h2>
              <button className="text-[#FF6B2C] text-[14px] font-semibold flex items-center">
                View all <ChevronRight className="w-4 h-4 ml-0.5" />
              </button>
            </div>

            <div className="flex overflow-x-auto px-6 gap-3 pb-4 scrollbar-hide snap-x">
              {/* Add Card */}
              <div className="w-[100px] h-[140px] shrink-0 rounded-[16px] border-2 border-dashed border-[#333] flex flex-col items-center justify-center gap-2 snap-start bg-[#111]">
                <div className="w-8 h-8 rounded-full bg-[#FF6B2C] flex items-center justify-center">
                  <Plus className="w-5 h-5 text-white" />
                </div>
                <span className="text-[#FF6B2C] text-[12px] font-semibold">Add</span>
              </div>

              {/* Photo Card 1 */}
              <div
                className="w-[100px] h-[140px] shrink-0 rounded-[16px] relative snap-start overflow-hidden"
                style={{ background: "linear-gradient(135deg, #0d9488, #0f766e)" }}
              >
                <div className="absolute inset-0 bg-black/10"></div>
                <div className="absolute bottom-2 left-2 text-white/90 text-[11px] font-medium bg-black/40 px-1.5 py-0.5 rounded backdrop-blur-sm">
                  10:42 AM
                </div>
              </div>

              {/* Photo Card 2 */}
              <div
                className="w-[100px] h-[140px] shrink-0 rounded-[16px] relative snap-start overflow-hidden"
                style={{ background: "linear-gradient(135deg, #d97706, #b45309)" }}
              >
                <div className="absolute inset-0 bg-black/10"></div>
                <div className="absolute bottom-2 left-2 text-white/90 text-[11px] font-medium bg-black/40 px-1.5 py-0.5 rounded backdrop-blur-sm">
                  1:15 PM
                </div>
              </div>

              {/* Photo Card 3 */}
              <div
                className="w-[100px] h-[140px] shrink-0 rounded-[16px] relative snap-start overflow-hidden"
                style={{ background: "linear-gradient(135deg, #e11d48, #be123c)" }}
              >
                <div className="absolute inset-0 bg-black/10"></div>
                <div className="absolute bottom-2 left-2 text-white/90 text-[11px] font-medium bg-black/40 px-1.5 py-0.5 rounded backdrop-blur-sm">
                  3:30 PM
                </div>
              </div>

              {/* Photo Card 4 (Partial) */}
              <div
                className="w-[100px] h-[140px] shrink-0 rounded-[16px] relative snap-start overflow-hidden"
                style={{ background: "linear-gradient(135deg, #7c3aed, #6d28d9)" }}
              >
                <div className="absolute inset-0 bg-black/10"></div>
                <div className="absolute bottom-2 left-2 text-white/90 text-[11px] font-medium bg-black/40 px-1.5 py-0.5 rounded backdrop-blur-sm">
                  8:00 PM
                </div>
              </div>
            </div>
          </div>

          <div className="px-6">
            <h2 className="text-xl font-bold mb-4">Attendees</h2>
            <div className="flex gap-2">
              <div className="w-12 h-12 rounded-full bg-[#222] border-2 border-[#0D0D0D]"></div>
              <div className="w-12 h-12 rounded-full bg-[#333] border-2 border-[#0D0D0D] -ml-4"></div>
              <div className="w-12 h-12 rounded-full bg-[#444] border-2 border-[#0D0D0D] -ml-4"></div>
            </div>
          </div>
        </div>
      </div>

      {/* Screen 2: Unified Memories Tab */}
      <div
        className="w-[390px] h-[844px] bg-[#0D0D0D] rounded-[40px] border-[8px] border-[#1a1a1a] overflow-hidden flex flex-col relative shrink-0 shadow-2xl"
        style={{
          boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.7)",
        }}
      >
        {/* Header */}
        <div className="px-6 pt-14 pb-4 sticky top-0 bg-[#0D0D0D]/90 backdrop-blur-md z-10 flex justify-between items-end border-b border-[#1f1f1f]">
          <h1 className="text-3xl font-bold tracking-tight">Memories</h1>
          <div className="flex gap-2">
            <button className="h-9 px-3 rounded-full bg-[#1c1c1c] flex items-center justify-center text-sm font-medium">
              <Calendar className="w-4 h-4 mr-1.5 text-[#a0a0a0]" />
              Jul 2026
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-6 scrollbar-hide">
          
          {/* Group 1: Lake House Trip */}
          <div className="mb-10">
            <div className="mb-3 flex justify-between items-end px-2">
              <div>
                <h3 className="text-[18px] font-bold text-white mb-0.5">Lake House Trip</h3>
                <p className="text-[13px] text-[#808080] font-medium">Summer Squad · Jul 4</p>
              </div>
              <button className="text-[#FF6B2C] text-[13px] font-semibold bg-[#FF6B2C]/10 px-2.5 py-1 rounded-full">
                Add
              </button>
            </div>
            
            <div className="grid grid-cols-2 gap-2">
              <div 
                className="h-[200px] rounded-[16px] relative overflow-hidden"
                style={{ background: "linear-gradient(135deg, #0d9488, #0f766e)" }}
              >
                <div className="absolute inset-0 bg-black/10"></div>
              </div>
              <div className="grid grid-rows-2 gap-2 h-[200px]">
                <div 
                  className="rounded-[16px] relative overflow-hidden"
                  style={{ background: "linear-gradient(135deg, #d97706, #b45309)" }}
                >
                  <div className="absolute inset-0 bg-black/10"></div>
                </div>
                <div 
                  className="rounded-[16px] relative overflow-hidden"
                  style={{ background: "linear-gradient(135deg, #e11d48, #be123c)" }}
                >
                  <div className="absolute inset-0 bg-black/10"></div>
                  <div className="absolute inset-0 flex items-center justify-center bg-black/40 backdrop-blur-[2px]">
                    <span className="text-white font-bold text-lg">+15</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Group 2: Friday Bowling */}
          <div className="mb-10">
            <div className="mb-3 flex justify-between items-end px-2">
              <div>
                <h3 className="text-[18px] font-bold text-white mb-0.5">Friday Bowling</h3>
                <p className="text-[13px] text-[#808080] font-medium">Work Friends · Jul 12</p>
              </div>
              <button className="text-[#FF6B2C] text-[13px] font-semibold bg-[#FF6B2C]/10 px-2.5 py-1 rounded-full">
                Add
              </button>
            </div>
            
            <div className="grid grid-cols-2 gap-2">
              <div 
                className="h-[140px] rounded-[16px] relative overflow-hidden"
                style={{ background: "linear-gradient(135deg, #7c3aed, #6d28d9)" }}
              >
                <div className="absolute inset-0 bg-black/10"></div>
              </div>
              <div 
                className="h-[140px] rounded-[16px] relative overflow-hidden"
                style={{ background: "linear-gradient(135deg, #0284c7, #0369a1)" }}
              >
                <div className="absolute inset-0 bg-black/10"></div>
              </div>
            </div>
          </div>

        </div>

        {/* Bottom Nav Mock */}
        <div className="h-[84px] bg-[#0D0D0D] border-t border-[#1f1f1f] flex justify-around items-start pt-3 px-6 pb-8 sticky bottom-0">
          <div className="flex flex-col items-center gap-1 opacity-50">
            <div className="w-6 h-6 rounded-full border-2 border-current"></div>
            <span className="text-[10px]">Feed</span>
          </div>
          <div className="flex flex-col items-center gap-1">
            <Camera className="w-6 h-6 text-[#FF6B2C]" />
            <span className="text-[10px] text-[#FF6B2C] font-semibold">Memories</span>
          </div>
          <div className="flex flex-col items-center gap-1 opacity-50">
            <div className="w-6 h-6 rounded-full border-2 border-current"></div>
            <span className="text-[10px]">Squads</span>
          </div>
        </div>
      </div>

    </div>
  );
}
