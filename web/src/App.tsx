import { Navigate, Route, Routes } from 'react-router-dom'
import { AppLayout } from '@/AppLayout'
import { GlowbeRuntimeProvider } from '@/GlowbeRuntimeProvider'

export default function App() {
  return (
    <GlowbeRuntimeProvider>
      <Routes>
        <Route path="/" element={<AppLayout />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </GlowbeRuntimeProvider>
  )
}
