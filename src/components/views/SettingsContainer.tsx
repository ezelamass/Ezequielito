import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { Cog, FlaskConical, History, Info, Sparkles, Cpu } from "lucide-react";
import HandyHand from "../icons/HandyHand";
import { useSettings } from "../../hooks/useSettings";
import {
  GeneralSettings,
  AdvancedSettings,
  HistorySettings,
  DebugSettings,
  AboutSettings,
  PostProcessingSettings,
  ModelsSettings,
} from "../settings";

/**
 * Phase 13: Settings container with nested vertical nav.
 *
 * Hosts the six (or seven, w/ Debug + Post Process) original Handy
 * sections, gated by the same `enabled` predicates as before. The
 * outer top-level sidebar is owned by `Sidebar.tsx`; this component
 * just owns its sub-section state.
 */

type SubSection =
  | "general"
  | "models"
  | "advanced"
  | "history"
  | "postprocessing"
  | "debug"
  | "about";

interface SubSectionConfig {
  id: SubSection;
  labelKey: string;
  icon: React.ComponentType<any>;
  component: React.ComponentType;
  enabled: (settings: any) => boolean;
}

const SUB_SECTIONS: SubSectionConfig[] = [
  {
    id: "general",
    labelKey: "sidebar.general",
    icon: HandyHand,
    component: GeneralSettings,
    enabled: () => true,
  },
  {
    id: "models",
    labelKey: "sidebar.models",
    icon: Cpu,
    component: ModelsSettings,
    enabled: () => true,
  },
  {
    id: "advanced",
    labelKey: "sidebar.advanced",
    icon: Cog,
    component: AdvancedSettings,
    enabled: () => true,
  },
  {
    id: "history",
    labelKey: "sidebar.history",
    icon: History,
    component: HistorySettings,
    enabled: () => true,
  },
  {
    id: "postprocessing",
    labelKey: "sidebar.postProcessing",
    icon: Sparkles,
    component: PostProcessingSettings,
    enabled: (settings) => settings?.post_process_enabled ?? false,
  },
  {
    id: "debug",
    labelKey: "sidebar.debug",
    icon: FlaskConical,
    component: DebugSettings,
    enabled: (settings) => settings?.debug_mode ?? false,
  },
  {
    id: "about",
    labelKey: "sidebar.about",
    icon: Info,
    component: AboutSettings,
    enabled: () => true,
  },
];

export const SettingsContainer: React.FC = () => {
  const { t } = useTranslation();
  const { settings } = useSettings();
  const [active, setActive] = useState<SubSection>("general");

  const available = SUB_SECTIONS.filter((s) => s.enabled(settings));
  const Active = available.find((s) => s.id === active)?.component
    ?? GeneralSettings;

  return (
    <div className="w-full max-w-5xl flex gap-6">
      <nav className="flex flex-col gap-1 w-40 shrink-0 sticky top-4 self-start">
        {available.map((s) => {
          const Icon = s.icon;
          const isActive = active === s.id;
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => setActive(s.id)}
              className={`flex gap-2 items-center p-2 rounded-lg cursor-pointer text-left transition-colors ${
                isActive
                  ? "bg-logo-primary/80 text-bg"
                  : "hover:bg-mid-gray/20 opacity-85 hover:opacity-100"
              }`}
            >
              <Icon width={18} height={18} className="shrink-0" />
              <span className="text-sm font-medium truncate">
                {t(s.labelKey)}
              </span>
            </button>
          );
        })}
      </nav>

      <div className="flex-1 min-w-0">
        <Active />
      </div>
    </div>
  );
};
