import { createRoot } from 'react-dom/client';
import { App } from './App';
import { ErrorBoundary } from './ui/ErrorBoundary';
import 'maplibre-gl/dist/maplibre-gl.css';
import './styles.css';
import './ux-polish.css';
import './settings-polish.css';
import './usability-fixes.css';

createRoot(document.getElementById('root')!).render(<ErrorBoundary><App /></ErrorBoundary>);
