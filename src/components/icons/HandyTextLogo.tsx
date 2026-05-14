import React from "react";

/**
 * Brand wordmark for Ezequielito.
 *
 * Renders the app name in Instrument Serif italic with the lime accent,
 * matching the ezequiellamas-landing identity.
 *
 * Used in Sidebar (small, 120px wide) and Onboarding (larger).
 * Preserves the original Handy `HandyTextLogo` interface (width/height/className)
 * so the existing call-sites don't need to change.
 */
const HandyTextLogo = ({
  width,
  height,
  className,
}: {
  width?: number;
  height?: number;
  className?: string;
}) => {
  // Wide aspect ratio to fit "Ezequielito" — viewBox ~930x200 keeps
  // similar proportions to the original Handy logo so sizing slots in.
  return (
    <svg
      width={width}
      height={height}
      className={className}
      viewBox="0 0 930 200"
      xmlns="http://www.w3.org/2000/svg"
    >
      <text
        x="465"
        y="140"
        textAnchor="middle"
        fontFamily="'Instrument Serif', Georgia, serif"
        fontStyle="italic"
        fontSize="160"
        fontWeight="400"
        fill="var(--color-ez-accent, #c8ff00)"
      >
        Ezequielito
      </text>
    </svg>
  );
};

export default HandyTextLogo;
