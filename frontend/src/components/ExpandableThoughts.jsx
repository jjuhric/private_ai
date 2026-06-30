import React, { useState, useEffect } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';

export default function ExpandableThoughts({ thoughts, defaultExpanded = false }) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  useEffect(() => {
    setExpanded(defaultExpanded);
  }, [defaultExpanded]);

  if (!thoughts) return null;

  // Clean up reasoning tokens from output text
  const cleanedThoughts = thoughts
    .replace(/<\|channel>thought/g, '')
    .replace(/<channel\|>/g, '')
    .replace(/<think>/g, '')
    .replace(/<\/think>/g, '')
    .replace(/Thinking Process:/gi, '')
    .trim();

  if (!cleanedThoughts) return null;

  return (
    <div className="thoughts-container">
      <div className="thoughts-header" onClick={() => setExpanded(!expanded)}>
        <span>🧠 Agent Plan & Internal Thoughts</span>
        {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
      </div>
      {expanded && (
        <div className="thoughts-content">
          {cleanedThoughts}
        </div>
      )}
    </div>
  );
}
