type MapControlsProps = {
  onZoomIn: () => void
  onZoomOut: () => void
}

export function MapControls({ onZoomIn, onZoomOut }: MapControlsProps) {
  return (
    <div className="map-controls" role="group" aria-label="Масштаб карты">
      <button type="button" onClick={onZoomIn} aria-label="Приблизить карту">
        <span aria-hidden="true">+</span>
      </button>
      <div className="map-controls__divider" />
      <button type="button" onClick={onZoomOut} aria-label="Отдалить карту">
        <span aria-hidden="true">−</span>
      </button>
    </div>
  )
}
