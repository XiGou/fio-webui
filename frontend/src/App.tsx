import { Route, Routes } from 'react-router-dom'
import { Layout } from '@/components/Layout'
import { HistoryPage } from '@/pages/HistoryPage'
import { LegacyTaskPage } from '@/pages/LegacyTaskPage'
import { WorkflowStudioPage } from '@/pages/WorkflowStudioPage'
import { RealtimeMonitorPage } from '@/pages/RealtimeMonitorPage'

export default function App() {
  return (
    <Routes>
      <Route path="monitor" element={<RealtimeMonitorPage />} />
      <Route element={<Layout />}>
        <Route index element={<WorkflowStudioPage />} />
        <Route path="legacy" element={<LegacyTaskPage />} />
        <Route path="history" element={<HistoryPage />} />
      </Route>
    </Routes>
  )
}
