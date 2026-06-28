import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import { JoinPage } from './pages/JoinPage'
import { RoomPage } from './pages/RoomPage'

export default function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<JoinPage />} />
        <Route path="/room/:code" element={<RoomPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </HashRouter>
  )
}
