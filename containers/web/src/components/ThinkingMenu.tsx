import { Menu } from "@base-ui-components/react/menu";
import type { UIThinkingLevel } from "../../shared/protocol";
import { chatClient } from "../lib/chat";

export function ThinkingMenu({
  current,
  levels,
}: {
  current: UIThinkingLevel;
  levels: UIThinkingLevel[];
}) {
  // 모델이 thinking 미지원이면 숨김
  if (levels.length <= 1) return null;

  return (
    <Menu.Root>
      <Menu.Trigger
        className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[13px] text-muted transition-colors hover:bg-hover hover:text-ink"
        title="Thinking level"
      >
        <svg viewBox="0 0 24 24" className="size-3.5 fill-accent" aria-hidden>
          <path d="M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8z" />
        </svg>
        {current}
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner sideOffset={6} align="end">
          <Menu.Popup className="w-36 rounded-xl border border-line bg-card py-1 shadow-xl outline-none">
            {levels.map((level) => (
              <Menu.Item
                key={level}
                onClick={() => chatClient.send({ type: "set_thinking_level", level })}
                className={`cursor-pointer px-3 py-2 text-sm outline-none data-[highlighted]:bg-hover ${
                  level === current ? "font-medium text-accent" : "text-ink"
                }`}
              >
                {level}
              </Menu.Item>
            ))}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
