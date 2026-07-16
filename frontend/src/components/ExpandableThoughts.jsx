import React, { useState, useEffect } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';

export default function ExpandableThoughts({ thoughts, defaultExpanded = false }) {
  // RULE 4 ENFORCEMENT: Force initial state to false so thoughts always start collapsed
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    // Enforce collapsed baseline on message updates
    setExpanded(false);
  }, [thoughts]);

  if (!thoughts) return null;

  const cleanedThoughts = thoughts
    .replace(/<\|channel>thought/g, '')
    .replace(/<channel\|>/g, '')
    .replace(/<think>/g, '')
    .replace(/<\/think>/g, '')
    .replace(/Thinking Process:/gi, '')
    .trim();

  if (!cleanedThoughts) return null;

  return (
    <div className="thoughts-container border border-base-300 rounded-lg my-2 bg-base-200">
      <div 
        className="thoughts-header flex items-center justify-between p-3 cursor-pointer select-none font-medium text-sm text-secondary" 
        onClick={() => setExpanded(!expanded)}
      >
        <span className="flex items-center gap-2">🧠 Agent Plan & Internal Thoughts</span>
        {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
      </div>
      {expanded && (
        <div className="thoughts-content p-4 border-t border-base-300 text-sm font-mono whitespace-pre-wrap max-h-60 overflow-y-auto bg-base-300 rounded-b-lg">
          {cleanedThoughts}
        </div>
      )}
    </div>
  );
}
