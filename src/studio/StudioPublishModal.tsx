import { useState } from 'react'

type Props = {
  isOpen: boolean
  onClose: () => void
  onPublish: (message: string, deployGhPages: boolean) => Promise<{ success: boolean; error?: string; message?: string }>
}

export function StudioPublishModal({ isOpen, onClose, onPublish }: Props) {
  const [message, setMessage] = useState('')
  const [deployGhPages, setDeployGhPages] = useState(true)
  const [status, setStatus] = useState<'idle' | 'publishing' | 'success' | 'error'>('idle')
  const [errorMessage, setErrorMessage] = useState('')
  const [resultMessage, setResultMessage] = useState('')

  if (!isOpen) return null

  const handleConfirm = async () => {
    setStatus('publishing')
    setErrorMessage('')
    setResultMessage('')
    try {
      const res = await onPublish(message, deployGhPages)
      if (res.success) {
        setStatus('success')
        setResultMessage(res.message || 'Успешно опубликовано на GitHub!')
      } else {
        setStatus('error')
        setErrorMessage(res.error || 'Произошла ошибка при публикации')
      }
    } catch (err: unknown) {
      setStatus('error')
      setErrorMessage(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div className="studio-modal-backdrop" role="dialog" aria-modal="true">
      <div className="studio-modal">
        <header className="studio-modal__header">
          <h3>🚀 Публикация на GitHub</h3>
          <button
            type="button"
            className="studio-modal__close"
            onClick={onClose}
            disabled={status === 'publishing'}
          >
            ✕
          </button>
        </header>

        <div className="studio-modal__body">
          {status === 'idle' && (
            <>
              <p>
                Все сохраненные изменения карты будут закоммичены в ветку <code>main</code> и
                {deployGhPages ? ' автоматически развернуты на сайте GitHub Pages.' : ' отправлены в репозиторий.'}
              </p>

              <div className="studio-field">
                <label htmlFor="publish-commit-msg">Сообщение коммита</label>
                <input
                  id="publish-commit-msg"
                  type="text"
                  className="studio-input"
                  placeholder="Например: Обновлены регионы Ярландии"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                />
              </div>

              <div className="studio-field">
                <label className="studio-checkbox-label">
                  <input
                    type="checkbox"
                    checked={deployGhPages}
                    onChange={(e) => setDeployGhPages(e.target.checked)}
                  />
                  <span>Собрать и опубликовать на GitHub Pages (ветка gh-pages)</span>
                </label>
              </div>
            </>
          )}

          {status === 'publishing' && (
            <div className="studio-modal__loading">
              <div className="studio-spinner" />
              <p>Публикация на GitHub и сборка сайта... Пожалуйста, подождите.</p>
            </div>
          )}

          {status === 'success' && (
            <div className="studio-modal__success">
              <span className="studio-status-icon">✅</span>
              <h4>{resultMessage}</h4>
              <p>Ваш сайт mivuuu.github.io/openstreetrpmap обновится в течение пары минут!</p>
            </div>
          )}

          {status === 'error' && (
            <div className="studio-modal__error">
              <span className="studio-status-icon">❌</span>
              <h4>Ошибка публикации</h4>
              <p className="studio-error-text">{errorMessage}</p>
            </div>
          )}
        </div>

        <footer className="studio-modal__footer">
          {status === 'idle' && (
            <>
              <button
                type="button"
                className="studio-btn studio-btn--secondary"
                onClick={onClose}
              >
                Отмена
              </button>
              <button
                type="button"
                className="studio-btn studio-btn--primary"
                onClick={handleConfirm}
              >
                Опубликовать
              </button>
            </>
          )}

          {(status === 'success' || status === 'error') && (
            <button
              type="button"
              className="studio-btn studio-btn--primary"
              onClick={onClose}
            >
              Закрыть
            </button>
          )}
        </footer>
      </div>
    </div>
  )
}
