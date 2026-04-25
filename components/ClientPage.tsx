"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { SuburbData, CityName, PanelView, CITIES, TABS, LOADING_MESSAGES } from "../lib/types";
import { getSuburbMapUrl, getVenueMapUrl, getDefaultMapUrl } from "../lib/utils";
import { MapDisplay } from "./MapDisplay";
import { OverviewView, FoodView, HistoryView, DemographicsView } from "./SidebarViews";

export function ClientPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Read initial state from URL or fallback
  const initialCity = (searchParams.get("city") as CityName) || "Sydney";
  const urlSuburb = searchParams.get("suburb") || "";

  const [selectedCity, setSelectedCity] = useState<CityName>(initialCity);
  const [suburb, setSuburb] = useState<SuburbData | null>(null);
  const [loadingSuburb, setLoadingSuburb] = useState(false);
  const [errorSuburb, setErrorSuburb] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState(urlSuburb);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedVenue, setSelectedVenue] = useState<{ lat: number; lng: number } | null>(null);
  const [visibleFoodCount, setVisibleFoodCount] = useState(3);
  const [view, setView] = useState<PanelView>("suburb");
  const [loadingMessage, setLoadingMessage] = useState(LOADING_MESSAGES[0].text);

  const lastFetchRef = useRef<number>(0);
  const FETCH_COOLDOWN_MS = 3000;

  // Sync state when URL params change (e.g. user hits back button)
  useEffect(() => {
    const city = searchParams.get("city") as CityName;
    const sub = searchParams.get("suburb");
    if (city && city !== selectedCity) setSelectedCity(city);
    if (sub && sub !== (suburb?.name || searchInput) && !loadingSuburb) {
      setSearchInput(sub);
      fetchSuburb(sub, city);
    }
  }, [searchParams]);

  useEffect(() => {
    if (!loadingSuburb) {
      setLoadingMessage(LOADING_MESSAGES[0].text);
      return;
    }
    const timers = LOADING_MESSAGES.slice(1).map(({ after, text }) =>
      setTimeout(() => setLoadingMessage(text), after)
    );
    return () => timers.forEach(clearTimeout);
  }, [loadingSuburb]);

  const mapUrl = selectedVenue
    ? getVenueMapUrl(selectedVenue.lat, selectedVenue.lng)
    : suburb
      ? getSuburbMapUrl(suburb.name, selectedCity)
      : getDefaultMapUrl(selectedCity);

  function resetSectionData() {
    setVisibleFoodCount(3);
    setSelectedVenue(null);
  }

  function handleCityChange(city: CityName) {
    setSelectedCity(city);
    setSuburb(null);
    setErrorSuburb(null);
    setSearchInput("");
    setView("suburb");
    resetSectionData();
    router.push(`/?city=${city}`);
  }

  async function fetchSuburb(suburbName?: string, overrideCity?: CityName) {
    const now = Date.now();
    if (now - lastFetchRef.current < FETCH_COOLDOWN_MS) return;
    lastFetchRef.current = now;

    const cityToUse = overrideCity || selectedCity;

    setLoadingSuburb(true);
    setErrorSuburb(null);
    setView("suburb");
    setIsSearching(true);
    resetSectionData();

    const params = new URLSearchParams({ city: cityToUse });
    if (suburbName) params.set("suburb", suburbName);

    try {
      const res = await fetch(`/api/explore?${params}`);
      const data: SuburbData & { error?: string } = await res.json();
      if (!res.ok || data.error)
        throw new Error(data.error ?? `Server error (${res.status})`);

      setSuburb(data);
      setSearchInput(data.name);
      router.push(`/?city=${cityToUse}&suburb=${encodeURIComponent(data.name)}`);
    } catch (err) {
      setErrorSuburb(
        err instanceof Error
          ? err.message
          : "Something went wrong. Give it another crack!",
      );
    } finally {
      setLoadingSuburb(false);
    }
  }

  function handleLoadMoreFood() {
    setVisibleFoodCount((prev) => prev + 3);
  }

  function handleVenueClick(v: { lat?: number; lng?: number }) {
    if (v.lat && v.lng) {
      setSelectedVenue({ lat: v.lat, lng: v.lng });
    }
  }

  function handleTabClick(tabId: PanelView) {
    setView(tabId);
  }

  function handleSearchSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = searchInput.trim();
    if (trimmed) fetchSuburb(trimmed);
  }

  const cityMeta = CITIES.find((c) => c.name === selectedCity)!;

  const allVenues = useMemo(() => {
    if (!suburb) return [];
    const llmRecs = suburb.restaurant_recommendations;
    const llmNames = new Set(llmRecs.map(r => r.name.toLowerCase()));
    
    const extraRecs = (suburb.rawVenues || [])
      .filter(v => !llmNames.has(v.name.toLowerCase()))
      .map(v => {
        const cat = v.category.toLowerCase();
        const spot = cat === 'fast food' ? 'fast food spot' : cat;
        const description = v.cuisine 
          ? `A local ${spot} specializing in ${v.cuisine.replace(/_/g, ' ')}.`
          : `A popular local ${spot}.`;

        return {
          name: v.name,
          description,
          lat: v.lat,
          lng: v.lng
        };
      });
      
    return [...llmRecs, ...extraRecs];
  }, [suburb]);

  return (
    <main className="flex flex-col md:flex-row h-[100dvh] overflow-hidden">
      {/* Side panel — left side */}
      <aside className="w-full md:w-[460px] h-[55%] md:h-full shrink-0 flex flex-col bg-sky-50 border-b md:border-b-0 md:border-r border-sky-200 shadow-2xl z-10">
        {/* Panel header */}
        <div className={`bg-linear-to-br from-sky-200 to-indigo-200 px-4 md:px-5 ${isSearching ? "py-3 md:py-4" : "pt-5 pb-4 md:pt-6 md:pb-5"} shrink-0 transition-all duration-300`}>
          {!isSearching && (
            <>
              <h1 className="leading-none">
                <span className="block text-4xl font-black tracking-tight bg-linear-to-r from-sky-600 to-indigo-600 bg-clip-text text-transparent">
                  Suburb Surfer
                </span>
              </h1>
              <p className="text-slate-500 text-sm mt-2">
                Discover your next adventure across Australia's never-ending
                urban sprawl.
              </p>
            </>
          )}

          <div className={`space-y-3 ${!isSearching ? "mt-4" : ""}`}>
            {/* City selector */}
            <select
              value={selectedCity}
              onChange={(e) => handleCityChange(e.target.value as CityName)}
              className="w-full py-2 px-3 rounded-xl text-sm font-semibold text-slate-700 bg-white/70 border border-white/50 focus:outline-none focus:ring-2 focus:ring-indigo-300 cursor-pointer"
            >
              {CITIES.map((city) => (
                <option key={city.name} value={city.name}>
                  {city.name}, {city.state}
                </option>
              ))}
            </select>

            {isSearching && (
              <div className="flex gap-2">
                <button
                  onClick={() => fetchSuburb()}
                  disabled={loadingSuburb}
                  className="px-4 rounded-xl font-semibold text-sm text-white bg-indigo-500 hover:bg-indigo-600 transition-all duration-200 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer flex items-center justify-center"
                  title="Random Suburb"
                >
                  🎲
                </button>
                <form onSubmit={handleSearchSubmit} className="flex-1 flex gap-2">
                  <input
                    type="text"
                    value={searchInput}
                    onChange={(e) => setSearchInput(e.target.value)}
                    placeholder="Search suburbs…"
                    disabled={loadingSuburb}
                    className="flex-1 py-2 px-4 rounded-xl text-sm text-slate-800 bg-white/80 border border-white/50 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-300 disabled:opacity-50"
                  />
                  <button
                    type="submit"
                    disabled={loadingSuburb || !searchInput.trim()}
                    className="py-2 px-4 rounded-xl font-semibold text-sm text-white bg-indigo-500 hover:bg-indigo-600 transition-all duration-200 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                  >
                    Go
                  </button>
                </form>
              </div>
            )}
          </div>
        </div>

        {/* LOADING STATE */}
        {loadingSuburb && (
          <div className="flex-1 flex flex-col items-center justify-center p-8 gap-5">
            <div className="w-11 h-11 rounded-full border-4 border-indigo-200 border-t-indigo-500 animate-spin" />
            <p className="text-sm text-slate-500 text-center leading-snug max-w-[16rem]">
              {loadingMessage}
            </p>
          </div>
        )}

        {/* VIEWS */}
        {!loadingSuburb && view === "suburb" && (
          <OverviewView 
            suburb={suburb} 
            selectedCity={selectedCity} 
            cityMeta={cityMeta} 
            fetchSuburb={fetchSuburb} 
            loadingSuburb={loadingSuburb} 
            searchInput={searchInput} 
            setSearchInput={setSearchInput} 
            handleSearchSubmit={handleSearchSubmit} 
            isSearching={isSearching} 
            errorSuburb={errorSuburb} 
          />
        )}
        
        {/* Error state that needs to show even in overview if there's no suburb */}
        {!loadingSuburb && view === "suburb" && errorSuburb && !suburb && (
          <div className="p-4 mx-4 md:mx-5 rounded-xl bg-rose-100 border border-rose-200 text-rose-700 text-sm leading-snug">
            {errorSuburb}
          </div>
        )}

        {!loadingSuburb && view === "food" && (
          <FoodView 
            suburb={suburb} 
            allVenues={allVenues} 
            visibleFoodCount={visibleFoodCount} 
            handleLoadMoreFood={handleLoadMoreFood} 
            handleVenueClick={handleVenueClick} 
          />
        )}

        {!loadingSuburb && view === "history" && (
          <HistoryView suburb={suburb} />
        )}

        {!loadingSuburb && view === "demographics" && (
          <DemographicsView suburb={suburb} />
        )}

        {/* SECTION TAB STRIP */}
        {suburb && !loadingSuburb && (
          <div className="shrink-0 px-4 py-3 bg-sky-50 border-t border-sky-200 flex gap-2">
            {TABS.map((tab) => {
              const isActive = view === tab.id;
              const activeClass =
                tab.id === "suburb" ? "bg-indigo-100 text-indigo-700" :
                tab.id === "food" ? "bg-orange-100 text-orange-700" :
                tab.id === "history" ? "bg-stone-200 text-stone-700" :
                "bg-rose-100 text-rose-700";

              return (
                <button
                  key={tab.id}
                  onClick={() => handleTabClick(tab.id)}
                  className={`flex-1 py-2.5 flex flex-col items-center gap-0.5 rounded-xl text-xs font-semibold transition-all duration-150 cursor-pointer ${isActive ? activeClass : "text-slate-500 hover:bg-slate-100"}`}
                >
                  <span className="text-base leading-none">{tab.icon}</span>
                  {tab.label}
                </button>
              );
            })}
          </div>
        )}
      </aside>

      {/* Full-screen interactive map with share buttons */}
      <MapDisplay mapUrl={mapUrl} />
    </main>
  );
}
