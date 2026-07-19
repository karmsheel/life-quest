"use client";

import { X } from "lucide-react";
import { useTabs } from "./TabProvider";

export function TabBar() {
  const { tabs, activeId, activateTab, closeTab, openTab } = useTabs();

  return (
    <div className="tab-bar" role="tablist" aria-label="Open tabs">
      <div className="tab-bar__list">
        {tabs.map((tab) => {
          const active = tab.id === activeId;
          return (
            <div
              key={tab.id}
              className={["tab-bar__tab", active ? "tab-bar__tab--active" : ""]
                .filter(Boolean)
                .join(" ")}
              role="tab"
              aria-selected={active}
              tabIndex={active ? 0 : -1}
              onClick={() => activateTab(tab.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  activateTab(tab.id);
                }
              }}
            >
              <span className="tab-bar__title">{tab.title}</span>
              {tabs.length > 1 ? (
                <button
                  type="button"
                  className="tab-bar__close"
                  aria-label={`Close ${tab.title}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    closeTab(tab.id);
                  }}
                >
                  <X size={12} />
                </button>
              ) : null}
            </div>
          );
        })}
      </div>
      <button
        type="button"
        className="tab-bar__new"
        aria-label="New tab"
        title="New tab (Home)"
        onClick={() => openTab("/home", { title: "Home" })}
      >
        +
      </button>
    </div>
  );
}
