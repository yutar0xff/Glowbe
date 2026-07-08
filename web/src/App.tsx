import { Navigate, Route, Routes } from 'react-router-dom'
import { AppLayout } from '@/AppLayout'
import { ClipCreatePage } from '@/clips/ClipCreatePage'
import { ClipEditorPage } from '@/clips/ClipEditorPage'
import { ChainProfileEditorPage } from '@/chain-editor/ChainProfileEditorPage'
import { ChainProfileManagementPage } from '@/chain-editor/ChainProfileManagementPage'
import { GlowbeRuntimeProvider } from '@/GlowbeRuntimeProvider'

export default function App() {
  return (
    <GlowbeRuntimeProvider>
      <Routes>
        <Route path="/" element={<AppLayout />} />
        <Route path="/clips" element={<ClipEditorPage />} />
        <Route path="/clips/new" element={<ClipCreatePage />} />
        <Route path="/chain-profiles" element={<ChainProfileManagementPage />} />
        <Route path="/chain-profiles/new" element={<Navigate to="/chain-profiles/new/edit" replace />} />
        <Route path="/chain-profiles/:id/edit" element={<ChainProfileEditorPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </GlowbeRuntimeProvider>
  )
}
