import React, { useState } from "react";
import { Snippets } from "../settings/Snippets";

/**
 * Phase 13 Snippets view — Wispr-style top-level page.
 */

type SnipTab = "all" | "personal" | "shared";

export const SnippetsView: React.FC = () => {
  const [tab, setTab] = useState<SnipTab>("all");

  return (
    <div className="w-full max-w-4xl mx-auto py-4 space-y-6">
      <header className="flex items-center justify-between">
        <h1 className="font-serif italic text-4xl text-ez-text">Snippets</h1>
      </header>

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

      <div className="border border-mid-gray/20 rounded-xl p-6 bg-mid-gray/5">
        <h2 className="font-serif italic text-2xl mb-2">
          Lo que <span className="not-italic">vos</span> no tenés que re-escribir.
        </h2>
        <p className="text-sm text-mid-gray max-w-2xl">
          Guardá cualquier cosa que tipeás seguido — tu email, un intro,
          un prompt — y decí una palabra o frase para reemplazarlo en el
          lugar.
        </p>
      </div>

      {tab === "shared" ? (
        <div className="text-mid-gray text-sm border border-mid-gray/20 rounded-lg p-6 text-center">
          Compartir con equipo todavía no está disponible.
        </div>
      ) : (
        <Snippets descriptionMode="inline" grouped={false} />
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
