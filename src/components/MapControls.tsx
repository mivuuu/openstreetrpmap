type MapControlsProps = {
  onZoomIn: () => void
  onZoomOut: () => void
}

export function MapControls({ onZoomIn, onZoomOut }: MapControlsProps) {
  return (
    <div className="map-controls" aria-label="Масштаб карты">
      <button type="button" onClick={onZoomIn} aria-label="Приблизить карту">
        +
      </button>
      <div className="map-controls__divider" />
      <button type="button" onClick={onZoomOut} aria-label="Отдалить карту">
        −
      </button>
    </div>
  )
}
