import React, { useState, useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';

function PainterCarousel() {
  const toolOutput = window.openai?.toolOutput;
  const [currentIndex, setCurrentIndex] = useState(0);
  const [displayMode, setDisplayMode] = useState(window.openai?.displayMode || 'inline');
  const scrollRef = useRef(null);

  useEffect(() => {
    const handleSetGlobals = (event) => {
      if (event.detail?.globals?.displayMode) {
        setDisplayMode(event.detail.globals.displayMode);
      }
    };
    window.addEventListener('openai:set_globals', handleSetGlobals);
    return () => window.removeEventListener('openai:set_globals', handleSetGlobals);
  }, []);

  if (!toolOutput || toolOutput.type !== 'painter_list') {
    return (
      <div className="p-6 text-gray-500">
        Loading painters...
      </div>
    );
  }

  const { painters, location, total } = toolOutput;

  const scrollToIndex = (index) => {
    if (scrollRef.current) {
      const cardWidth = scrollRef.current.children[0]?.offsetWidth || 300;
      const gap = 16; // gap-4 = 16px
      scrollRef.current.scrollTo({
        left: index * (cardWidth + gap),
        behavior: 'smooth'
      });
    }
    setCurrentIndex(index);
  };

  const handleScroll = () => {
    if (scrollRef.current) {
      const scrollLeft = scrollRef.current.scrollLeft;
      const cardWidth = scrollRef.current.children[0]?.offsetWidth || 300;
      const gap = 16;
      const newIndex = Math.round(scrollLeft / (cardWidth + gap));
      setCurrentIndex(newIndex);
    }
  };

  const handleContactPainter = (painter) => {
    if (painter.whatsapp) {
      window.openai?.sendFollowupTurn({
        prompt: `I'd like to contact ${painter.name} to get a quote`
      });
    }
  };

  return (
    <div className={`${displayMode === 'fullscreen' ? 'min-h-screen' : ''} bg-gradient-to-br from-blue-50 to-indigo-50 p-4`}>
      <div className="max-w-6xl mx-auto">

        {/* Header */}
        <div className="mb-6">
          <h2 className="text-2xl font-bold text-gray-900 mb-2">
            Top Painters in {location.area || location.region || `Postcode ${location.postcode}`}
          </h2>
          <p className="text-gray-600">
            Found {total} highly-rated painter{total !== 1 ? 's' : ''} • Swipe to browse
          </p>
        </div>

        {/* Carousel */}
        <div className="relative">
          {/* Navigation Arrows */}
          {painters.length > 1 && (
            <>
              <button
                onClick={() => scrollToIndex(Math.max(0, currentIndex - 1))}
                disabled={currentIndex === 0}
                className={`absolute left-0 top-1/2 -translate-y-1/2 z-10 w-10 h-10 rounded-full bg-white shadow-lg flex items-center justify-center transition-all ${
                  currentIndex === 0 ? 'opacity-0 pointer-events-none' : 'opacity-100 hover:bg-gray-50'
                }`}
              >
                ←
              </button>
              <button
                onClick={() => scrollToIndex(Math.min(painters.length - 1, currentIndex + 1))}
                disabled={currentIndex === painters.length - 1}
                className={`absolute right-0 top-1/2 -translate-y-1/2 z-10 w-10 h-10 rounded-full bg-white shadow-lg flex items-center justify-center transition-all ${
                  currentIndex === painters.length - 1 ? 'opacity-0 pointer-events-none' : 'opacity-100 hover:bg-gray-50'
                }`}
              >
                →
              </button>
            </>
          )}

          {/* Cards Container */}
          <div
            ref={scrollRef}
            onScroll={handleScroll}
            className="flex overflow-x-auto gap-4 pb-4 snap-x snap-mandatory scrollbar-hide"
            style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
          >
            {painters.map((painter, idx) => (
              <div
                key={painter.id}
                className="flex-none w-full sm:w-[calc(50%-0.5rem)] lg:w-[calc(33.333%-0.67rem)] snap-start"
              >
                <div className="bg-white rounded-xl shadow-lg overflow-hidden h-full hover:shadow-xl transition-shadow">

                  {/* Card Header with Rank Badge */}
                  <div className="relative bg-gradient-to-r from-blue-600 to-indigo-600 px-6 py-4">
                    <div className="absolute top-2 right-2">
                      <div className="bg-yellow-400 text-yellow-900 font-bold text-sm px-3 py-1 rounded-full">
                        #{idx + 1}
                      </div>
                    </div>
                    <h3 className="text-xl font-bold text-white pr-12">{painter.name}</h3>
                    {painter.owner && (
                      <p className="text-blue-100 text-sm mt-1">{painter.owner}</p>
                    )}
                  </div>

                  {/* Stats Row */}
                  <div className="grid grid-cols-3 gap-2 px-6 py-4 bg-gray-50 border-b">
                    <div className="text-center">
                      <div className="flex items-center justify-center gap-1">
                        <span className="text-yellow-500 text-lg">★</span>
                        <span className="font-bold text-gray-900">{painter.rating.toFixed(1)}</span>
                      </div>
                      <p className="text-xs text-gray-500 mt-1">Rating</p>
                    </div>
                    <div className="text-center border-x border-gray-200">
                      <div className="font-bold text-gray-900">{painter.reviews}</div>
                      <p className="text-xs text-gray-500 mt-1">Reviews</p>
                    </div>
                    <div className="text-center">
                      <div className="font-bold text-gray-900">{painter.jobs_won}</div>
                      <p className="text-xs text-gray-500 mt-1">Jobs Won</p>
                    </div>
                  </div>

                  {/* Location */}
                  <div className="px-6 py-3 border-b">
                    <div className="flex items-start gap-2">
                      <span className="text-gray-400 mt-0.5">📍</span>
                      <div className="text-sm text-gray-700">
                        {painter.location.suburb && <div className="font-medium">{painter.location.suburb}</div>}
                        <div className="text-gray-500">{painter.location.area}, {painter.location.region}</div>
                      </div>
                    </div>
                  </div>

                  {/* Score Badge */}
                  <div className="px-6 py-3 bg-green-50 border-b">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-gray-600">Match Score</span>
                      <div className="flex items-center gap-2">
                        <div className="bg-green-500 h-2 rounded-full" style={{ width: `${painter.score * 100}px`, maxWidth: '100px' }}></div>
                        <span className="font-bold text-green-700">{(painter.score * 100).toFixed(0)}%</span>
                      </div>
                    </div>
                  </div>

                  {/* Action Buttons */}
                  <div className="px-6 py-4 space-y-2">
                    <button
                      onClick={() => handleContactPainter(painter)}
                      className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 px-4 rounded-lg transition-colors flex items-center justify-center gap-2"
                    >
                      <span>💬</span>
                      Get Quote from {painter.name.split(' ')[0]}
                    </button>

                    {painter.profile_url && (
                      <a
                        href={painter.profile_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block w-full bg-gray-100 hover:bg-gray-200 text-gray-700 font-medium py-2 px-4 rounded-lg transition-colors text-center text-sm"
                      >
                        View Full Profile →
                      </a>
                    )}
                  </div>

                  {/* Engagement Rate (if high) */}
                  {painter.engagement_rate > 70 && (
                    <div className="px-6 pb-4">
                      <div className="bg-yellow-50 border border-yellow-200 rounded-lg px-3 py-2 text-xs">
                        <span className="text-yellow-800">⚡ Quick to respond - {painter.engagement_rate}% engagement rate</span>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Dots Indicator */}
          {painters.length > 1 && (
            <div className="flex justify-center gap-2 mt-4">
              {painters.map((_, idx) => (
                <button
                  key={idx}
                  onClick={() => scrollToIndex(idx)}
                  className={`h-2 rounded-full transition-all ${
                    idx === currentIndex 
                      ? 'bg-blue-600 w-8' 
                      : 'bg-gray-300 w-2 hover:bg-gray-400'
                  }`}
                />
              ))}
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="mt-6 flex gap-3 justify-center">
          <button
            onClick={() => window.openai?.sendFollowupTurn({
              prompt: "I'd like to create a job request with these painters"
            })}
            className="px-6 py-3 bg-green-600 hover:bg-green-700 text-white font-semibold rounded-lg transition-colors"
          >
            Create Job Request
          </button>

          {displayMode !== 'fullscreen' && (
            <button
              onClick={() => window.openai?.requestDisplayMode({ mode: 'fullscreen' })}
              className="px-6 py-3 bg-white border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition-colors"
            >
              View Fullscreen
            </button>
          )}
        </div>
      </div>

      <style jsx>{`
        .scrollbar-hide::-webkit-scrollbar {
          display: none;
        }
      `}</style>
    </div>
  );
}

// Mount component
const root = document.getElementById('root');
if (root) {
  createRoot(root).render(<PainterCarousel />);
}