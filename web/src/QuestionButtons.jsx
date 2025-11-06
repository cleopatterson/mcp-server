import React from 'react';
import { createRoot } from 'react-dom/client';

function QuestionButtons() {
  const toolOutput = window.openai?.toolOutput;

  if (!toolOutput || toolOutput.type !== 'question_with_buttons') {
    return (
      <div className="p-6 text-gray-500">
        Loading...
      </div>
    );
  }

  const { question, buttons, description } = toolOutput;

  const handleButtonClick = (buttonValue) => {
    window.openai?.sendFollowupTurn({
      prompt: buttonValue
    });
  };

  return (
    <div className="max-w-2xl mx-auto p-6">
      <div className="bg-white rounded-xl shadow-lg overflow-hidden">

        {/* Question Header */}
        <div className="bg-gradient-to-r from-blue-600 to-indigo-600 px-6 py-4">
          <h3 className="text-xl font-semibold text-white">
            {question}
          </h3>
          {description && (
            <p className="text-blue-100 text-sm mt-2">
              {description}
            </p>
          )}
        </div>

        {/* Button Grid */}
        <div className="p-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {buttons.map((button, index) => (
              <button
                key={index}
                onClick={() => handleButtonClick(button.value || button.label)}
                className="group relative overflow-hidden bg-gradient-to-r from-blue-50 to-indigo-50 hover:from-blue-600 hover:to-indigo-600 border-2 border-blue-200 hover:border-blue-600 rounded-lg px-6 py-4 transition-all duration-200 transform hover:scale-105 active:scale-95"
              >
                <div className="flex items-center justify-center gap-3">
                  {button.icon && (
                    <span className="text-2xl group-hover:scale-110 transition-transform">
                      {button.icon}
                    </span>
                  )}
                  <span className="font-semibold text-gray-700 group-hover:text-white transition-colors">
                    {button.label}
                  </span>
                </div>
                {button.description && (
                  <p className="text-xs text-gray-500 group-hover:text-blue-100 mt-2 transition-colors">
                    {button.description}
                  </p>
                )}
              </button>
            ))}
          </div>

          {/* Optional custom text input */}
          <div className="mt-4 pt-4 border-t border-gray-200">
            <button
              onClick={() => window.openai?.sendFollowupTurn({ prompt: "Let me type my own answer" })}
              className="w-full text-sm text-gray-500 hover:text-gray-700 py-2"
            >
              Or type your own answer →
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Mount component
const root = document.getElementById('root');
if (root) {
  createRoot(root).render(<QuestionButtons />);
}
