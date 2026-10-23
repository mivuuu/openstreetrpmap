import React, { useState } from 'react'
import type { StudioMapOverlay } from './types'

interface StudioOverlayHudProps {
  overlay: StudioMapOverlay
  onUpdateOverlay: (overlay: StudioMapOverlay) => void
  onToggleLock: () => void
  onCenterOnScreen: () => void
  onScale: (factor: number) => void
  onClose: () => void
  onOpenPhotoModal?: () => void
}

export const StudioOverlayHud: React.FC<StudioOverlayHudProps> = ({
  overlay,
  onUpdateOverlay,
  onToggleLock,
  onCenterOnScreen,
  onScale,
  onClose,
  onOpenPhotoModal,
}) => {
  const [isCollapsed, setIsCollapsed] = useState(false)

  return (
    <div
      className={`studio-overlay-hud ${isCollapsed ? 'studio-overlay-hud--collapsed' : ''}`}
      style={{ pointerEvents: 'auto' }}
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
    >
      {/* Header */}
      <div className="studio-overlay-hud__header">
        <div className="studio-overlay-hud__title">
          <span className="studio-overlay-hud__icon">🖼️</span>
          <span>Фото-подложка</span>
          <span
            className={`studio-overlay-hud__status-pill ${
              overlay.locked ? 'studio-overlay-hud__status-pill--locked' : 'studio-overlay-hud__status-pill--unlocked'
            }`}
          >
            {overlay.locked ? '📌 Закреплена' : '🔓 Перемещение'}
          </span>
        </div>

        <div className="studio-overlay-hud__actions">
          <button
            type="button"
            className="studio-hud-icon-btn"
            onClick={() => setIsCollapsed(!isCollapsed)}
            title={isCollapsed ? 'Развернуть панель управления' : 'Свернуть панель управления'}
          >
            {isCollapsed ? '▼' : '▲'}
          </button>
          <button
            type="button"
            className="studio-hud-icon-btn studio-hud-icon-btn--danger"
            onClick={onClose}
            title="Убрать подложку с карты"
          >
            ✕
          </button>
        </div>
      </div>

      {!isCollapsed && (
        <div className="studio-overlay-hud__body">
          {/* Lock / Unlock Primary Action */}
          <div className="studio-overlay-hud__row">
            <button
              type="button"
              className={`studio-btn studio-btn--sm ${
                overlay.locked ? 'studio-hud-btn--unlock' : 'studio-hud-btn--lock'
              }`}
              style={{ width: '100%', justifyContent: 'center' }}
              onClick={onToggleLock}
              title={
                overlay.locked
                  ? 'Включить режим перемещения (позволяет двигать фото и тянуть за углы)'
                  : 'Зафиксировать положение фото на карте (чтобы спокойно рисовать поверх него)'
              }
            >
              {overlay.locked ? (
                <>
                  <span>🔓</span>
                  <span>Разблокировать для перемещения</span>
                </>
              ) : (
                <>
                  <span>📌</span>
                  <span>Закрепить на карте (готово)</span>
                </>
              )}
            </button>
          </div>

          <div className="studio-overlay-hud__hint">
            {overlay.locked
              ? '🟢 Подложка зафиксирована: вы можете рисовать, обрезать и красить поверх неё.'
              : '🟡 Перетаскивайте фото мышкой по карте или тяните за углы для масштабирования.'}
          </div>

          {/* Quick Positioning & Scaling */}
          <div className="studio-overlay-hud__tools-row">
            <button
              type="button"
              className="studio-btn-tiny"
              onClick={onCenterOnScreen}
              title="Переместить фото-подложку прямо в центр текущего экрана"
            >
              🎯 В центр экрана
            </button>
            <div className="studio-overlay-hud__scale-group">
              <span className="studio-hud-label">Масштаб:</span>
              <button
                type="button"
                className="studio-btn-tiny"
                onClick={() => onScale(0.9)}
                title="Уменьшить подложку на 10%"
              >
                −10%
              </button>
              <button
                type="button"
                className="studio-btn-tiny"
                onClick={() => onScale(1.1)}
                title="Увеличить подложку на 10%"
              >
                +10%
              </button>
            </div>
          </div>

          {/* Opacity slider */}
          <div className="studio-overlay-hud__slider-row">
            <div className="studio-overlay-hud__slider-label">
              <span>Прозрачность:</span>
              <strong>{Math.round(overlay.opacity * 100)}%</strong>
            </div>
            <input
              type="range"
              min="0.1"
              max="1"
              step="0.05"
              value={overlay.opacity}
              onChange={(e) =>
                onUpdateOverlay({
                  ...overlay,
                  opacity: parseFloat(e.target.value),
                })
              }
            />
          </div>

          {/* Secondary actions: settings/modal */}
          {onOpenPhotoModal && (
            <div className="studio-overlay-hud__row" style={{ marginTop: '4px' }}>
              <button
                type="button"
                className="studio-btn-tiny"
                style={{ width: '100%', justifyContent: 'center' }}
                onClick={onOpenPhotoModal}
                title="Открыть окно параметров и распознавания регионов"
              >
                ⚙️ Окно распознавания регионов
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
