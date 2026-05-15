import React from "react";
import { useTranslation } from "react-i18next";
import {
  Home,
  BarChart3,
  BookOpen,
  Scissors,
  Type,
  Wand2,
  FileEdit,
  Settings as SettingsIcon,
} from "lucide-react";
import HandyTextLogo from "./icons/HandyTextLogo";

// Phase 13: new top-level views (Wispr Flow layout)
import { HomeView } from "./views/HomeView";
import { InsightsView } from "./views/InsightsView";
import { DictionaryView } from "./views/DictionaryView";
import { SnippetsView } from "./views/SnippetsView";
import { StyleView } from "./views/StyleView";
import { TransformsView } from "./views/TransformsView";
import { ScratchpadView } from "./views/ScratchpadView";
import { SettingsContainer } from "./views/SettingsContainer";

export type SidebarSection = keyof typeof SECTIONS_CONFIG;

interface IconProps {
  width?: number | string;
  height?: number | string;
  size?: number | string;
  className?: string;
  [key: string]: any;
}

interface SectionConfig {
  labelKey: string;
  icon: React.ComponentType<IconProps>;
  component: React.ComponentType;
  enabled: (settings: any) => boolean;
}

/**
 * Phase 13 — Wispr Flow layout.
 *
 * Sidebar is now 8 top-level items:
 *  Home / Insights / Dictionary / Snippets / Style / Transforms / Scratchpad / Settings
 *
 * The previous 6/7 settings sections (General, Models, Advanced, History,
 * Post Process, About, Debug) live as a nested sub-nav inside the
 * SettingsContainer component.
 */
export const SECTIONS_CONFIG = {
  home: {
    labelKey: "sidebar.home",
    icon: Home,
    component: HomeView,
    enabled: () => true,
  },
  insights: {
    labelKey: "sidebar.insights",
    icon: BarChart3,
    component: InsightsView,
    enabled: () => true,
  },
  dictionary: {
    labelKey: "sidebar.dictionary",
    icon: BookOpen,
    component: DictionaryView,
    enabled: () => true,
  },
  snippets: {
    labelKey: "sidebar.snippets",
    icon: Scissors,
    component: SnippetsView,
    enabled: () => true,
  },
  style: {
    labelKey: "sidebar.style",
    icon: Type,
    component: StyleView,
    enabled: () => true,
  },
  transforms: {
    labelKey: "sidebar.transforms",
    icon: Wand2,
    component: TransformsView,
    enabled: () => true,
  },
  scratchpad: {
    labelKey: "sidebar.scratchpad",
    icon: FileEdit,
    component: ScratchpadView,
    enabled: () => true,
  },
  settings: {
    labelKey: "sidebar.settings",
    icon: SettingsIcon,
    component: SettingsContainer,
    enabled: () => true,
  },
} as const satisfies Record<string, SectionConfig>;

interface SidebarProps {
  activeSection: SidebarSection;
  onSectionChange: (section: SidebarSection) => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeSection,
  onSectionChange,
}) => {
  const { t } = useTranslation();

  // All Phase 13 sections are always enabled; per-section gating happens
  // *inside* SettingsContainer for the nested sub-nav (Post Process / Debug).
  const availableSections = Object.entries(SECTIONS_CONFIG).map(
    ([id, config]) => ({ id: id as SidebarSection, ...config }),
  );

  return (
    <div className="flex flex-col w-48 h-full border-e border-mid-gray/20 items-center px-2">
      <HandyTextLogo width={140} className="m-4" />
      <div className="flex flex-col w-full items-center gap-1 pt-2 border-t border-mid-gray/20">
        {availableSections.map((section) => {
          const Icon = section.icon;
          const isActive = activeSection === section.id;

          return (
            <div
              key={section.id}
              className={`flex gap-2 items-center p-2 w-full rounded-lg cursor-pointer transition-colors ${
                isActive
                  ? "bg-logo-primary/80 text-bg"
                  : "hover:bg-mid-gray/20 hover:opacity-100 opacity-85"
              }`}
              onClick={() => onSectionChange(section.id)}
            >
              <Icon width={20} height={20} className="shrink-0" />
              <p
                className="text-sm font-medium truncate"
                title={t(section.labelKey)}
              >
                {t(section.labelKey)}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
};
