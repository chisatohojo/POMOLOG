import { useEffect, useSyncExternalStore } from 'react'
import type { EditorLockController } from './editorLock'
import type { AppStore } from './store'

export function useEditorLock(controller: EditorLockController, store: AppStore) {
  const access = useSyncExternalStore(controller.subscribe, controller.getSnapshot)
  useEffect(() => {
    const start = () => controller.start(() => store.prepareForEditing())
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) start()
    }
    start()
    window.addEventListener('pagehide', controller.stop)
    window.addEventListener('pageshow', onPageShow)
    return () => {
      window.removeEventListener('pagehide', controller.stop)
      window.removeEventListener('pageshow', onPageShow)
      controller.stop()
    }
  }, [controller, store])
  return access
}
