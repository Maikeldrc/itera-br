import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import {FeedbackProvider} from './components/FeedbackProvider.tsx';
import {LanguageProvider} from './components/LanguageProvider.tsx';
import {AuthProvider} from './auth.tsx';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LanguageProvider>
      <FeedbackProvider>
        <AuthProvider>
          <App />
        </AuthProvider>
      </FeedbackProvider>
    </LanguageProvider>
  </StrictMode>,
);
