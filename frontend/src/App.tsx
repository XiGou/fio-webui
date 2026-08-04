import { Route, Routes } from 'react-router-dom'
import { Layout } from '@/components/Layout'
import { HistoryPage } from '@/pages/HistoryPage'
import { WorkflowStudioPage } from '@/pages/WorkflowStudioPage'
import { RealtimeMonitorPage } from '@/pages/RealtimeMonitorPage'

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<WorkflowStudioPage />} />
        <Route path="monitor" element={<RealtimeMonitorPage />} />
        <Route path="history" element={<HistoryPage />} />
      </Route>
    </Routes>
  )
}
