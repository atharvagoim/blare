import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { useScale } from './design/useScale';
import { AuthProvider } from './lib/auth';
import { LoginPage, SignupPage } from './pages/AuthPages';
import { CreatePage } from './pages/CreatePage';
import { LivePage } from './pages/LivePage';
import { Expired, SharePage } from './pages/SharePage';

export function App() {
  useScale();
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route index element={<CreatePage />} />
          <Route path="s/:id" element={<SharePage />} />
          <Route path="live" element={<LivePage />} />
          <Route path="login" element={<LoginPage />} />
          <Route path="signup" element={<SignupPage />} />
          <Route path="*" element={<Expired />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
