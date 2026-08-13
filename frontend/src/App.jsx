import { Routes, Route } from 'react-router-dom'
import LoginPage from './pages/LoginPage'
import SimulationPage from './pages/SimulationPage'
import ScenarioListPage from './pages/ScenarioListPage'
import ScenarioDetailPage from './pages/ScenarioDetailPage'
import SignUpPage from './pages/SignUpPage'

function App() {
  return (
    <Routes>
      <Route path="/" element={<LoginPage />} />
      <Route path="/simulation" element={<SimulationPage />} />
      <Route path="/scenarios" element={<ScenarioListPage />} />
      <Route path="/scenarios/:id" element={<ScenarioDetailPage />} />
      <Route path="/signup" element={<SignUpPage />} />
    </Routes>
  )
}

export default App