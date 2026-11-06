"use client";

import { useState } from "react";

/** 1–5 star picker. */
export function StarRating({
  value,
  onChange,
  disabled = false,
}: {
  value: number;
  onChange: (rating: number) => void;
  disabled?: boolean;
}) {
  const [hover, setHover] = useState(0);
  const shown = hover || value;
  return (
    <div className="flex gap-1" role="radiogroup" aria-label="Rating, 1 to 5 stars" onMouseLeave={() => setHover(0)}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={value === n}
          aria-label={`${n} star${n === 1 ? "" : "s"}`}
          disabled={disabled}
          className={`grid size-12 cursor-pointer place-items-center border text-[26px] leading-none transition-colors disabled:cursor-not-allowed ${
            n <= shown ? "bg-cobalt" : "bg-transparent hover:bg-cobalt/40"
          }`}
          onMouseEnter={() => setHover(n)}
          onFocus={() => setHover(n)}
          onBlur={() => setHover(0)}
          onClick={() => onChange(n)}
        >
          {n <= shown ? "★" : "☆"}
        </button>
      ))}
    </div>
  );
}
