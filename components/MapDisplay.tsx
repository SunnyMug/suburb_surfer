import { useState } from "react";

interface MapDisplayProps {
  mapUrl: string;
}

export function MapDisplay({ mapUrl }: MapDisplayProps) {
  const [copied, setCopied] = useState(false);

  const handleShare = () => {
    navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="relative flex-1 w-full h-[45%] md:h-full">
      <iframe
        src={mapUrl}
        className="w-full h-full border-0"
        allowFullScreen
        loading="lazy"
        referrerPolicy="no-referrer-when-downgrade"
        title="Suburb map"
      />
      
      {/* Floating Buttons Container */}
      <div className="absolute bottom-6 right-6 flex flex-col gap-3 items-end pointer-events-none">
        
        {/* Share Button */}
        <button
          onClick={handleShare}
          className="pointer-events-auto flex items-center gap-2 px-4 py-2 bg-white/90 backdrop-blur text-slate-700 font-semibold text-sm rounded-full shadow-lg border border-slate-200 hover:bg-white hover:text-indigo-600 transition-all active:scale-95 cursor-pointer"
        >
          <span>{copied ? "✅ Copied!" : "📤 Share this Suburb"}</span>
        </button>

        {/* Buy Me A Coffee Button */}
        <a
          href="https://buymeacoffee.com/sunnymug"
          target="_blank"
          rel="noopener noreferrer"
          className="pointer-events-auto flex items-center gap-2 px-4 py-2 bg-[#FFDD00] text-black font-bold text-sm rounded-full shadow-lg border border-yellow-400 hover:bg-[#FFEA00] transition-all active:scale-95 cursor-pointer"
        >
          <span>☕ Buy me a coffee</span>
        </a>
      </div>
    </div>
  );
}
