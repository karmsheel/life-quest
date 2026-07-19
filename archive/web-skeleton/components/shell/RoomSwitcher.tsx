"use client";

import { Lock } from "lucide-react";
import { usePathname } from "next/navigation";
import { MouseEvent } from "react";
import type { RoomId } from "@/lib/document-kinds.ts";
import { useShell } from "./ShellProvider";
import { useTabs } from "./TabProvider";

const ROOMS: { id: RoomId; label: string; href: string }[] = [
  { id: "dream", label: "Dream", href: "/dream" },
  { id: "chart", label: "Chart", href: "/chart" },
  { id: "track", label: "Track", href: "/track" },
  { id: "act", label: "Act", href: "/act" },
];

export function RoomSwitcher() {
  const pathname = usePathname() || "";
  const { unlockedRooms } = useShell();
  const { openTab, navigateInActive } = useTabs();

  function onClick(
    e: MouseEvent<HTMLButtonElement>,
    room: (typeof ROOMS)[number],
    locked: boolean,
  ) {
    if (locked) return;
    const newTab = e.metaKey || e.ctrlKey;
    if (newTab) {
      openTab(room.href, { title: room.label });
    } else {
      navigateInActive(room.href, room.label);
    }
  }

  return (
    <div className="room-switcher" role="group" aria-label="Rooms">
      {ROOMS.map((room) => {
        const locked = !unlockedRooms.has(room.id);
        const active = pathname === room.href;
        return (
          <button
            key={room.id}
            type="button"
            className={[
              "room-switcher__btn",
              active ? "room-switcher__btn--active" : "",
              locked ? "room-switcher__btn--locked" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            disabled={locked}
            title={
              locked
                ? `${room.label} locked — complete prior pillar document`
                : room.label
            }
            aria-pressed={active}
            onClick={(e) => onClick(e, room, locked)}
          >
            {locked ? <Lock size={12} aria-hidden /> : null}
            <span>{room.label}</span>
          </button>
        );
      })}
    </div>
  );
}
