// Light/dark theme toggle button. The actual appearance state now lives in the
// shared settings store (see settings.tsx), so this header button and the
// Display settings dialog stay in sync; here we just render the shortcut.
import { Icon } from "./ui/Icon";
import { useSettings } from "./settings";

export function ThemeToggle({
  className = "",
  keyTip,
}: {
  className?: string;
  keyTip?: string;
}) {
  const { settings, setSetting } = useSettings();
  const dark = settings.appearance === "dark";

  return (
    <button
      className={`ui-iconbtn ${className}`}
      onClick={() => setSetting("appearance", dark ? "light" : "dark")}
      data-keytip={keyTip}
      title={dark ? "Switch to light mode" : "Switch to dark mode"}
      aria-label="Toggle color theme"
    >
      <Icon name={dark ? "sun" : "moon"} />
    </button>
  );
}
