// Drawn UI icons for LAST STOP: one stroke weight, currentColor, sized by the
// em box so they sit inline with receipt-voice text. Replaces the emoji that
// used to stand in for these (emoji fonts are inconsistent across machines
// and off-voice for the clipboard aesthetic).
import React from "react";

function Svg({ size = 13, children, label }: { size?: number; children: React.ReactNode; label: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-label={label}
      role="img"
      style={{ verticalAlign: "-0.12em", marginRight: 4 }}
    >
      {children}
    </svg>
  );
}

export function CoffeeIcon(): React.ReactElement {
  return (
    <Svg label="coffee">
      <path d="M3 5.5h8v5a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3v-5Z" />
      <path d="M11 6.5h1.5a2 2 0 0 1 0 4H11" />
      <path d="M5 2.5c0 .8 1 .8 1 1.6M8 2.5c0 .8 1 .8 1 1.6" />
    </Svg>
  );
}

export function FlashlightIcon(): React.ReactElement {
  return (
    <Svg label="flashlight">
      <path d="M6 1.8h4v3l-1.5 2v7.4h-1V6.8L6 4.8v-3Z" />
      <path d="M8 7.2v1.6" />
    </Svg>
  );
}

export function VanIcon({ size = 13 }: { size?: number }): React.ReactElement {
  return (
    <Svg size={size} label="van">
      <path d="M1.5 4.5h7.2l2.6 3h2.2a1 1 0 0 1 1 1v3h-13v-7Z" />
      <circle cx="4.6" cy="12.4" r="1.5" />
      <circle cx="11.4" cy="12.4" r="1.5" />
    </Svg>
  );
}

export function AlertIcon(): React.ReactElement {
  return (
    <Svg label="warning">
      <path d="M8 2.2 14.4 13H1.6L8 2.2Z" />
      <path d="M8 6.6v3" />
      <path d="M8 11.6v.1" />
    </Svg>
  );
}
