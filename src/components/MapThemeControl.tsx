import type { MapColorScheme } from '../map/mapColorScheme'
import { MoonIcon, SunIcon } from './UiIcons'

type MapThemeControlProps = {
  scheme: MapColorScheme
  onToggle: () => void
}

export function MapThemeControl({ scheme, onToggle }: MapThemeControlProps) {
  const isDark = scheme === 'dark'
  const label = isDark ? 'Включить светлую тему' : 'Включить ночную тему'

  return (
    <button
      type="button"
      className={`map-theme-control${isDark ? ' map-theme-control--dark' : ''}`}
      aria-label={label}
      aria-pressed={isDark}
      title={label}
      onClick={onToggle}
    >
      {isDark ? <SunIcon className="ui-icon" /> : <MoonIcon className="ui-icon" />}
    </button>
  )
}
