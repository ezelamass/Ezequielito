import React, { useState } from "react";
import { CustomWords } from "../settings/CustomWords";

/**
 * Phase 13 Dictionary view — Wispr-style top-level page wrapping the
 * existing CustomWords component (which still works inside Settings).
 *
 * Tabs (All / Personal / Shared with team) are kept for visual parity
 * with Wispr Flow; "Shared" is a placeholder until we add team sync.
 */

type DictTab = "all" | "personal" | "shared";

export const DictionaryView: React.FC = () => {
  const [tab, setTab] = useState<DictTab>("all");

  return (
    <div className="w-full max-w-4xl mx-auto py-4 space-y-6">
      <header className="flex items-center justify-between">
        <h1 className="font-serif italic text-4xl text-ez-text">Dictionary</h1>
      </header>

      {/* Tabs */}
      <nav className="flex gap-6 border-b border-mid-gray/20">
        <TabButton active={tab === "all"} onClick={() => setTab("all")}>
          All
        </TabButton>
        <TabButton active={tab === "personal"} onClick={() => setTab("personal")}>
          Personal
        </TabButton>
        <TabButton active={tab === "shared"} onClick={() => setTab("shared")}>
          Shared with team
        </TabButton>
      </nav>

      {/* Promo card */}
      <div className="border border-mid-gray/20 rounded-xl p-6 bg-mid-gray/5">
        <h2 className="font-serif italic text-2xl mb-2">
          Ezequielito escribe como <span className="not-italic">vos</span>.
        </h2>
        <p className="text-sm text-mid-gray max-w-2xl">
          Agregá los nombres propios, jerga de tu industria, marcas de
          clientes. Cada dictado los respeta y los corrige automáticamente
          aunque el modelo los haya escuchado mal.
        </p>
      </div>

      {/* Content */}
      {tab === "shared" ? (
        <div className="text-mid-gray text-sm border border-mid-gray/20 rounded-lg p-6 text-center">
          Compartir con equipo todavía no está disponible. Sumalo en{" "}
          <span className="font-medium">Settings → Advanced</span> manualmente
          por ahora.
        </div>
      ) : (
        <CustomWords descriptionMode="inline" grouped={false} />
      )}
    </div>
  );
};

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`pb-2 px-1 text-sm font-medium transition-colors ${
        active
          ? "border-b-2 border-accent text-ez-text"
          : "text-mid-gray hover:text-ez-text"
      }`}
    >
      {children}
    </button>
  );
}
