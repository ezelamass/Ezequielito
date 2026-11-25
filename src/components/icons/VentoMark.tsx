import React from "react";

/** The Vento mark: a V whose right arm launches a lime dot. */
const VentoMark = ({
  width = 24,
  height = 24,
  className,
}: {
  width?: number | string;
  height?: number | string;
  className?: string;
}) => (
  <svg
    width={width}
    height={height}
    className={className}
    viewBox="0 0 64 64"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
  >
    <g transform="translate(2.061 -2.956) scale(0.9694)">
      <path
        d="M7.633 18.273 L26.636 61.029 Q27.001 61.851 27.451 61.072 L45.607 29.626 Q45.957 29.020 45.351 28.670 L38.769 24.870 Q38.163 24.520 37.813 25.126 L27.369 43.216 Q27.119 43.649 26.916 43.192 L14.487 15.227 A3.750 3.750 0 0 0 7.633 18.273Z"
        fill="#F2EFE9"
      />
      <circle cx="47.66" cy="17.071" r="6.8" fill="#C8FF00" />
    </g>
  </svg>
);

export default VentoMark;
