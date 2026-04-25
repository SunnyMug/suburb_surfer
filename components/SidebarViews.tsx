import { useMemo } from "react";
import { SuburbData, CityName } from "../lib/types";
import { prepareDemographicsData } from "../lib/utils";
import { DemographicsChart } from "./DemographicsChart";
import { COLORS_ANCESTRY, COLORS_LANGUAGE } from "../lib/types";

export function OverviewView({ suburb, selectedCity, cityMeta, fetchSuburb, loadingSuburb, searchInput, setSearchInput, handleSearchSubmit, isSearching }: any) {
  if (isSearching && !suburb) return null;
  return (
    <div className="flex-1 overflow-y-auto p-4 md:p-5 space-y-4">
      {!isSearching && (
        <>
          <button
            onClick={() => fetchSuburb()}
            disabled={loadingSuburb}
            className="w-full py-3.5 px-6 rounded-xl font-semibold text-base text-white bg-indigo-500 hover:bg-indigo-600 shadow-md shadow-indigo-200 transition-all duration-200 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          >
            Where should I go?
          </button>
          <div className="flex items-center gap-3">
            <div className="flex-1 h-px bg-slate-200" />
            <span className="text-xs text-slate-400 font-medium shrink-0">or search</span>
            <div className="flex-1 h-px bg-slate-200" />
          </div>
          <form onSubmit={handleSearchSubmit} className="flex gap-2">
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="e.g. Newtown, Manly…"
              disabled={loadingSuburb}
              className="flex-1 py-2.5 px-4 rounded-xl text-sm text-slate-800 bg-white border border-slate-200 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-transparent disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={loadingSuburb || !searchInput.trim()}
              className="py-2.5 px-4 rounded-xl font-semibold text-sm text-white bg-indigo-500 hover:bg-indigo-600 transition-all duration-200 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            >
              Go
            </button>
          </form>
        </>
      )}

      {suburb && (
        <div className="space-y-5">
          <div className="flex flex-col gap-4">
            {suburb.image_url && (
              <img src={suburb.image_url} alt={suburb.name} className="w-full aspect-video rounded-2xl object-cover shadow-md border-2 border-white" />
            )}
            <div className="text-center">
              <h2 className="text-3xl font-extrabold text-slate-800 tracking-tight">{suburb.name}</h2>
              <span className="mt-2 inline-block text-xs font-semibold text-indigo-600 bg-indigo-100 px-3 py-1 rounded-full">
                {selectedCity}, {cityMeta.state}
              </span>
              <div className="mt-4">
                <a 
                  href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(suburb.name + ', ' + selectedCity + ', Australia')}`} 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-4 py-2 bg-indigo-50 text-indigo-700 font-semibold text-sm rounded-full shadow-sm hover:bg-indigo-100 transition-colors"
                >
                  🚗 Directions to {suburb.name}
                </a>
              </div>
            </div>
          </div>
          <p className="text-slate-600 text-base leading-relaxed">{suburb.summary}</p>
          <div className="bg-violet-50 border border-violet-200 rounded-xl p-4">
            <h3 className="text-xs font-bold uppercase tracking-widest text-violet-700 mb-2">Name Origin</h3>
            <p className="text-sm text-slate-700 leading-relaxed">{suburb.name_etymology}</p>
          </div>
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
            <h3 className="text-xs font-bold uppercase tracking-widest text-amber-700 mb-3">Fun Facts</h3>
            <ul className="space-y-3">
              {suburb.fun_facts.map((fact: string, i: number) => (
                <li key={i} className="flex gap-2.5 text-sm text-slate-700 leading-snug">
                  <span className="text-amber-500 shrink-0 mt-0.5">✦</span>{fact}
                </li>
              ))}
            </ul>
          </div>
          <div className="bg-teal-50 border border-teal-200 rounded-xl p-4">
            <h3 className="text-xs font-bold uppercase tracking-widest text-teal-700 mb-3">Local Attractions</h3>
            <ul className="space-y-3">
              {suburb.local_attractions.map((attraction: string, i: number) => (
                <li key={i} className="flex gap-2.5 text-sm text-slate-700 leading-snug">
                  <span className="text-teal-500 shrink-0 mt-0.5">📍</span>{attraction}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}

export function FoodView({ suburb, allVenues, visibleFoodCount, handleLoadMoreFood, handleVenueClick }: any) {
  if (!suburb) return null;
  return (
    <div className="flex-1 overflow-y-auto p-4 md:p-5 space-y-4">
      <div className="text-center">
        <h2 className="text-2xl font-extrabold text-slate-800 tracking-tight">Food in {suburb.name}</h2>
        <span className="mt-1.5 inline-block text-xs font-semibold text-orange-600 bg-orange-100 px-3 py-1 rounded-full">Local eats</span>
      </div>

      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
        <h3 className="text-xs font-bold uppercase tracking-widest text-amber-700 mb-3">Local Cuisine</h3>
        <div className="flex flex-wrap gap-2">
          {suburb.cuisine_types.map((cuisine: string, i: number) => {
            const palettes = ["bg-orange-100 text-orange-800 border-orange-200", "bg-amber-100 text-amber-800 border-amber-200", "bg-yellow-100 text-yellow-800 border-yellow-200", "bg-lime-100 text-lime-800 border-lime-200", "bg-teal-100 text-teal-800 border-teal-200"];
            return (
              <span key={i} className={`text-sm font-semibold border px-3 py-1 rounded-full ${palettes[i % palettes.length]}`}>
                {cuisine}
              </span>
            );
          })}
        </div>
      </div>

      <div className="bg-orange-50 border border-orange-200 rounded-xl p-4">
        <h3 className="text-xs font-bold uppercase tracking-widest text-orange-700 mb-3">Where to Eat</h3>
        {suburb.venuesAvailable ? (
          <>
            <ul className="space-y-4">
              {allVenues.slice(0, visibleFoodCount).map((r: any, i: number) => (
                <li key={i} className={`space-y-0.5 p-2 -mx-2 rounded-lg transition-colors ${r.lat ? 'cursor-pointer hover:bg-orange-100' : ''}`} onClick={() => handleVenueClick(r)}>
                  <div className="flex justify-between items-start">
                    <p className="text-sm font-semibold text-slate-800">
                      {r.name} {r.lat && <span className="text-xs text-orange-400 ml-1">📍</span>}
                    </p>
                    {r.lat && r.lng && (
                      <a 
                        href={`https://www.google.com/maps/dir/?api=1&destination=${r.lat},${r.lng}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="shrink-0 ml-2 text-xs font-semibold text-indigo-600 bg-indigo-50 hover:bg-indigo-100 px-2 py-1 rounded-md transition-colors"
                        onClick={(e) => e.stopPropagation()}
                      >
                        🚗 Go
                      </a>
                    )}
                  </div>
                  <p className="text-sm text-slate-600 leading-snug">{r.description}</p>
                </li>
              ))}
            </ul>
            {visibleFoodCount < allVenues.length && (
              <button onClick={handleLoadMoreFood} className="mt-5 w-full py-2.5 px-4 rounded-xl font-semibold text-sm text-orange-700 bg-orange-100 hover:bg-orange-200 border border-orange-200 transition-all duration-200 active:scale-95 cursor-pointer">
                Load More Recs
              </button>
            )}
          </>
        ) : (
          <div className="flex flex-col items-center gap-2 py-4 text-center">
            <span className="text-2xl">🍽️</span>
            <p className="text-sm font-semibold text-orange-800">Venue data unavailable</p>
            <p className="text-xs text-orange-700 leading-snug">We had trouble finding venues for this suburb right now. Give it another go in a moment.</p>
          </div>
        )}
      </div>
    </div>
  );
}

export function HistoryView({ suburb }: any) {
  if (!suburb) return null;
  return (
    <div className="flex-1 overflow-y-auto p-4 md:p-5 space-y-4">
      <div className="text-center">
        <h2 className="text-2xl font-extrabold text-slate-800 tracking-tight">History of {suburb.name}</h2>
        <span className="mt-1.5 inline-block text-xs font-semibold text-stone-600 bg-stone-200 px-3 py-1 rounded-full">Local history</span>
      </div>

      <div className="space-y-5">
        <div className="bg-stone-50 border border-stone-200 rounded-xl p-4">
          <h3 className="text-xs font-bold uppercase tracking-widest text-stone-600 mb-4">Key Events</h3>
          <ul className="space-y-3">
            {suburb.key_events.map((e: any, i: number) => (
              <li key={i} className="flex gap-3 items-start">
                <span className="shrink-0 text-xs font-bold text-stone-500 bg-stone-200 px-2 py-0.5 rounded-md mt-0.5 tabular-nums">{e.year}</span>
                <p className="text-sm text-slate-700 leading-snug">{e.event}</p>
              </li>
            ))}
          </ul>
        </div>

        <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4">
          <h3 className="text-xs font-bold uppercase tracking-widest text-yellow-700 mb-3">Notable People</h3>
          <ul className="space-y-3">
            {suburb.notable_people.map((p: any, i: number) => (
              <li key={i} className="space-y-0.5">
                <p className="text-sm font-semibold text-slate-800">{p.name}</p>
                <p className="text-sm text-slate-600 leading-snug">{p.role}</p>
              </li>
            ))}
          </ul>
        </div>

        <div className="bg-lime-50 border border-lime-200 rounded-xl p-4">
          <h3 className="text-xs font-bold uppercase tracking-widest text-lime-700 mb-3">Heritage Sites</h3>
          <ul className="space-y-2">
            {suburb.heritage_sites.map((site: string, i: number) => {
              const cleanName = site.split(/,\s*\d+| \(/)[0].trim();
              return (
                <li key={i} className="flex gap-2.5 text-sm text-slate-700 leading-snug">
                  <span className="text-lime-600 shrink-0 mt-0.5">🏛️</span>{cleanName}
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </div>
  );
}

export function DemographicsView({ suburb }: any) {
  if (!suburb) return null;
  const ancestriesData = prepareDemographicsData(suburb?.demographics?.top_ancestries);
  const languagesData = prepareDemographicsData(suburb?.demographics?.top_languages);

  return (
    <div className="flex-1 overflow-y-auto p-4 md:p-5 space-y-4">
      <div className="text-center">
        <h2 className="text-2xl font-extrabold text-slate-800 tracking-tight">Community of {suburb.name}</h2>
        <span className="mt-1.5 inline-block text-xs font-semibold text-rose-600 bg-rose-100 px-3 py-1 rounded-full">Demographics</span>
      </div>

      {suburb.demographics ? (
        <div className="space-y-5">
          <div className="bg-rose-50 border border-rose-200 rounded-xl p-4 text-center">
            <h3 className="text-xs font-bold uppercase tracking-widest text-rose-700 mb-1">Population</h3>
            <p className="text-3xl font-black text-rose-600">{suburb.demographics.population}</p>
          </div>

          <div className="bg-fuchsia-50 border border-fuchsia-200 rounded-xl p-4">
            <h3 className="text-xs font-bold uppercase tracking-widest text-fuchsia-700 mb-3">Top Ancestries</h3>
            <div className="flex items-center gap-3">
              <div className="w-[45%] shrink-0">
                <DemographicsChart data={ancestriesData} colors={COLORS_ANCESTRY} />
              </div>
              <ul className="flex-1 space-y-2.5">
                {ancestriesData.map((a, i) => {
                  const isOther = a.name === 'Other';
                  const color = isOther ? COLORS_ANCESTRY[COLORS_ANCESTRY.length - 1] : COLORS_ANCESTRY[i % (COLORS_ANCESTRY.length - 1)];
                  return (
                    <li key={i} className={`flex justify-between items-start text-sm ${isOther ? 'opacity-80' : ''}`}>
                      <div className="flex items-start gap-2 pt-0.5">
                        <span className="w-2.5 h-2.5 rounded-full shrink-0 mt-1" style={{ backgroundColor: color }} />
                        <span className={`font-semibold text-slate-800 leading-tight ${isOther ? 'italic text-slate-600' : ''}`}>{a.name}</span>
                      </div>
                      <span className={`font-bold px-1.5 py-0.5 rounded-md ml-2 shrink-0 ${isOther ? 'text-slate-600 bg-slate-200/50' : 'text-fuchsia-700 bg-fuchsia-200/50'}`}>{a.percentage}%</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>

          <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
            <h3 className="text-xs font-bold uppercase tracking-widest text-blue-700 mb-3">Top Languages</h3>
            <div className="flex items-center gap-3">
              <div className="w-[45%] shrink-0">
                <DemographicsChart data={languagesData} colors={COLORS_LANGUAGE} />
              </div>
              <ul className="flex-1 space-y-2.5">
                {languagesData.map((l, i) => {
                  const isOther = l.name === 'Other';
                  const color = isOther ? COLORS_LANGUAGE[COLORS_LANGUAGE.length - 1] : COLORS_LANGUAGE[i % (COLORS_LANGUAGE.length - 1)];
                  return (
                    <li key={i} className={`flex justify-between items-start text-sm ${isOther ? 'opacity-80' : ''}`}>
                      <div className="flex items-start gap-2 pt-0.5">
                        <span className="w-2.5 h-2.5 rounded-full shrink-0 mt-1" style={{ backgroundColor: color }} />
                        <span className={`font-semibold text-slate-800 leading-tight ${isOther ? 'italic text-slate-600' : ''}`}>{l.name}</span>
                      </div>
                      <span className={`font-bold px-1.5 py-0.5 rounded-md ml-2 shrink-0 ${isOther ? 'text-slate-600 bg-slate-200/50' : 'text-blue-700 bg-blue-200/50'}`}>{l.percentage}%</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>

          <div className="pt-2 text-center">
            <p className="text-[11px] text-slate-400 font-medium uppercase tracking-wider">
              Source: {suburb.demographics.data_source || "Census Data"} ({suburb.demographics.data_year || "2021"})
            </p>
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-2 py-8 text-center">
          <span className="text-2xl">🤷‍♂️</span>
          <p className="text-sm font-semibold text-rose-800">No demographic data found</p>
          <p className="text-xs text-rose-700 leading-snug">We couldn't find detailed census data for this suburb.</p>
        </div>
      )}
    </div>
  );
}
